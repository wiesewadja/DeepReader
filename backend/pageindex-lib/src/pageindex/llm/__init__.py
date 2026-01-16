"""
PageIndex LLM 抽象层模块

本模块提供统一的 LLM 调用接口，支持多种 Provider 和自动重试机制。

主要组件:
    - client: UnifiedLLM 客户端 (统一接口)
    - providers: LLM Provider 实现 (OpenAI, DeepSeek, Google, Custom)
    - retry: 重试逻辑和策略

支持的功能:
    - 同步和异步 LLM 调用
    - 自动重试 (指数退避)
    - 详细的日志记录
    - 上下文跟踪
    - 异常处理 (抛出 LLMError 而非返回 "Error" 字符串)

使用示例:
    >>> from pageindex.llm import UnifiedLLM, get_provider
    >>>
    >>> # 创建 Provider
    >>> provider = get_provider({"type": "openai", "api_key": "..."})
    >>>
    >>> # 创建 UnifiedLLM 客户端
    >>> llm_client = UnifiedLLM(provider=provider, model="gpt-4o")
    >>>
    >>> # 同步调用
    >>> response = llm_client.chat("Hello, world!")
    >>>
    >>> # 异步调用
    >>> response = await llm_client.chat_async("Hello, world!")
    >>>
    >>> # 带上下文的调用
    >>> llm_client.push_context("文档索引")
    >>> response = llm_client.chat("分析这段文本", context="章节分析")
    >>> llm_client.pop_context()

异常处理:
    所有 LLM 调用失败时抛出 LLMError 异常，不再返回 "Error" 字符串。

    >>> from pageindex.core import LLMError
    >>> try:
    ...     response = llm_client.chat("...")
    ... except LLMError as e:
    ...     logger.error(f"LLM 调用失败: {e}")
    ...     logger.error(f"已重试 {e.retry_count} 次")

作者: DeepPDF Team
创建时间: 2026-01-16
"""

from .client import UnifiedLLM
from .providers import (
    LLMProvider,
    LLMProviderFactory,
    OpenAIProvider,
    DeepSeekProvider,
    GoogleProvider,
    CustomProvider,
    get_provider,
)

__all__ = [
    # 核心客户端
    "UnifiedLLM",
    # Provider 类
    "LLMProvider",
    "OpenAIProvider",
    "DeepSeekProvider",
    "GoogleProvider",
    "CustomProvider",
    "LLMProviderFactory",
    # 便捷函数
    "get_provider",
]
