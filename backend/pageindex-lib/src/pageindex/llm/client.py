"""
PageIndex LLM 客户端模块

本模块提供统一的 LLM 调用接口，包含重试逻辑、日志记录和异常处理。

主要改进:
    - 不再返回 "Error" 字符串，而是抛出 LLMError 异常
    - 详细的日志记录 (请求、响应、错误)
    - 上下文跟踪 (push_context/pop_context)
    - 自动重试 (指数退避)
    - 支持 sync 和 async 调用

使用示例:
    >>> from pageindex.llm import UnifiedLLM, get_provider
    >>> from pageindex.core import LLMError
    >>>
    >>> # 创建客户端
    >>> provider = get_provider({"type": "openai", "api_key": "..."})
    >>> llm_client = UnifiedLLM(provider=provider, model="gpt-4o")
    >>>
    >>> # 同步调用
    >>> try:
    ...     response = llm_client.chat("分析这段文本")
    ... except LLMError as e:
    ...     logger.error(f"LLM 调用失败: {e}")
    ...     logger.error(f"已重试 {e.retry_count} 次")
    >>>
    >>> # 异步调用
    >>> try:
    ...     response = await llm_client.chat_async("分析这段文本")
    ... except LLMError as e:
    ...     logger.error(f"异步调用失败: {e}")
    >>>
    >>> # 带上下文的调用
    >>> llm_client.push_context("文档索引")
    >>> response = llm_client.chat("...", context="章节分析")
    >>> llm_client.pop_context()

日志输出示例:
    [LLM请求 #1] 文档索引 | 章节分析
      - 模型: gpt-4o
      - 温度: 0
      - 消息数: 1
      - 估算请求 tokens: ~250
      - 提示词长度: 1000 字符
    [LLM响应 #1] 完成
      - 耗时: 2.34 秒
      - 响应长度: 500 字符
      - 估算响应 tokens: ~125

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import asyncio
import logging
import time
from typing import Optional, List, Tuple

from .providers import LLMProvider
from .retry import RetryPolicy, execute_with_retry, execute_with_retry_async
from ..core.exceptions import LLMError, RetryExhaustedError

logger = logging.getLogger(__name__)


class UnifiedLLM:
    """
    统一的 LLM 客户端

    提供统一的接口调用各种 LLM Provider，支持自动重试和异常处理。

    属性:
        provider: LLM Provider 实例
        model: 模型名称
        max_retries: 最大重试次数

    重试策略:
        - 网络错误: 指数退避 (1, 2, 4, 8, 10 秒)
        - 其他错误: 固定 1 秒延迟

    异常处理:
        - 不再返回 "Error" 字符串
        - 所有失败都抛出 LLMError 或 RetryExhaustedError

    使用示例:
        >>> provider = get_provider({"type": "openai", "api_key": "..."})
        >>> llm_client = UnifiedLLM(provider=provider, model="gpt-4o")
        >>>
        >>> # 基本调用
        >>> response = llm_client.chat("Hello, world!")
        >>>
        >>> # 异步调用
        >>> response = await llm_client.chat_async("Hello, world!")
        >>>
        >>> # 带对话历史
        >>> history = [
        ...     {"role": "user", "content": "你好"},
        ...     {"role": "assistant", "content": "你好！"}
        ... ]
        >>> response = llm_client.chat("How are you?", chat_history=history)
    """

    def __init__(
        self,
        provider: LLMProvider,
        model: str,
        max_retries: int = 10,
    ):
        """
        初始化 UnifiedLLM 客户端

        参数:
            provider: LLM Provider 实例
            model: 模型名称
            max_retries: 最大重试次数 (默认 10)

        异常:
            ValueError: 如果参数无效
        """
        if not isinstance(provider, LLMProvider):
            raise ValueError(
                f"provider 必须是 LLMProvider 实例，"
                f"实际类型: {type(provider).__name__}"
            )

        if not model or not isinstance(model, str):
            raise ValueError(
                f"model 必须是非空字符串，实际值: {model}"
            )

        self.provider = provider
        self.model = model
        self.max_retries = max_retries

        # 内部状态
        self._call_counter = 0  # 调用计数器
        self._context_stack = []  # 上下文栈

        logger.debug(
            f"UnifiedLLM 初始化: model={model}, "
            f"provider={type(provider).__name__}, max_retries={max_retries}"
        )

    # ============================================================
    # 上下文管理
    # ============================================================

    def push_context(self, context: str):
        """
        推入上下文信息到栈中

        上下文用于在日志中标识当前操作的类型，便于调试和追踪。

        参数:
            context: 上下文描述 (如 "文档索引", "章节分析", "目录提取")

        使用示例:
            >>> llm_client.push_context("文档索引")
            >>> llm_client.push_context("章节分析")
            >>> # 日志会显示: [LLM请求 #1] 文档索引 | 章节分析
        """
        if context:
            self._context_stack.append(context)
            logger.debug(f"推入上下文: {context} (栈深度: {len(self._context_stack)})")

    def pop_context(self):
        """
        弹出最近推入的上下文信息

        使用示例:
            >>> llm_client.push_context("文档索引")
            >>> llm_client.push_context("章节分析")
            >>> llm_client.pop_context()  # 弹出 "章节分析"
            >>> # 日志现在只显示: [LLM请求 #1] 文档索引
        """
        if self._context_stack:
            context = self._context_stack.pop()
            logger.debug(f"弹出上下文: {context} (栈深度: {len(self._context_stack)})")

    def clear_context(self):
        """
        清空所有上下文信息

        使用示例:
            >>> llm_client.clear_context()
        """
        self._context_stack.clear()
        logger.debug("清空所有上下文")

    def _get_context_str(self) -> str:
        """
        获取当前上下文字符串

        返回:
            所有上下文连接而成的字符串，用 " | " 分隔
        """
        if self._context_stack:
            return " | ".join(self._context_stack)
        return ""

    # ============================================================
    # 日志记录
    # ============================================================

    def _log_request(
        self,
        messages: List[dict],
        temperature: float,
        call_type: str = "chat",
        context: Optional[str] = None,
    ) -> Tuple[int, float]:
        """
        记录请求详情

        参数:
            messages: 消息列表
            temperature: 温度参数
            call_type: 调用类型 (用于日志)
            context: 额外的上下文信息

        返回:
            (调用 ID, 开始时间)
        """
        self._call_counter += 1
        call_id = self._call_counter

        # 合并上下文
        all_contexts = []
        if self._context_stack:
            all_contexts.extend(self._context_stack)
        if context:
            all_contexts.append(context)

        context_str = " | ".join(all_contexts) if all_contexts else ""

        # 计算请求 token 数 (粗略估算)
        total_chars = sum(len(str(msg.get("content", ""))) for msg in messages)
        estimated_tokens = total_chars // 4

        # 记录日志
        if context_str:
            logging.info(f"[LLM请求 #{call_id}] {context_str}")
        else:
            logging.info(f"[LLM请求 #{call_id}] {call_type.upper()}")

        logging.info(f"  - 模型: {self.model}")
        logging.info(f"  - 温度: {temperature}")
        logging.info(f"  - 消息数: {len(messages)}")
        logging.info(f"  - 估算请求 tokens: ~{estimated_tokens}")
        logging.info(f"  - 提示词长度: {total_chars} 字符")

        # 显示第一条消息预览
        if messages:
            first_msg_content = str(messages[0].get("content", ""))
            preview = first_msg_content[:200]
            if len(first_msg_content) > 200:
                preview += "..."
            logging.debug(f"  - 提示词预览: {preview}")

        return call_id, time.time()

    def _log_response(self, content: str, start_time: float, call_id: int) -> float:
        """
        记录响应详情

        参数:
            content: 响应内容
            start_time: 请求开始时间
            call_id: 调用 ID

        返回:
            耗时 (秒)
        """
        elapsed = time.time() - start_time

        # 计算响应 token 数
        response_chars = len(content)
        estimated_tokens = response_chars // 4

        logging.info(f"[LLM响应 #{call_id}] 完成")
        logging.info(f"  - 耗时: {elapsed:.2f} 秒")
        logging.info(f"  - 响应长度: {response_chars} 字符")
        logging.info(f"  - 估算响应 tokens: ~{estimated_tokens}")

        # 显示响应预览
        preview = content[:300]
        if len(content) > 300:
            preview += "..."
        logging.debug(f"  - 响应内容预览: {preview}")

        return elapsed

    # ============================================================
    # 同步调用
    # ============================================================

    def chat(
        self,
        prompt: str,
        chat_history: Optional[List[dict]] = None,
        temperature: float = 0,
        context: Optional[str] = None,
    ) -> str:
        """
        同步调用 LLM

        参数:
            prompt: 用户提示词
            chat_history: 对话历史 (可选)
                格式: [{"role": "...", "content": "..."}]
            temperature: 温度参数 (0-2，默认 0)
            context: 额外的上下文信息 (用于日志)

        返回:
            LLM 响应文本

        异常:
            RetryExhaustedError: 达到最大重试次数后仍然失败
            LLMError: 其他 LLM 调用错误

        使用示例:
            >>> # 基本调用
            >>> response = llm_client.chat("Hello, world!")
            >>>
            >>> # 带对话历史
            >>> history = [
            ...     {"role": "user", "content": "你好"},
            ...     {"role": "assistant", "content": "你好！"}
            ... ]
            >>> response = llm_client.chat("How are you?", chat_history=history)
            >>>
            >>> # 带上下文
            >>> response = llm_client.chat("分析文本", context="文档索引")
        """
        # 构建消息列表
        if chat_history:
            messages = chat_history.copy()
            messages.append({"role": "user", "content": prompt})
        else:
            messages = [{"role": "user", "content": prompt}]

        # 记录请求
        call_id, start_time = self._log_request(messages, temperature, "chat", context)

        # 创建重试策略
        policy = RetryPolicy(max_retries=self.max_retries)

        # 定义要执行的函数
        def _do_chat():
            return self.provider.chat(self.model, messages, temperature)

        try:
            # 执行带重试的调用
            response = execute_with_retry(
                _do_chat,
                policy=policy,
                call_id=call_id,
                prompt=prompt,
            )

            # 记录响应
            self._log_response(response, start_time, call_id)
            return response

        except RetryExhaustedError:
            # 重试耗尽，直接抛出
            raise

    def chat_with_finish_reason(
        self,
        prompt: str,
        chat_history: Optional[List[dict]] = None,
        temperature: float = 0,
        context: Optional[str] = None,
    ) -> Tuple[str, str]:
        """
        同步调用 LLM，返回 finish_reason

        与 chat() 类似，但额外返回 finish_reason。
        目前所有成功调用都返回 "finished"。

        参数:
            prompt: 用户提示词
            chat_history: 对话历史 (可选)
            temperature: 温度参数
            context: 额外的上下文信息

        返回:
            (响应文本, finish_reason)

        异常:
            RetryExhaustedError: 达到最大重试次数后仍然失败

        使用示例:
            >>> response, reason = llm_client.chat_with_finish_reason("Hello")
            >>> print(f"响应: {response}, 原因: {reason}")
        """
        # 使用 chat() 方法，目前所有成功都是 "finished"
        response = self.chat(prompt, chat_history, temperature, context)
        return response, "finished"

    # ============================================================
    # 异步调用
    # ============================================================

    async def chat_async(
        self,
        prompt: str,
        temperature: float = 0,
        context: Optional[str] = None,
    ) -> str:
        """
        异步调用 LLM

        参数:
            prompt: 用户提示词
            temperature: 温度参数 (默认 0)
            context: 额外的上下文信息

        返回:
            LLM 响应文本

        异常:
            RetryExhaustedError: 达到最大重试次数后仍然失败

        使用示例:
            >>> response = await llm_client.chat_async("分析这段文本")
        """
        messages = [{"role": "user", "content": prompt}]

        # 记录请求
        call_id, start_time = self._log_request(messages, temperature, "chat_async", context)

        # 创建重试策略
        policy = RetryPolicy(max_retries=self.max_retries)

        # 定义要执行的异步函数
        async def _do_chat_async():
            return await self.provider.chat_async(self.model, messages, temperature)

        try:
            # 执行带重试的异步调用
            response = await execute_with_retry_async(
                _do_chat_async,
                policy=policy,
                call_id=call_id,
                prompt=prompt,
            )

            # 记录响应
            self._log_response(response, start_time, call_id)
            return response

        except RetryExhaustedError:
            # 重试耗尽，直接抛出
            raise

    async def chat_with_finish_reason_async(
        self,
        prompt: str,
        chat_history: Optional[List[dict]] = None,
        temperature: float = 0,
        context: Optional[str] = None,
    ) -> Tuple[str, str]:
        """
        异步调用 LLM，返回 finish_reason

        与 chat_async() 类似，但支持对话历史并返回 finish_reason。

        参数:
            prompt: 用户提示词
            chat_history: 对话历史 (可选)
            temperature: 温度参数
            context: 额外的上下文信息

        返回:
            (响应文本, finish_reason)

        异常:
            RetryExhaustedError: 达到最大重试次数后仍然失败

        使用示例:
            >>> response, reason = await llm_client.chat_with_finish_reason_async("Hello")
        """
        # 构建消息列表
        if chat_history:
            messages = chat_history.copy()
            messages.append({"role": "user", "content": prompt})
        else:
            messages = [{"role": "user", "content": prompt}]

        # 记录请求
        call_id, start_time = self._log_request(
            messages, temperature, "chat_with_finish_reason_async", context
        )

        # 创建重试策略
        policy = RetryPolicy(max_retries=self.max_retries)

        # 定义要执行的异步函数
        async def _do_chat_async():
            return await self.provider.chat_async(self.model, messages, temperature)

        try:
            # 执行带重试的异步调用
            response = await execute_with_retry_async(
                _do_chat_async,
                policy=policy,
                call_id=call_id,
                prompt=prompt,
            )

            # 记录响应
            self._log_response(response, start_time, call_id)
            return response, "finished"

        except RetryExhaustedError:
            # 重试耗尽，直接抛出
            raise
