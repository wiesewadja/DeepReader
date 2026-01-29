# src/deeppdf/agent/core.py
"""
DeepPDFAgent - Agent 核心类，实现 ReAct 主循环

基于 Tool-Calling 的 ReAct 模式 Agent，支持多种 LLM Provider
"""
import json
import logging
import uuid
from enum import IntEnum
from typing import Any, Dict, Generator, List, Optional

from openai import OpenAI, Stream
from openai.types.chat import (
    ChatCompletion,
    ChatCompletionChunk,
    ChatCompletionMessageToolCall,
)

from .tools import Tool
from .executor import ToolExecutor, create_tool_executor
from .prompts import build_system_prompt, RouteDecision
from ..config import settings


logger = logging.getLogger(__name__)


# ========== 类型定义 ==========


# LLM 客户端类型别名（当前所有 Provider 都使用 OpenAI 兼容客户端）
LLMClient = OpenAI


# ========== 思考状态枚举 ==========


class ThoughtState(IntEnum):
    """
    思考标签状态机

    用于在流式输出中管理 <thought> 标签的开启和闭合。
    """

    CLOSED = 0  # 无待闭合标签
    PENDING = 1  # 检测到内容，准备输出
    OPENED = 2  # 已输出 <thought>，待闭合


# ========== 异常定义 ==========


class AgentError(Exception):
    """Agent 基础异常类"""

    pass


class LLMError(AgentError):
    """LLM 调用失败异常"""

    pass


class ToolExecutionError(AgentError):
    """工具执行失败异常"""

    pass


class MaxIterationsError(AgentError):
    """达到最大迭代次数异常"""

    pass


class DeepPDFAgent:
    """
    DeepPDF Agent - 基于 ReAct 模式的 Tool-Calling Agent

    支持功能:
    - 多种 LLM Provider (deepseek, openai, anthropic)
    - Tool-Calling 模式
    - 流式输出
    - 历史对话管理
    """

    # Provider 到 API URL 的映射
    PROVIDER_BASE_URLS = {
        "deepseek": "https://api.deepseek.com",
        "openai": "https://api.openai.com/v1",
        "anthropic": None,  # Anthropic 不使用 OpenAI 客户端
    }

    def __init__(
        self,
        index_id: str,
        storage_dir: str,
        tree_structure: Dict[str, Any],
        *,
        index_metadata: Optional[Dict[str, Any]] = None,
        llm_provider: str = "deepseek",
        llm_model: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        pageindex_lib_path: Optional[str] = None,
        enable_llm_tree_search: bool = False,
        temperature: Optional[float] = None,
        top_p: Optional[float] = None,
        max_iterations: Optional[int] = None,
    ):
        """
        初始化 DeepPDFAgent

        Args:
            index_id: PDF 索引 ID
            storage_dir: 存储目录路径
            tree_structure: 文档树状结构 (来自 index_metadata)
            index_metadata: 完整的索引元数据（包含 markdown_files 映射）
            llm_provider: LLM 提供商 (deepseek, openai, anthropic)
            llm_model: 模型名称 (默认根据 provider 自动选择)
            api_key: API 密钥 (如果为 None，从环境变量读取)
            base_url: API 基础 URL (如果为 None，使用 provider 默认值)
            pageindex_lib_path: PageIndex 库路径 (用于 read_page 工具)
            enable_llm_tree_search: 是否启用 LLM 树搜索工具（默认 False）
            temperature: 采样温度
            top_p: nucleus 采样参数
            max_iterations: 最大工具调用迭代次数
        """
        self.index_id = index_id
        self.storage_dir = storage_dir
        self.tree_structure = tree_structure
        self.index_metadata = index_metadata or {}
        self.llm_provider = llm_provider
        self.llm_model = llm_model or self._get_default_model(llm_provider)
        # 使用 settings 中的默认值（如果未提供）
        self.temperature = (
            temperature if temperature is not None else settings.agent_temperature
        )
        self.top_p = top_p if top_p is not None else settings.agent_top_p
        self.max_iterations = (
            max_iterations
            if max_iterations is not None
            else settings.agent_max_iterations
        )

        # 初始化 LLM 客户端
        self.client = self._init_llm(api_key, base_url)

        # 创建 MarkdownLocator（如果提供了 index_metadata）
        markdown_locator = None
        if index_metadata and index_metadata.get("markdown_files"):
            from .markdown_locator import MarkdownLocator

            markdown_locator = MarkdownLocator(index_metadata)
            logger.info(
                f"[Agent初始化] MarkdownLocator 已创建，包含 {len(index_metadata.get('markdown_files', {}))} 个文件映射"
            )

        # 初始化工具执行器
        self.executor: ToolExecutor = create_tool_executor(
            index_id=index_id,
            storage_dir=storage_dir,
            tree_structure=tree_structure,
            pageindex_lib_path=pageindex_lib_path,
            markdown_locator=markdown_locator,
            enable_llm_tree_search=enable_llm_tree_search,
            llm_client=self.client if enable_llm_tree_search else None,
        )

        # 构建 System Prompt
        self.system_prompt = build_system_prompt(
            tool_descriptions=self.executor.get_tool_descriptions()
        )

        # 历史记录管理
        self.session_history: List[Dict[str, Any]] = []  # 会话级别的历史（多轮对话）
        self.current_turn_history: List[Dict[str, Any]] = (
            []
        )  # 当前轮次的历史（工具调用等）

        logger.info(f"[Agent初始化] Provider={llm_provider}, Model={self.llm_model}")

    def _get_default_model(self, provider: str) -> str:
        """获取 provider 的默认模型"""
        default_models = {
            "deepseek": "deepseek-chat",
            "openai": "gpt-4o-mini",
            "anthropic": "claude-3-5-sonnet-20241022",
        }
        return default_models.get(provider, "deepseek-chat")

    def _init_llm(self, api_key: Optional[str], base_url: Optional[str]) -> LLMClient:
        """
        初始化 LLM 客户端

        Args:
            api_key: API 密钥
            base_url: API 基础 URL

        Returns:
            OpenAI 客户端实例

        Raises:
            ValueError: 不支持的 provider
        """
        if self.llm_provider == "anthropic":
            raise ValueError(
                "Anthropic 暂不支持，请使用 deepseek 或 openai。"
                "如需 Anthropic 支持，请使用 Anthropic SDK。"
            )

        # 确定 base_url
        if base_url is None:
            base_url = self.PROVIDER_BASE_URLS.get(self.llm_provider)

        # 创建客户端
        return OpenAI(
            api_key=api_key,
            base_url=base_url,
        )

    def _get_tool_schemas(
        self, allowed: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        获取工具的 OpenAI Function Calling 格式 schema

        Args:
            allowed: 允许的工具名称列表。如果为 None，返回所有工具的 schema。

        Returns:
            工具 schema 列表
        """
        schemas = []

        for name, tool in self.executor.tools.items():
            # 如果提供了 allowed 列表，只返回允许的工具
            if allowed is not None and name not in allowed:
                continue

            schema = {
                "type": "function",
                "function": {
                    "name": name,
                    "description": tool.description,
                    "parameters": self._get_tool_parameters(name, tool),
                },
            }
            schemas.append(schema)

        return schemas

    def _get_tool_parameters(self, name: str, tool: Tool) -> Dict[str, Any]:
        """
        获取工具参数的 JSON Schema

        Args:
            name: 工具名称
            tool: 工具实例

        Returns:
            参数 JSON Schema
        """
        if name == "inspect_toc":
            return {"type": "object", "properties": {}}

        elif name == "read_page":
            return {
                "type": "object",
                "properties": {
                    "page_num": {
                        "type": "integer",
                        "description": "要读取的页码（从1开始）",
                    }
                },
                "required": ["page_num"],
            }

        elif name == "hybrid_search":
            return {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词或问题",
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "返回结果数量，默认5",
                    },
                },
                "required": ["query"],
            }

        else:
            # 默认: 无参数
            return {"type": "object", "properties": {}}

    def _build_messages(self) -> List[Dict[str, Any]]:
        """
        构建对话消息列表

        组合会话历史和当前轮次历史：
        - System Prompt
        - 会话历史（之前的多轮对话）
        - 当前轮次历史（当前问题的工具调用等）

        Returns:
            消息列表，格式为 [System, ...session_history, ...current_turn_history]
        """
        messages = [{"role": "system", "content": self.system_prompt}]

        # 添加会话历史（之前的对话）
        for msg in self.session_history:
            if "role" not in msg:
                logger.warning(f"[历史记录] 跳过无效会话消息: {msg}")
                continue
            messages.append(msg)

        # 添加当前轮次历史
        for msg in self.current_turn_history:
            if "role" not in msg:
                logger.warning(f"[历史记录] 跳过无效当前消息: {msg}")
                continue
            messages.append(msg)

        return messages

    def _extract_tool_calls(
        self, response: ChatCompletion
    ) -> List[ChatCompletionMessageToolCall]:
        """
        从 LLM 响应中提取工具调用

        Args:
            response: ChatCompletion 响应

        Returns:
            工具调用列表
        """
        message = response.choices[0].message
        return message.tool_calls or []

    def _format_tool_call(
        self, tool_call: ChatCompletionMessageToolCall
    ) -> Dict[str, Any]:
        """
        格式化工具调用为字典格式

        Args:
            tool_call: OpenAI 工具调用对象

        Returns:
            工具调用字典
        """
        return {
            "id": tool_call.id,
            "type": tool_call.type,
            "function": {
                "name": tool_call.function.name,
                "arguments": tool_call.function.arguments,
            },
        }

    def _get_allowed_tools_for_route(self, route_type: str) -> Optional[List[str]]:
        """
        根据路由类型获取允许的工具列表

        Args:
            route_type: 路由类型 ("fast", "slow", "section")

        Returns:
            允许的工具名称列表，None 表示允许全部工具
        """
        if route_type == "fast":
            # 简单事实查询：只允许 hybrid_search
            return ["hybrid_search"]
        elif route_type == "section":
            # 章节查询：优先 read_page，保留 hybrid_search 作为备选
            return ["read_page", "hybrid_search"]
        elif route_type == "slow":
            # 复杂分析：允许全部工具
            return None
        else:
            # 未知类型：允许全部工具
            return None

    def _maybe_open_thought_tag(
        self, thought_state: Dict[str, Any]
    ) -> Generator[str, None, None]:
        """
        思考标签功能已禁用。
        用户只需要看到执行状态提示（如"正在搜索..."），不需要看到思考过程。

        Args:
            thought_state: 思考状态字典，包含 'state' 和 'has_content' 键

        Yields:
            无输出（功能已禁用）
        """
        # 禁用思考标签输出 - 用户不需要看到思考过程
        if thought_state["state"] == ThoughtState.PENDING:
            thought_state["state"] = ThoughtState.OPENED
            # 不再 yield "<thought>" 标签
        return
        yield  # 保持生成器语义

    def _flush_thought_tag(
        self, thought_state: Dict[str, Any]
    ) -> Generator[str, None, None]:
        """
        思考标签功能已禁用。

        Args:
            thought_state: 思考状态字典

        Yields:
            无输出（功能已禁用）
        """
        # 禁用思考标签输出
        if thought_state["state"] == ThoughtState.OPENED:
            thought_state["state"] = ThoughtState.CLOSED
            # 不再 yield "</thought>" 标签
        return
        yield  # 保持生成器语义

    def _validate_query_length(self, query: str) -> None:
        """
        验证查询长度

        Args:
            query: 用户查询字符串

        Raises:
            AgentError: 如果查询过长
        """
        max_length = settings.agent_max_query_length
        if len(query) > max_length:
            raise AgentError(
                f"查询过长（{len(query)} 字符），请精简到 {max_length} 字符以内。"
            )

    def run(
        self, query: str, force_mode: Optional[str] = None, keep_history: bool = True
    ) -> str:
        """
        运行 Agent 主循环 (非流式)

        Args:
            query: 用户查询
            force_mode: 强制路由模式 (None=自动路由, "fast"/"section"/"slow")
            keep_history: 是否保留对话历史，支持多轮对话（默认True）

        Returns:
            Agent 最终回答
        """
        # 验证查询长度
        self._validate_query_length(query)

        # 如果不保留历史，清空会话历史
        if not keep_history:
            self.session_history.clear()

        # 清空当前轮次历史，准备新的推理
        self.current_turn_history.clear()

        # 记录用户查询到当前轮次
        self.current_turn_history.append({"role": "user", "content": query})

        # 路由判断：根据强制模式或查询类型决定可用工具
        if force_mode is None:
            # 自动路由
            route_type = RouteDecision.classify_query(query)
            allowed_tools = self._get_allowed_tools_for_route(route_type)
            logger.info(
                f"[Agent路由] 查询类型={route_type}, 可用工具={allowed_tools or '全部'}"
            )
        else:
            # 强制模式
            allowed_tools = self._get_allowed_tools_for_route(force_mode)
            logger.info(
                f"[Agent路由] 强制模式={force_mode}, 可用工具={allowed_tools or '全部'}"
            )

        iterations = 0

        while iterations < self.max_iterations:
            iterations += 1
            logger.info(f"[Agent迭代] 第 {iterations} 轮")

            # 构建消息（从 session_history 和 current_turn_history 读取）
            messages = self._build_messages()

            # 调用 LLM（根据路由类型过滤工具）
            try:
                response = self.client.chat.completions.create(
                    model=self.llm_model,
                    messages=messages,
                    tools=self._get_tool_schemas(allowed=allowed_tools),
                    temperature=self.temperature,
                    top_p=self.top_p,
                )
            except Exception as e:
                logger.error(f"[LLM错误] 调用失败: {e}", exc_info=True)
                raise LLMError(f"LLM调用失败: {str(e)}") from e

            # 检查是否有工具调用
            tool_calls = self._extract_tool_calls(response)
            assistant_message = response.choices[0].message

            if not tool_calls:
                # 没有工具调用，返回最终回答
                answer = assistant_message.content or ""
                # 记录最终回答到历史
                self.current_turn_history.append(
                    {
                        "role": "assistant",
                        "content": answer,
                    }
                )
                logger.info("[Agent完成] 无工具调用，返回最终回答")

                # 保存会话历史（支持多轮对话）
                if keep_history:
                    self.session_history.append({"role": "user", "content": query})
                    self.session_history.append(
                        {"role": "assistant", "content": answer}
                    )
                    logger.info("💾 [会话历史] 已保存本轮对话")

                # 清空当前轮次历史
                self.current_turn_history.clear()

                return answer

            # 记录 assistant 消息（包含工具调用）到历史
            self.current_turn_history.append(
                {
                    "role": "assistant",
                    "content": assistant_message.content or "",
                    "tool_calls": [self._format_tool_call(tc) for tc in tool_calls],
                }
            )

            # 执行工具调用
            for tool_call in tool_calls:
                function = tool_call.function
                tool_name = function.name

                try:
                    args = json.loads(function.arguments)
                except json.JSONDecodeError:
                    args = {}

                logger.info(f"[工具调用] {tool_name} 参数={args}")

                # 执行工具
                output = self.executor.execute(tool_name, **args)

                # 记录工具结果到历史
                self.current_turn_history.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": output,
                    }
                )

        # 达到最大迭代次数
        logger.warning(f"[Agent警告] 达到最大迭代次数 {self.max_iterations}")
        messages = self._build_messages()
        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=messages,
            temperature=self.temperature,
        )
        final_answer = response.choices[0].message.content or "抱歉，未能完成您的请求。"

        # 保存会话历史（支持多轮对话）
        if keep_history:
            self.session_history.append({"role": "user", "content": query})
            self.session_history.append({"role": "assistant", "content": final_answer})
            logger.info("💾 [会话历史] 已保存本轮对话 (最大迭代)")

        # 清空当前轮次历史
        self.current_turn_history.clear()

        return final_answer

    def run_stream(
        self, query: str, force_mode: Optional[str] = None, keep_history: bool = True
    ) -> Generator[str, None, None]:
        """
        运行 Agent 主循环 (流式输出)

        Args:
            query: 用户查询
            force_mode: 强制路由模式 (None=自动路由, "fast"/"section"/"slow")
            keep_history: 是否保留对话历史，支持多轮对话（默认True）

        Yields:
            文本片段
        """
        # ========== 🎯 阶段1: 初始化 ==========
        logger.info("")
        logger.info("=" * 80)
        logger.info("🚀 [Agent推理] 开始新的推理过程")
        logger.info("=" * 80)
        logger.info(f"📝 [用户查询] {query}")
        logger.info(f"📊 [查询长度] {len(query)} 字符")
        logger.info(f"💬 [保留历史] {keep_history}")
        logger.info(f"📚 [会话历史] 当前有 {len(self.session_history)} 条历史消息")

        # 验证查询长度
        self._validate_query_length(query)

        # 如果不保留历史，清空会话历史
        if not keep_history:
            self.session_history.clear()
            logger.info("🔄 [会话历史] 已清空，开始新会话")

        # 清空当前轮次历史，准备新的推理
        self.current_turn_history.clear()
        logger.info("🔄 [当前轮次] 已清空，开始新轮次")

        # 记录用户查询到当前轮次
        self.current_turn_history.append({"role": "user", "content": query})

        # ========== 🎯 阶段2: 路由判断 ==========
        logger.info("")
        logger.info("-" * 80)
        logger.info("🧭 [路由判断] 开始分析查询类型")
        logger.info("-" * 80)

        # 路由判断：根据强制模式或查询类型决定可用工具
        if force_mode is None:
            # 自动路由
            route_type = RouteDecision.classify_query(query)
            allowed_tools = self._get_allowed_tools_for_route(route_type)
            logger.info(f"🔍 [自动路由] 查询类型: {route_type}")
            logger.info(f"🛠️  [可用工具] {allowed_tools or '全部工具'}")

            # 详细说明路由原因
            if route_type == "fast":
                logger.info("💡 [路由说明] 简单事实查询 → 使用 hybrid_search 快速检索")
            elif route_type == "section":
                logger.info("💡 [路由说明] 章节定位查询 → 优先使用 read_page")
            elif route_type == "slow":
                logger.info("💡 [路由说明] 复杂分析查询 → 使用全部工具进行深度推理")
        else:
            # 强制模式
            allowed_tools = self._get_allowed_tools_for_route(force_mode)
            logger.info(f"⚡ [强制模式] {force_mode}")
            logger.info(f"🛠️  [可用工具] {allowed_tools or '全部工具'}")

        # 初始化思考状态机
        thought_state: Dict[str, Any] = {
            "state": ThoughtState.CLOSED,
            "has_content": False,
        }

        iterations = 0
        total_tokens_estimate = 0  # 估算token使用量

        try:
            while iterations < self.max_iterations:
                iterations += 1

                # ========== 🎯 阶段3: 迭代推理 ==========
                logger.info("")
                logger.info("=" * 80)
                logger.info(f"🔄 [第 {iterations} 轮迭代] 开始推理")
                logger.info("=" * 80)

                # 构建消息（从 session_history 和 current_turn_history 读取）
                messages = self._build_messages()
                logger.info(f"📨 [消息构建] 共 {len(messages)} 条消息")
                logger.info("   - System: 1 条")
                logger.info(f"   - History: {len(messages) - 1} 条")
                # 估算 token
                total_chars = sum(len(str(m.get("content", ""))) for m in messages)
                total_tokens_estimate = total_chars // 3
                logger.info(
                    f"📊 [Token估算] 约 {total_tokens_estimate} tokens ({total_chars} 字符)"
                )

                # ========== 🎯 阶段4: LLM 调用 ==========
                logger.info("")
                logger.info(f"🤖 [LLM调用] 准备调用 {self.llm_model}")
                logger.info(f"   - Temperature: {self.temperature}")
                logger.info(f"   - Top-p: {self.top_p}")
                logger.info(f"   - 工具限制: {allowed_tools or '无限制'}")

                # 发送进度提示
                if iterations == 1:
                    yield "\n\n💭 分析中\n\n"
                else:
                    yield "\n\n💭 整理中\n\n"

                try:
                    stream: Stream[ChatCompletionChunk] = (
                        self.client.chat.completions.create(
                            model=self.llm_model,
                            messages=messages,
                            tools=self._get_tool_schemas(allowed=allowed_tools),
                            temperature=self.temperature,
                            top_p=self.top_p,
                            stream=True,
                        )
                    )
                    logger.info("✅ [LLM调用] 成功，开始接收流式响应")
                except Exception as e:
                    logger.error(f"❌ [LLM错误] 调用失败: {e}")
                    yield f"错误: LLM 调用失败 - {str(e)}"
                    return

                # ========== 🎯 阶段5: 解析响应 ==========
                logger.info("📥 [流式解析] 开始处理 LLM 响应流")

                # 收集流式响应
                current_tool_calls: Dict[str, Dict[str, Any]] = {}
                content_buffer: List[str] = []
                chunk_count = 0

                for chunk in stream:
                    chunk_count += 1
                    delta = chunk.choices[0].delta

                    # 处理内容 - 立即输出实现真正的流式体验
                    if delta.content:
                        content_buffer.append(delta.content)

                        # 首次检测到内容时，标记为 PENDING
                        if not thought_state["has_content"]:
                            thought_state["has_content"] = True
                            # 如果这是第二轮之后的迭代，准备输出思考标签
                            if len(self.current_turn_history) > 1 and iterations > 1:
                                thought_state["state"] = ThoughtState.PENDING
                                logger.info(
                                    "💭 [思考标签] 检测到迭代内容，准备添加 <thought> 标签"
                                )

                        # 如果状态是 PENDING，输出开启标签
                        yield from self._maybe_open_thought_tag(thought_state)

                        # 输出内容
                        yield delta.content

                    # 处理工具调用
                    if delta.tool_calls:
                        # 关闭待处理的思考标签
                        yield from self._flush_thought_tag(thought_state)

                        for tool_call in delta.tool_calls:
                            index = tool_call.index
                            tool_id = tool_call.id

                            if index not in current_tool_calls:
                                current_tool_calls[index] = {
                                    "id": tool_id or str(uuid.uuid4()),
                                    "type": "function",
                                    "function": {"name": "", "arguments": ""},
                                }

                            if tool_call.id:
                                current_tool_calls[index]["id"] = tool_call.id

                            if tool_call.function:
                                if tool_call.function.name:
                                    current_tool_calls[index]["function"][
                                        "name"
                                    ] = tool_call.function.name
                                if tool_call.function.arguments:
                                    current_tool_calls[index]["function"][
                                        "arguments"
                                    ] += tool_call.function.arguments

                logger.info(f"📦 [流式完成] 接收了 {chunk_count} 个 chunk")
                logger.info(f"📝 [内容长度] {len(''.join(content_buffer))} 字符")

                # ========== 🎯 阶段6: 工具调用处理 ==========
                # 检查是否有工具调用
                if current_tool_calls:
                    logger.info("")
                    logger.info("🔧 " + "=" * 78)
                    logger.info(
                        f"🔧 [工具调用] 检测到 {len(current_tool_calls)} 个工具调用"
                    )
                    logger.info("🔧 " + "=" * 78)

                    # 发送工具调用进度提示
                    tool_names = [
                        tc["function"]["name"] for tc in current_tool_calls.values()
                    ]
                    if "inspect_toc" in tool_names:
                        yield "\n\n🔍 查目录\n\n"
                    if "hybrid_search" in tool_names:
                        yield "\n\n🔎 查看中\n\n"
                    if "read_page" in tool_names:
                        yield "\n\n📖 阅读中\n\n"

                    # 确保思考标签已关闭
                    yield from self._flush_thought_tag(thought_state)

                    # 记录 assistant 消息（包含工具调用）到历史
                    content_text = "".join(content_buffer) if content_buffer else ""
                    self.current_turn_history.append(
                        {
                            "role": "assistant",
                            "content": content_text,
                            "tool_calls": list(current_tool_calls.values()),
                        }
                    )

                    # 执行工具调用（并行执行以提升性能）
                    from concurrent.futures import ThreadPoolExecutor, as_completed
                    import time

                    # 准备工具调用任务
                    tool_tasks = []
                    for idx, tool_call_data in enumerate(
                        current_tool_calls.values(), 1
                    ):
                        tool_name = tool_call_data["function"]["name"]
                        try:
                            args = json.loads(tool_call_data["function"]["arguments"])
                        except json.JSONDecodeError:
                            args = {}

                        tool_tasks.append(
                            {
                                "idx": idx,
                                "tool_call_id": tool_call_data["id"],
                                "tool_name": tool_name,
                                "args": args,
                            }
                        )

                    # 并行执行所有工具
                    total_start_time = time.time()
                    logger.info(f"⚡ [并行执行] 同时执行 {len(tool_tasks)} 个工具...")

                    with ThreadPoolExecutor(max_workers=3) as executor:
                        # 提交所有任务
                        future_to_task = {
                            executor.submit(
                                self.executor.execute, task["tool_name"], **task["args"]
                            ): task
                            for task in tool_tasks
                        }

                        # 收集结果（按完成顺序）
                        for future in as_completed(future_to_task):
                            task = future_to_task[future]
                            idx = task["idx"]
                            tool_name = task["tool_name"]
                            args = task["args"]
                            tool_call_id = task["tool_call_id"]

                            try:
                                output = future.result()

                                logger.info("")
                                logger.info(
                                    f"🛠️  [{idx}/{len(tool_tasks)}] 完成工具: {tool_name}"
                                )
                                logger.info(
                                    f"   📋 参数: {json.dumps(args, ensure_ascii=False)}"
                                )
                                logger.info(f"   📤 返回长度: {len(output)} 字符")
                                logger.info(
                                    f"   📄 返回预览: {output[:200]}..."
                                    if len(output) > 200
                                    else f"   📄 返回内容: {output}"
                                )

                                # 记录工具结果到历史
                                self.current_turn_history.append(
                                    {
                                        "role": "tool",
                                        "tool_call_id": tool_call_id,
                                        "content": output,
                                    }
                                )

                            except Exception as e:
                                logger.error(f"❌ [工具执行错误] {tool_name}: {e}")
                                # 即使出错也要记录结果
                                self.current_turn_history.append(
                                    {
                                        "role": "tool",
                                        "tool_call_id": tool_call_id,
                                        "content": f"[ERROR] 工具执行失败: {str(e)}",
                                    }
                                )

                    total_execution_time = time.time() - total_start_time

                    logger.info("")
                    logger.info("✅ [工具执行] 所有工具调用已完成，准备下一轮迭代")
                    logger.info(
                        f"⚡ [并行执行] 总耗时: {total_execution_time:.2f} 秒（并行执行）"
                    )

                else:
                    # ========== 🎯 阶段7: 最终答案 ==========
                    logger.info("")
                    logger.info("🎉 " + "=" * 78)
                    logger.info("🎉 [推理完成] LLM 返回最终答案（无工具调用）")
                    logger.info("🎉 " + "=" * 78)

                    # 确保思考标签已关闭
                    yield from self._flush_thought_tag(thought_state)

                    content_text = "".join(content_buffer) if content_buffer else ""
                    self.current_turn_history.append(
                        {
                            "role": "assistant",
                            "content": content_text,
                        }
                    )

                    logger.info("📊 [最终统计]")
                    logger.info(f"   - 总迭代轮次: {iterations}")
                    logger.info(f"   - 最终回答长度: {len(content_text)} 字符")
                    logger.info(f"   - Token估算: ~{total_tokens_estimate} tokens")
                    logger.info("")
                    logger.info("=" * 80)
                    logger.info("✨ [Agent推理] 推理过程结束")
                    logger.info("=" * 80)
                    logger.info("")

                    # 保存本轮对话到会话历史（支持多轮对话）
                    if keep_history:
                        # 保存用户查询
                        self.session_history.append({"role": "user", "content": query})
                        # 保存助手回答
                        self.session_history.append(
                            {"role": "assistant", "content": content_text}
                        )
                        logger.info("💾 [会话历史] 已保存本轮对话")
                        logger.info(
                            f"💾 [会话历史] 当前共有 {len(self.session_history)} 条消息"
                        )

                    # 清空当前轮次历史
                    self.current_turn_history.clear()

                    return

            # ========== 🎯 阶段8: 达到最大迭代 ==========
            logger.warning("")
            logger.warning("⚠️  " + "=" * 78)
            logger.warning(f"⚠️  [达到上限] 已达到最大迭代次数 {self.max_iterations}")
            logger.warning("⚠️  " + "=" * 78)
            logger.warning(f"   - 已执行轮次: {iterations}")
            logger.warning(f"   - 当前轮次历史消息数: {len(self.current_turn_history)}")
            logger.warning("")

            messages = self._build_messages()
            stream = self.client.chat.completions.create(
                model=self.llm_model,
                messages=messages,
                temperature=self.temperature,
                stream=True,
            )
            # 收集强制结束时的回答
            final_content_buffer = []
            for chunk in stream:
                if chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    final_content_buffer.append(content)
                    yield content

            # 保存会话历史
            if keep_history:
                final_answer = "".join(final_content_buffer)
                self.session_history.append({"role": "user", "content": query})
                self.session_history.append(
                    {"role": "assistant", "content": final_answer}
                )
                logger.info("💾 [会话历史] 已保存本轮对话 (最大迭代)")
        finally:
            # 确保思考标签闭合
            yield from self._flush_thought_tag(thought_state)

    def reset_history(self):
        """重置对话历史"""
        self.session_history.clear()
        self.current_turn_history.clear()
        logger.info("[Agent历史] 已重置")

    def get_history(self) -> List[Dict[str, Any]]:
        """获取当前轮次的推理历史（用于统计迭代次数等）"""
        return self.current_turn_history.copy()


__all__ = ["DeepPDFAgent"]
