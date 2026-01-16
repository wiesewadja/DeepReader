"""
PageIndex LLM 重试策略模块

本模块提供 LLM 调用的重试逻辑和策略。

主要功能:
    - 指数退避重试
    - 网络错误检测
    - 最大重试次数控制
    - 超时处理

重试策略:
    - 网络错误: 指数退避 (1, 2, 4, 8, 10 秒)
    - 其他错误: 固定 1 秒延迟

网络错误检测:
    检测以下关键词: connection, timeout, network, temporarily, unreachable

使用示例:
    >>> from pageindex.llm.retry import RetryPolicy, execute_with_retry
    >>> from pageindex.core import LLMError
    >>>
    >>> # 创建重试策略
    >>> policy = RetryPolicy(max_retries=5, base_delay=1.0, max_delay=10.0)
    >>>
    >>> # 执行带重试的操作
    >>> try:
    ...     result = await execute_with_retry(
    ...         lambda: some_llm_call(),
    ...         policy=policy,
    ...         call_id=1,
    ...         prompt="..."
    ...     )
    ... except LLMError as e:
    ...     logger.error(f"调用失败: {e}")

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Callable, Awaitable, TypeVar, Union

from ..core.exceptions import LLMError, RetryExhaustedError

logger = logging.getLogger(__name__)

T = TypeVar("T")


@dataclass
class RetryPolicy:
    """
    重试策略配置

    属性:
        max_retries: 最大重试次数
        base_delay: 基础延迟时间 (秒)
        max_delay: 最大延迟时间 (秒)
        exponential_backoff: 是否使用指数退避

    使用示例:
        >>> policy = RetryPolicy(max_retries=3, base_delay=1.0)
        >>> print(policy.max_retries)
        3
    """
    max_retries: int = 10
    base_delay: float = 1.0
    max_delay: float = 10.0
    exponential_backoff: bool = True


def is_network_error(error: Exception) -> bool:
    """
    检测错误是否为网络相关错误

    通过检查错误消息中的关键词来判断是否为网络错误。

    参数:
        error: 异常对象

    返回:
        如果是网络错误返回 True，否则返回 False

    检测的关键词:
        - connection: 连接错误
        - timeout: 超时错误
        - network: 网络错误
        - temporarily: 临时错误
        - unreachable: 无法访问

    使用示例:
        >>> try:
        ...     client.call()
        ... except Exception as e:
        ...     if is_network_error(e):
        ...         print("网络错误，将重试")
    """
    error_msg = str(error).lower()
    network_keywords = [
        "connection",
        "timeout",
        "network",
        "temporarily",
        "unreachable",
    ]
    return any(keyword in error_msg for keyword in network_keywords)


def calculate_delay(attempt: int, policy: RetryPolicy, is_network: bool) -> float:
    """
    计算重试延迟时间

    根据重试策略和错误类型计算延迟时间。
    网络错误使用指数退避，其他错误使用固定延迟。

    参数:
        attempt: 当前尝试次数 (从 1 开始)
        policy: 重试策略
        is_network: 是否为网络错误

    返回:
        延迟时间 (秒)

    延迟计算:
        - 网络错误 + 指数退避: min(base_delay * 2^(attempt-1), max_delay)
        - 其他错误: base_delay

    使用示例:
        >>> policy = RetryPolicy(base_delay=1.0, max_delay=10.0)
        >>> delay = calculate_delay(2, policy, is_network=True)
        >>> print(f"延迟 {delay} 秒")
        延迟 2.0 秒
    """
    if is_network and policy.exponential_backoff:
        # 指数退避: base_delay * 2^(attempt-1)，但不超过 max_delay
        delay = min(policy.base_delay * (2 ** (attempt - 1)), policy.max_delay)
    else:
        # 固定延迟
        delay = policy.base_delay

    return delay


async def execute_with_retry_async(
    func: Callable[[], Awaitable[T]],
    policy: RetryPolicy,
    call_id: int,
    prompt: str = "",
) -> T:
    """
    异步执行带重试的操作

    这是一个异步版本的 execute_with_retry，适用于异步 LLM 调用。

    参数:
        func: 要执行的异步函数
        policy: 重试策略
        call_id: 调用 ID (用于日志)
        prompt: 提示词 (用于错误日志)

    返回:
        函数执行结果

    异常:
        RetryExhaustedError: 达到最大重试次数后仍然失败

    使用示例:
        >>> async def my_llm_call():
        ...     return await client.chat_async("...")
        >>>
        >>> try:
        ...     result = await execute_with_retry_async(
        ...         my_llm_call,
        ...         policy=RetryPolicy(max_retries=3),
        ...         call_id=1
        ...     )
        ... except RetryExhaustedError as e:
        ...     logger.error(f"调用失败: {e}")
    """
    last_error = None

    for attempt in range(1, policy.max_retries + 1):
        try:
            # 尝试执行函数
            return await func()

        except Exception as e:
            last_error = e
            is_network = is_network_error(e)

            # 记录错误
            logger.error(f"[LLM错误 #{call_id}] 尝试 {attempt}/{policy.max_retries}")
            logger.error(f"  - 错误类型: {type(e).__name__}")
            logger.error(f"  - 错误信息: {str(e)}")

            # 检查是否需要重试
            if attempt < policy.max_retries:
                delay = calculate_delay(attempt, policy, is_network)
                logger.error(
                    f"  - {'网络' if is_network else '其他'}错误，"
                    f"等待 {delay} 秒后重试..."
                )
                await asyncio.sleep(delay)
            else:
                # 达到最大重试次数
                logger.error(f"[LLM失败 #{call_id}] 达到最大重试次数，放弃")
                if prompt:
                    logger.error(f"  - 提示词: {prompt[:100]}...")

    # 所有重试都失败，抛出异常
    raise RetryExhaustedError(
        f"LLM 调用失败，已重试 {policy.max_retries} 次",
        retry_count=policy.max_retries,
        last_error=str(last_error),
        request_type="async",
        original_error=last_error,
    )


def execute_with_retry(
    func: Callable[[], T],
    policy: RetryPolicy,
    call_id: int,
    prompt: str = "",
) -> T:
    """
    同步执行带重试的操作

    执行同步函数，如果失败则按照重试策略进行重试。

    参数:
        func: 要执行的同步函数
        policy: 重试策略
        call_id: 调用 ID (用于日志)
        prompt: 提示词 (用于错误日志)

    返回:
        函数执行结果

    异常:
        RetryExhaustedError: 达到最大重试次数后仍然失败

    使用示例:
        >>> def my_llm_call():
        ...     return client.chat("...")
        >>>
        >>> try:
        ...     result = execute_with_retry(
        ...         my_llm_call,
        ...         policy=RetryPolicy(max_retries=3),
        ...         call_id=1
        ...     )
        ... except RetryExhaustedError as e:
        ...     logger.error(f"调用失败: {e}")
    """
    last_error = None

    for attempt in range(1, policy.max_retries + 1):
        try:
            # 尝试执行函数
            return func()

        except Exception as e:
            last_error = e
            is_network = is_network_error(e)

            # 记录错误
            logger.error(f"[LLM错误 #{call_id}] 尝试 {attempt}/{policy.max_retries}")
            logger.error(f"  - 错误类型: {type(e).__name__}")
            logger.error(f"  - 错误信息: {str(e)}")

            # 检查是否需要重试
            if attempt < policy.max_retries:
                delay = calculate_delay(attempt, policy, is_network)
                logger.error(
                    f"  - {'网络' if is_network else '其他'}错误，"
                    f"等待 {delay} 秒后重试..."
                )
                time.sleep(delay)
            else:
                # 达到最大重试次数
                logger.error(f"[LLM失败 #{call_id}] 达到最大重试次数，放弃")
                if prompt:
                    logger.error(f"  - 提示词: {prompt[:100]}...")

    # 所有重试都失败，抛出异常
    raise RetryExhaustedError(
        f"LLM 调用失败，已重试 {policy.max_retries} 次",
        retry_count=policy.max_retries,
        last_error=str(last_error),
        request_type="sync",
        original_error=last_error,
    )
