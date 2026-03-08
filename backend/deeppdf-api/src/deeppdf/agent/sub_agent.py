"""
子 Agent 执行器 - 上下文隔离的 Skill 执行

设计哲学:
- Skills 是知识，不是脚本
- 信任模型的推理能力
- 子 Agent 使用隔离的消息历史
- 只返回最终结果，不暴露主 Agent 上下文
"""

import json
import logging
import re
from typing import Any, Dict, Generator, List, Optional

from openai import OpenAI

from .executor import ToolExecutor
from .tools import Tool

logger = logging.getLogger(__name__)

# DeepSeek 内部标签清理正则（用于过滤非标准输出）
# 匹配 <|DSML|function_calls>...</|DSML|function_calls> 等内部格式
# 注意：DeepSeek 使用全角字符 ｜ (U+FF5C)，需要同时匹配半角和全角
_DEEPSEEK_INTERNAL_TAG_PATTERN = re.compile(
    r"<[|｜]DSML[|｜]function_calls[|｜]>.*?</[|｜]DSML[|｜]function_calls[|｜]>|"
    r"<[|｜]DSML[|｜][^>]*>.*?</[|｜]DSML[|｜][^>]*>|"
    r"</?[|｜]DSML[|｜][^>]*>",
    re.DOTALL,
)


def _clean_deepseek_internal_tags(text: str) -> str:
    """
    清理 DeepSeek 模型的内部标签

    DeepSeek 在某些情况下会输出 <|DSML|function_calls> 等内部格式标签，
    这些标签不应该传递给用户，需要过滤掉。

    Args:
        text: 原始文本

    Returns:
        清理后的文本
    """
    return _DEEPSEEK_INTERNAL_TAG_PATTERN.sub("", text).strip()


class SubAgentExecutor:
    """
    极简的子 Agent 执行器

    核心:同样的循环 + 全新的历史 + Skill 知识注入
    """

    def __init__(
        self,
        client: OpenAI,
        model: str,
        executor: ToolExecutor,
        temperature: float = 0.7,
        top_p: float = 1.0,
    ):
        """
        初始化子 Agent 执行器

        Args:
            client: OpenAI 客户端
            model: 模型名称
            executor: 工具执行器
            temperature: 采样温度
            top_p: nucleus 采样参数
        """
        self.client = client
        self.model = model
        self.executor = executor
        self.temperature = temperature
        self.top_p = top_p

    def _get_tool_schemas(
        self, allowed: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        获取工具的 OpenAI Function Calling 格式 schema

        Args:
            allowed: 允许的工具名称列表。如果为 None, 返回所有工具的 schema。

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
                        "description": "要读取的页码（从1开始)",
                    },
                    "force_visual": {
                        "type": "boolean",
                        "description": "是否强制使用视觉OCR分析图片/图表",
                    },
                },
                "required": ["page_num"],
            }
        elif name == "hybrid_search":
            return {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词",
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "返回结果数量",
                    },
                },
                "required": ["query"],
            }
        # 其他工具(通用格式)
        return {"type": "object", "properties": {}}

    def execute(
        self,
        skill_knowledge: str,
        user_query: str,
        available_tools: Optional[List[str]] = None,
        max_turns: int = 10,
    ) -> str:
        """
        执行 Skill，返回最终结果

        Args:
            skill_knowledge: Skill 的 System Prompt 内容
            user_query: 用户的问题
            available_tools: 可选的工具名称列表（None 表示使用所有工具）
            max_turns: 最大循环次数

        Returns:
            最终的文本回复
        """
        logger.info("=" * 60)
        logger.info("[SubAgent] 开始执行")
        logger.info(f"  Query: {user_query[:50]}...")
        logger.info(f"  Max Turns: {max_turns}")
        logger.info(
            f"  Available Tools: {available_tools or 'all' if available_tools is None else ', '.join(available_tools or [])}"
        )
        logger.info("=" * 60)

        # 1. 构建隔离的消息历史
        sub_messages = [
            {
                "role": "system",
                "content": skill_knowledge,
            },
            {
                "role": "user",
                "content": user_query,
            },
        ]

        # 2. 获取工具 schema
        tool_schemas = self._get_tool_schemas(available_tools)
        logger.info(f"[SubAgent] 工具数量: {len(tool_schemas)}")

        # 3. ReAct 循环
        last_assistant_message = None  # 保存最后一轮的 assistant 消息
        for turn in range(max_turns):
            logger.info(f"[SubAgent] 第 {turn + 1} 轮迭代")
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    max_tokens=4096,
                    messages=sub_messages,
                    tools=tool_schemas,
                    temperature=self.temperature,
                    top_p=self.top_p,
                )
            except Exception as e:
                logger.error(f"[SubAgent] LLM 调用失败: {e}")
                return f"SubAgent 执行失败: {str(e)}"
            # 检查响应状态
            assistant_message = response.choices[0].message
            last_assistant_message = assistant_message  # 保存最后一轮消息
            # 检查是否有工具调用
            tool_calls = assistant_message.tool_calls or []
            if not tool_calls:
                # 没有工具调用，返回最终回答
                answer = assistant_message.content or ""
                # 清理可能的 DeepSeek 内部标签
                answer = _clean_deepseek_internal_tags(answer)
                logger.info(
                    f"[SubAgent] 第 {turn + 1} 轮迭代完成,无工具调用,返回最终回答"
                )
                logger.info(f"  回答长度: {len(answer)} 字符")
                return answer
            # 记录 assistant 消息（包含工具调用）
            sub_messages.append(
                {
                    "role": "assistant",
                    "content": assistant_message.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": tc.type,
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in tool_calls
                    ],
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
                logger.info(f"  [工具调用] {tool_name} 参数={args}")
                # 执行工具
                output = self.executor.execute(tool_name, **args)
                logger.info(f"  [工具结果] 长度={len(output)}")
                # 记录工具结果
                sub_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": output,
                    }
                )

        # 达到最大迭代次数，尝试获取最后一轮的回答
        # 如果最后一轮有内容，返回它；否则返回提示信息
        if last_assistant_message and last_assistant_message.content:
            answer = _clean_deepseek_internal_tags(last_assistant_message.content)
            logger.warning(
                f"[SubAgent] 达到最大轮次 {max_turns}，返回当前部分回答（{len(answer)} 字符）"
            )
            return answer

        logger.warning(f"[SubAgent] 达到最大轮次 {max_turns}，未能完成任务")
        return "达到最大循环次数，未能完成任务。请尝试简化您的问题或分步骤提问。"

    def execute_stream(
        self,
        skill_knowledge: str,
        user_query: str,
        available_tools: Optional[List[str]] = None,
        max_turns: int = 10,
    ) -> Generator[str, None, None]:
        """
        流式执行 Skill，实时输出

        设计：
        - 工具调用期间：发送状态更新（如 "🔍 正在搜索..."）
        - LLM 回答期间：真正的流式输出

        Args:
            skill_knowledge: Skill 的 System Prompt 内容
            user_query: 用户的问题
            available_tools: 可选的工具名称列表（None 表示使用所有工具）
            max_turns: 最大循环次数

        Yields:
            文本片段（流式输出）
        """
        logger.info("=" * 60)
        logger.info("[SubAgent-Stream] 开始流式执行")
        logger.info(f"  Query: {user_query[:50]}...")
        logger.info(f"  Max Turns: {max_turns}")
        logger.info("=" * 60)

        # 1. 构建隔离的消息历史
        sub_messages = [
            {
                "role": "system",
                "content": skill_knowledge,
            },
            {
                "role": "user",
                "content": user_query,
            },
        ]

        # 2. 获取工具 schema
        tool_schemas = self._get_tool_schemas(available_tools)
        logger.info(f"[SubAgent-Stream] 工具数量: {len(tool_schemas)}")

        # 3. ReAct 循环
        last_assistant_content = ""
        for turn in range(max_turns):
            logger.info(f"[SubAgent-Stream] 第 {turn + 1} 轮迭代")

            try:
                # 非流式调用（获取工具调用信息）
                response = self.client.chat.completions.create(
                    model=self.model,
                    max_tokens=4096,
                    messages=sub_messages,
                    tools=tool_schemas,
                    temperature=self.temperature,
                    top_p=self.top_p,
                )
            except Exception as e:
                logger.error(f"[SubAgent-Stream] LLM 调用失败: {e}")
                yield f"\n\n❌ 执行失败: {str(e)}"
                return

            # 检查响应状态
            assistant_message = response.choices[0].message
            last_assistant_content = assistant_message.content or ""

            # 检查是否有工具调用
            tool_calls = assistant_message.tool_calls or []

            if not tool_calls:
                # 没有工具调用，流式输出最终回答
                logger.info(
                    f"[SubAgent-Stream] 第 {turn + 1} 轮完成，无工具调用，开始流式输出"
                )

                # 流式调用 LLM
                try:
                    stream_response = self.client.chat.completions.create(
                        model=self.model,
                        max_tokens=4096,
                        messages=sub_messages,
                        temperature=self.temperature,
                        top_p=self.top_p,
                        stream=True,  # 启用流式
                    )

                    for chunk in stream_response:
                        if chunk.choices and chunk.choices[0].delta.content:
                            content = chunk.choices[0].delta.content
                            # 清理 DeepSeek 内部标签
                            content = _clean_deepseek_internal_tags(content)
                            if content:
                                yield content

                except Exception as e:
                    logger.error(f"[SubAgent-Stream] 流式输出失败: {e}")
                    # 降级为非流式
                    if last_assistant_content:
                        yield _clean_deepseek_internal_tags(last_assistant_content)

                logger.info("[SubAgent-Stream] 流式输出完成")
                return

            # 有工具调用，发送状态更新
            # 记录 assistant 消息（包含工具调用）
            sub_messages.append(
                {
                    "role": "assistant",
                    "content": assistant_message.content,
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": tc.type,
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in tool_calls
                    ],
                }
            )

            # 执行每个工具调用
            for tool_call in tool_calls:
                function = tool_call.function
                tool_name = function.name

                # 发送工具调用状态（使用前端识别的格式）
                # 前端 parseAgentContent 识别的关键词：搜索中、分析中、整理中、查看中、阅读中、查目录
                status_text = self._get_tool_status_text(tool_name)
                yield f"\n{status_text}\n"

                try:
                    args = json.loads(function.arguments)
                except json.JSONDecodeError:
                    args = {}

                logger.info(f"  [工具调用] {tool_name} 参数={args}")

                # 执行工具
                try:
                    output = self.executor.execute(tool_name, **args)
                    logger.info(f"  [工具结果] 长度={len(output)}")
                except Exception as e:
                    logger.error(f"  [工具错误] {e}")
                    output = f"工具执行失败: {str(e)}"

                # 记录工具结果
                sub_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": output,
                    }
                )

        # 达到最大迭代次数
        logger.warning(f"[SubAgent-Stream] 达到最大轮次 {max_turns}")

        if last_assistant_content:
            yield "\n\n"
            yield _clean_deepseek_internal_tags(last_assistant_content)
        else:
            yield "\n\n⚠️ 达到最大搜索轮次，未能完成完整分析。请尝试简化您的问题。"

    def _get_tool_status_text(self, tool_name: str) -> str:
        """
        获取工具的状态文本（用于前端状态显示）

        前端 parseAgentContent 识别的关键词：
        - 搜索中、分析中、整理中、查看中、阅读中、查目录

        Args:
            tool_name: 工具名称

        Returns:
            前端可识别的状态文本
        """
        status_map = {
            "inspect_toc": "🔍 *查目录中*",
            "hybrid_search": "🔎 *搜索中*",
            "read_page": "📖 *阅读中*",
        }
        return status_map.get(tool_name, "⚙️ *处理中*")
