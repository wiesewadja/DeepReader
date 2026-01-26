# src/deeppdf/agent/core.py
"""
DeepPDFAgent - Agent 核心类，实现 ReAct 主循环

基于 Tool-Calling 的 ReAct 模式 Agent，支持多种 LLM Provider
"""
import json
import logging
import uuid
from enum import IntEnum
from typing import Any, Dict, Generator, List, Optional, Tuple

from openai import OpenAI, Stream
from openai.types.chat import ChatCompletion, ChatCompletionChunk, ChatCompletionMessageToolCall

from .tools import Tool
from .executor import ToolExecutor, create_tool_executor
from .prompts import build_system_prompt, ToolCallData, RouteDecision
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
    CLOSED = 0   # 无待闭合标签
    PENDING = 1  # 检测到内容，准备输出
    OPENED = 2   # 已输出 <thought>，待闭合


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
        llm_provider: str = "deepseek",
        llm_model: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        pageindex_lib_path: Optional[str] = None,
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
            llm_provider: LLM 提供商 (deepseek, openai, anthropic)
            llm_model: 模型名称 (默认根据 provider 自动选择)
            api_key: API 密钥 (如果为 None，从环境变量读取)
            base_url: API 基础 URL (如果为 None，使用 provider 默认值)
            pageindex_lib_path: PageIndex 库路径 (用于 read_page 工具)
            temperature: 采样温度
            top_p: nucleus 采样参数
            max_iterations: 最大工具调用迭代次数
        """
        self.index_id = index_id
        self.storage_dir = storage_dir
        self.tree_structure = tree_structure
        self.llm_provider = llm_provider
        self.llm_model = llm_model or self._get_default_model(llm_provider)
        # 使用 settings 中的默认值（如果未提供）
        self.temperature = temperature if temperature is not None else settings.agent_temperature
        self.top_p = top_p if top_p is not None else settings.agent_top_p
        self.max_iterations = max_iterations if max_iterations is not None else settings.agent_max_iterations

        # 初始化 LLM 客户端
        self.client = self._init_llm(api_key, base_url)

        # 初始化工具执行器
        self.executor: ToolExecutor = create_tool_executor(
            index_id=index_id,
            storage_dir=storage_dir,
            tree_structure=tree_structure,
            pageindex_lib_path=pageindex_lib_path,
        )

        # 构建 System Prompt
        self.system_prompt = build_system_prompt(
            tool_descriptions=self.executor.get_tool_descriptions()
        )

        # 历史记录
        self.history: List[Dict[str, Any]] = []

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

    def _get_tool_schemas(self, allowed: Optional[List[str]] = None) -> List[Dict[str, Any]]:
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

        从 self.history 读取完整的对话历史，包括：
        - 用户查询
        - assistant 消息（可能包含工具调用）
        - 工具执行结果

        Returns:
            消息列表，格式为 [System, ...history]
        """
        messages = [{"role": "system", "content": self.system_prompt}]

        # 验证并添加历史消息
        for msg in self.history:
            if "role" not in msg:
                logger.warning(f"[历史记录] 跳过无效消息: {msg}")
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

    def _maybe_open_thought_tag(self, thought_state: Dict[str, Any]) -> Generator[str, None, None]:
        """
        在适当时机输出开启标签

        Args:
            thought_state: 思考状态字典，包含 'state' 和 'has_content' 键

        Yields:
            "<thought>" 标签（如果需要开启）
        """
        if thought_state["state"] == ThoughtState.PENDING:
            thought_state["state"] = ThoughtState.OPENED
            yield "<thought>"

    def _flush_thought_tag(self, thought_state: Dict[str, Any]) -> Generator[str, None, None]:
        """
        输出闭合标签（如果需要）

        Args:
            thought_state: 思考状态字典

        Yields:
            "</thought>" 标签（如果需要闭合）
        """
        if thought_state["state"] == ThoughtState.OPENED:
            thought_state["state"] = ThoughtState.CLOSED
            yield "</thought>"

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

    def run(self, query: str) -> str:
        """
        运行 Agent 主循环 (非流式)

        Args:
            query: 用户查询

        Returns:
            Agent 最终回答
        """
        # 验证查询长度
        self._validate_query_length(query)

        # 启动新轮次: 清空旧历史
        self.history.clear()

        # 记录用户查询
        self.history.append({"role": "user", "content": query})

        # 路由判断：根据查询类型决定可用工具
        route_type = RouteDecision.classify_query(query)
        allowed_tools = self._get_allowed_tools_for_route(route_type)
        logger.info(f"[Agent路由] 查询类型={route_type}, 可用工具={allowed_tools or '全部'}")

        iterations = 0

        while iterations < self.max_iterations:
            iterations += 1
            logger.info(f"[Agent迭代] 第 {iterations} 轮")

            # 构建消息（从 self.history 读取）
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
                self.history.append({
                    "role": "assistant",
                    "content": answer,
                })
                logger.info(f"[Agent完成] 无工具调用，返回最终回答")
                return answer

            # 记录 assistant 消息（包含工具调用）到历史
            self.history.append({
                "role": "assistant",
                "content": assistant_message.content or "",
                "tool_calls": [self._format_tool_call(tc) for tc in tool_calls],
            })

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
                self.history.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": output,
                })

        # 达到最大迭代次数
        logger.warning(f"[Agent警告] 达到最大迭代次数 {self.max_iterations}")
        messages = self._build_messages()
        response = self.client.chat.completions.create(
            model=self.llm_model,
            messages=messages,
            temperature=self.temperature,
        )
        return response.choices[0].message.content or "抱歉，未能完成您的请求。"

    def run_stream(self, query: str) -> Generator[str, None, None]:
        """
        运行 Agent 主循环 (流式输出)

        Args:
            query: 用户查询

        Yields:
            文本片段
        """
        # 验证查询长度
        self._validate_query_length(query)

        # 启动新轮次: 清空旧历史
        self.history.clear()

        # 记录用户查询
        self.history.append({"role": "user", "content": query})

        # 路由判断：根据查询类型决定可用工具
        route_type = RouteDecision.classify_query(query)
        allowed_tools = self._get_allowed_tools_for_route(route_type)
        logger.info(f"[Agent流式路由] 查询类型={route_type}, 可用工具={allowed_tools or '全部'}")

        # 初始化思考状态机
        thought_state: Dict[str, Any] = {
            "state": ThoughtState.CLOSED,
            "has_content": False,
        }

        iterations = 0

        try:
            while iterations < self.max_iterations:
                iterations += 1
                logger.info(f"[Agent流式迭代] 第 {iterations} 轮")

                # 构建消息（从 self.history 读取）
                messages = self._build_messages()

                try:
                    stream: Stream[ChatCompletionChunk] = self.client.chat.completions.create(
                        model=self.llm_model,
                        messages=messages,
                        tools=self._get_tool_schemas(allowed=allowed_tools),
                        temperature=self.temperature,
                        top_p=self.top_p,
                        stream=True,
                    )
                except Exception as e:
                    logger.error(f"[LLM流式错误] 调用失败: {e}")
                    yield f"错误: LLM 调用失败 - {str(e)}"
                    return

                # 收集流式响应
                current_tool_calls: Dict[str, Dict[str, Any]] = {}
                content_buffer: List[str] = []

                for chunk in stream:
                    delta = chunk.choices[0].delta

                    # 处理内容 - 立即输出实现真正的流式体验
                    if delta.content:
                        content_buffer.append(delta.content)

                        # 首次检测到内容时，标记为 PENDING
                        if not thought_state["has_content"]:
                            thought_state["has_content"] = True
                            # 如果这是第二轮之后的迭代，准备输出思考标签
                            if len(self.history) > 1 and iterations > 1:
                                thought_state["state"] = ThoughtState.PENDING

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
                                    current_tool_calls[index]["function"]["name"] = (
                                        tool_call.function.name
                                    )
                                if tool_call.function.arguments:
                                    current_tool_calls[index]["function"]["arguments"] += (
                                        tool_call.function.arguments
                                    )

                # 检查是否有工具调用
                if current_tool_calls:
                    # 确保思考标签已关闭
                    yield from self._flush_thought_tag(thought_state)

                    # 记录 assistant 消息（包含工具调用）到历史
                    content_text = "".join(content_buffer) if content_buffer else ""
                    self.history.append({
                        "role": "assistant",
                        "content": content_text,
                        "tool_calls": list(current_tool_calls.values()),
                    })

                    # 执行工具调用
                    for tool_call_data in current_tool_calls.values():
                        tool_name = tool_call_data["function"]["name"]
                        try:
                            args = json.loads(tool_call_data["function"]["arguments"])
                        except json.JSONDecodeError:
                            args = {}

                        logger.info(f"[流式工具调用] {tool_name} 参数={args}")

                        output = self.executor.execute(tool_name, **args)

                        # 记录工具结果到历史
                        self.history.append({
                            "role": "tool",
                            "tool_call_id": tool_call_data["id"],
                            "content": output,
                        })
                else:
                    # 没有工具调用，完成（最终答案）
                    # 确保思考标签已关闭
                    yield from self._flush_thought_tag(thought_state)

                    content_text = "".join(content_buffer) if content_buffer else ""
                    self.history.append({
                        "role": "assistant",
                        "content": content_text,
                    })
                    logger.info(f"[Agent流式完成] 无工具调用，返回最终答案")
                    return

            # 达到最大迭代次数
            logger.warning(f"[Agent流式警告] 达到最大迭代次数 {self.max_iterations}")
            messages = self._build_messages()
            stream = self.client.chat.completions.create(
                model=self.llm_model,
                messages=messages,
                temperature=self.temperature,
                stream=True,
            )
            for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
        finally:
            # 确保思考标签闭合
            yield from self._flush_thought_tag(thought_state)

    def reset_history(self):
        """重置对话历史"""
        self.history.clear()
        logger.info("[Agent历史] 已重置")

    def get_history(self) -> List[Dict[str, Any]]:
        """获取对话历史"""
        return self.history.copy()


__all__ = ["DeepPDFAgent"]
