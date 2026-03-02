"""
LLM 客户端工厂模块
提供统一的 LLM 客户端创建和管理
"""

import logging
from typing import Optional, Tuple

from openai import OpenAI

from deeppdf.config import settings

logger = logging.getLogger(__name__)

# 客户端缓存
_client_cache: dict = {}


def get_llm_client(
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    model: Optional[str] = None,
    use_cache: bool = True,
) -> Tuple[OpenAI, str]:
    """
    获取 LLM 客户端

    Args:
        provider: LLM 提供商 (deepseek/openai)，默认使用 settings.llm_provider
        api_key: API 密钥，默认从 settings 获取
        base_url: API 基础 URL，默认从 settings 获取
        model: 模型名称，默认使用 settings.llm_model
        use_cache: 是否使用缓存的客户端

    Returns:
        (OpenAI 客户端, 模型名称) 元组
    """
    # 确定提供商
    provider = provider or settings.llm_provider

    # 确定 API 密钥
    if not api_key:
        if provider == "deepseek":
            api_key = settings.deepseek_api_key
        else:
            api_key = settings.openai_api_key

    if not api_key:
        raise ValueError(f"No API key provided for provider: {provider}")

    # 确定基础 URL
    if not base_url:
        if provider == "deepseek":
            base_url = settings.llm_base_url or "https://api.deepseek.com"
        else:
            base_url = settings.llm_base_url

    # 确定模型
    model = model or settings.llm_model

    # 检查缓存
    cache_key = f"{provider}:{api_key[:8]}:{base_url}:{model}"
    if use_cache and cache_key in _client_cache:
        return _client_cache[cache_key]

    # 创建客户端
    client_kwargs = {"api_key": api_key}
    if base_url:
        client_kwargs["base_url"] = base_url

    client = OpenAI(**client_kwargs)

    # 缓存客户端
    if use_cache:
        _client_cache[cache_key] = (client, model)

    logger.debug(f"Created LLM client for provider={provider}, model={model}")
    return client, model


def get_ocr_client() -> Tuple[OpenAI, str]:
    """
    获取 OCR 专用客户端

    Returns:
        (OpenAI 客户端, 模型名称) 元组
    """
    api_key = settings.deepseek_ocr_api_key
    if not api_key:
        raise ValueError("No OCR API key configured (deepseek_ocr_api_key)")

    client = OpenAI(
        api_key=api_key,
        base_url=settings.deepseek_ocr_base_url,
    )

    return client, settings.deepseek_ocr_model


def clear_client_cache():
    """清除客户端缓存"""
    global _client_cache
    _client_cache = {}
    logger.debug("Cleared LLM client cache")


class LLMClientWrapper:
    """
    LLM 客户端包装类
    提供更便捷的调用接口
    """

    def __init__(
        self,
        provider: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2000,
    ):
        self.client, self.model = get_llm_client(
            provider=provider,
            api_key=api_key,
            base_url=base_url,
            model=model,
        )
        self.temperature = temperature
        self.max_tokens = max_tokens

    def chat(
        self,
        prompt: str,
        system_prompt: str = "你是一位专业的助手。",
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> str:
        """
        发送聊天请求

        Args:
            prompt: 用户提示
            system_prompt: 系统提示
            temperature: 温度参数
            max_tokens: 最大 token 数

        Returns:
            模型响应内容
        """
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            temperature=temperature or self.temperature,
            max_tokens=max_tokens or self.max_tokens,
        )

        return response.choices[0].message.content or ""

    def chat_with_history(
        self,
        messages: list,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> str:
        """
        发送带历史记录的聊天请求

        Args:
            messages: 消息列表
            temperature: 温度参数
            max_tokens: 最大 token 数

        Returns:
            模型响应内容
        """
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature or self.temperature,
            max_tokens=max_tokens or self.max_tokens,
        )

        return response.choices[0].message.content or ""
