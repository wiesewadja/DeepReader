"""
PageIndex LLM Provider 模块

本模块提供各种 LLM Provider 的实现，支持多种 LLM 服务。

支持的 Provider:
    - OpenAIProvider: OpenAI GPT 系列
    - DeepSeekProvider: DeepSeek API
    - GoogleProvider: Google Gemini
    - CustomProvider: 自定义 OpenAI 兼容 API

所有 Provider 实现相同的接口，可以无缝切换。

使用示例:
    >>> from pageindex.llm.providers import OpenAIProvider, get_provider
    >>>
    >>> # 方式1: 直接创建 Provider
    >>> provider = OpenAIProvider(api_key="...")
    >>> response = provider.chat("gpt-4o", [{"role": "user", "content": "Hello"}])
    >>>
    >>> # 方式2: 使用工厂函数
    >>> config = {"type": "openai", "api_key": "..."}
    >>> provider = get_provider(config)
    >>>
    >>> # 方式3: 自定义 Provider
    >>> config = {
    ...     "type": "custom",
    ...     "base_url": "https://api.example.com",
    ...     "api_key": "...",
    ...     "model_param": "model"
    ... }
    >>> provider = get_provider(config)

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from typing import Optional

import openai
import os
from dotenv import load_dotenv

load_dotenv()

# 支持 CHATGPT_API_KEY（向后兼容）和 OPENAI_API_KEY（更通用）
CHATGPT_API_KEY = os.getenv("CHATGPT_API_KEY") or os.getenv("OPENAI_API_KEY")

# 可选依赖
try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None
    types = None

try:
    from openai import OpenAI as DeepSeekClient
except ImportError:
    DeepSeekClient = None

logger = logging.getLogger(__name__)


# ============================================================
# 抽象基类
# ============================================================

class LLMProvider(ABC):
    """
    LLM Provider 抽象基类

    定义了所有 Provider 必须实现的接口。

    使用示例:
        >>> class MyProvider(LLMProvider):
        ...     def chat(self, model, messages, temperature=0):
        ...         # 实现同步调用
        ...         pass
        ...
        ...     async def chat_async(self, model, messages, temperature=0):
        ...         # 实现异步调用
        ...         pass
    """

    @abstractmethod
    def chat(self, model: str, messages: list, temperature: float = 0) -> str:
        """
        同步调用 LLM

        参数:
            model: 模型名称
            messages: 消息列表，格式为 [{"role": "...", "content": "..."}]
            temperature: 温度参数 (0-2)

        返回:
            LLM 响应文本
        """
        pass

    @abstractmethod
    async def chat_async(
        self, model: str, messages: list, temperature: float = 0
    ) -> str:
        """
        异步调用 LLM

        参数:
            model: 模型名称
            messages: 消息列表，格式为 [{"role": "...", "content": "..."}]
            temperature: 温度参数 (0-2)

        返回:
            LLM 响应文本
        """
        pass


# ============================================================
# OpenAI Provider
# ============================================================

class OpenAIProvider(LLMProvider):
    """
    OpenAI API Provider

    支持 OpenAI GPT 系列模型，包括:
        - GPT-4: gpt-4, gpt-4-turbo, gpt-4o
        - GPT-3.5: gpt-3.5-turbo

    使用示例:
        >>> provider = OpenAIProvider(api_key="sk-...")
        >>> response = provider.chat("gpt-4o", [{"role": "user", "content": "Hello"}])
        >>>
        >>> # 使用自定义 base_url (兼容其他 OpenAI 格式 API)
        >>> provider = OpenAIProvider(api_key="...", base_url="https://api.example.com")
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 300.0,
    ):
        """
        初始化 OpenAI Provider

        参数:
            api_key: OpenAI API 密钥 (可选，默认使用环境变量)
            base_url: API 基础 URL (可选，用于兼容其他服务)
            timeout: 请求超时时间 (秒，默认 300)
        """
        self.api_key = api_key or CHATGPT_API_KEY
        self.base_url = base_url
        self.timeout = timeout

        logger.debug(
            f"OpenAIProvider 初始化: base_url={base_url}, timeout={timeout}"
        )

    def chat(self, model: str, messages: list, temperature: float = 0) -> str:
        """同步调用 OpenAI API"""
        client = openai.OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=self.timeout
        )
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
        )
        return response.choices[0].message.content

    async def chat_async(
        self, model: str, messages: list, temperature: float = 0
    ) -> str:
        """异步调用 OpenAI API"""
        async with openai.AsyncOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=self.timeout
        ) as client:
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
            )
            return response.choices[0].message.content


# ============================================================
# DeepSeek Provider
# ============================================================

class DeepSeekProvider(LLMProvider):
    """
    DeepSeek API Provider

    DeepSeek 提供高性价比的 LLM 服务，使用 OpenAI 兼容的 API 格式。

    使用示例:
        >>> provider = DeepSeekProvider(api_key="sk-...")
        >>> response = provider.chat("deepseek-chat", [{"role": "user", "content": "Hello"}])
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 300.0,
    ):
        """
        初始化 DeepSeek Provider

        参数:
            api_key: DeepSeek API 密钥
            base_url: API 基础 URL (默认 https://api.deepseek.com)
            timeout: 请求超时时间 (秒，默认 300)
        """
        self.base_url = base_url or "https://api.deepseek.com"
        self.api_key = api_key
        self.timeout = timeout

        logger.debug(
            f"DeepSeekProvider 初始化: base_url={self.base_url}, timeout={timeout}"
        )

    def chat(self, model: str, messages: list, temperature: float = 0) -> str:
        """同步调用 DeepSeek API"""
        client = openai.OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=self.timeout
        )
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
        )
        return response.choices[0].message.content

    async def chat_async(
        self, model: str, messages: list, temperature: float = 0
    ) -> str:
        """异步调用 DeepSeek API (使用线程池执行器)"""
        client = openai.OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=self.timeout
        )
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
            ),
        )
        return response.choices[0].message.content


# ============================================================
# Google Provider
# ============================================================

class GoogleProvider(LLMProvider):
    """
    Google Gemini API Provider

    支持 Google Gemini 系列模型。

    使用示例:
        >>> provider = GoogleProvider(api_key="...")
        >>> response = provider.chat("gemini-pro", [{"role": "user", "content": "Hello"}])
    """

    def __init__(self, api_key: Optional[str] = None):
        """
        初始化 Google Provider

        参数:
            api_key: Google API 密钥

        异常:
            ImportError: 如果 google-genai 未安装
        """
        self.api_key = api_key

        if genai is None:
            raise ImportError(
                "google-genai 未安装，请运行: pip install google-genai"
            )

        logger.debug("GoogleProvider 初始化")

    def chat(self, model: str, messages: list, temperature: float = 0) -> str:
        """同步调用 Google Gemini API"""
        client = genai.Client(api_key=self.api_key)
        response = client.models.generate_content(
            model=model,
            contents=messages,
            config=types.GenerateContentConfig(temperature=temperature),
        )
        return response.text

    async def chat_async(
        self, model: str, messages: list, temperature: float = 0
    ) -> str:
        """
        异步调用 Google Gemini API

        注意: Google API 不支持原生异步，使用线程池执行器包装
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None, self.chat, model, messages, temperature
        )


# ============================================================
# Custom Provider
# ============================================================

class CustomProvider(LLMProvider):
    """
    自定义 OpenAI 兼容 API Provider

    用于接入任何兼容 OpenAI API 格式的服务。

    使用示例:
        >>> provider = CustomProvider(
        ...     base_url="https://api.example.com",
        ...     api_key="sk-...",
        ...     model_param="model"  # 模型参数名称
        ... )
        >>> response = provider.chat("custom-model", [{"role": "user", "content": "Hello"}])
    """

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        model_param: str = "model",
        timeout: float = 300.0,
    ):
        """
        初始化自定义 Provider

        参数:
            base_url: API 基础 URL (必需)
            api_key: API 密钥 (可选)
            model_param: 模型参数名称 (默认 "model")
            timeout: 请求超时时间 (秒，默认 300)

        注意:
            model_param 用于兼容不同 API 的模型参数命名:
            - OpenAI 格式: "model"
            - 其他格式: 可能是 "model_id", "engine" 等
        """
        self.base_url = base_url
        self.api_key = api_key
        self.model_param = model_param
        self.timeout = timeout

        logger.info(
            f"[CustomProvider] 初始化: base_url={base_url}, "
            f"model_param={model_param}, timeout={timeout}"
        )

    def chat(self, model: str, messages: list, temperature: float = 0) -> str:
        """同步调用自定义 API"""
        logger.info(
            f"[CustomProvider] chat: 使用 base_url={self.base_url}, model={model}"
        )
        client = openai.OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=self.timeout
        )
        kwargs = {self.model_param: model}
        response = client.chat.completions.create(
            messages=messages,
            temperature=temperature,
            **kwargs
        )
        return response.choices[0].message.content

    async def chat_async(
        self, model: str, messages: list, temperature: float = 0
    ) -> str:
        """异步调用自定义 API (使用线程池执行器)"""
        client = openai.OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=self.timeout
        )
        kwargs = {self.model_param: model}
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: client.chat.completions.create(
                messages=messages,
                temperature=temperature,
                **kwargs
            ),
        )
        return response.choices[0].message.content


# ============================================================
# Provider 工厂
# ============================================================

class LLMProviderFactory:
    """
    LLM Provider 工厂类

    用于创建和管理各种 Provider 实例。

    支持的 Provider 类型:
        - openai: OpenAIProvider
        - deepseek: DeepSeekProvider
        - google: GoogleProvider
        - custom: CustomProvider

    使用示例:
        >>> # 创建 OpenAI Provider
        >>> provider = LLMProviderFactory.create("openai", api_key="...")
        >>>
        >>> # 注册自定义 Provider
        >>> class MyProvider(LLMProvider):
        ...     ...
        >>> LLMProviderFactory.register("myprovider", MyProvider)
        >>> provider = LLMProviderFactory.create("myprovider")
    """

    _providers = {
        "openai": OpenAIProvider,
        "google": GoogleProvider,
        "deepseek": DeepSeekProvider,
        "custom": CustomProvider,
    }

    @classmethod
    def create(cls, provider: str, **kwargs) -> LLMProvider:
        """
        创建 Provider 实例

        参数:
            provider: Provider 类型名称
            **kwargs: Provider 初始化参数

        返回:
            Provider 实例

        异常:
            ValueError: 如果 Provider 类型不存在

        使用示例:
            >>> provider = LLMProviderFactory.create(
            ...     "openai",
            ...     api_key="sk-...",
            ...     timeout=60.0
            ... )
        """
        if provider not in cls._providers:
            raise ValueError(
                f"未知的 Provider 类型: {provider}，"
                f"支持的类型: {list(cls._providers.keys())}"
            )
        return cls._providers[provider](**kwargs)

    @classmethod
    def register(cls, name: str, provider_class: type):
        """
        注册自定义 Provider

        参数:
            name: Provider 类型名称
            provider_class: Provider 类 (必须继承自 LLMProvider)

        使用示例:
            >>> class MyProvider(LLMProvider):
            ...     def chat(self, model, messages, temperature=0):
            ...         return "..."
            ...     async def chat_async(self, model, messages, temperature=0):
            ...         return "..."
            >>>
            >>> LLMProviderFactory.register("myprovider", MyProvider)
            >>> provider = LLMProviderFactory.create("myprovider")
        """
        cls._providers[name] = provider_class
        logger.info(f"注册自定义 Provider: {name}")


def get_provider(provider_config) -> LLMProvider:
    """
    从配置创建 Provider 实例

    这是一个便捷函数，用于从配置对象或字典创建 Provider。

    参数:
        provider_config: Provider 配置
            - 支持 dict: {"type": "openai", "api_key": "..."}
            - 支持 SimpleNamespace: config(type="openai", api_key="...")

    返回:
        Provider 实例

    配置格式:
        OpenAI:
            {"type": "openai", "api_key": "...", "base_url": "..."}

        DeepSeek:
            {"type": "deepseek", "api_key": "...", "base_url": "..."}

        Google:
            {"type": "google", "api_key": "..."}

        Custom:
            {"type": "custom", "base_url": "...", "api_key": "...", "model_param": "model"}

    使用示例:
        >>> # 方式1: 使用字典
        >>> config = {"type": "openai", "api_key": "sk-..."}
        >>> provider = get_provider(config)
        >>>
        >>> # 方式2: 使用 SimpleNamespace
        >>> from types import SimpleNamespace as config
        >>> cfg = config(type="openai", api_key="sk-...")
        >>> provider = get_provider(cfg)
    """
    # 获取 Provider 类型
    if hasattr(provider_config, "get"):
        provider_type = provider_config.get("type", "openai")
    else:
        provider_type = getattr(provider_config, "type", "openai")

    # 构建工厂参数
    factory_kwargs = {}

    # 处理 custom Provider 的特殊参数
    if provider_type == "custom":
        base_url = (
            provider_config.get("base_url")
            if hasattr(provider_config, "get")
            else getattr(provider_config, "base_url", None)
        )
        model_param = (
            provider_config.get("model_param", "model")
            if hasattr(provider_config, "get")
            else getattr(provider_config, "model_param", "model")
        )
        factory_kwargs["base_url"] = base_url
        factory_kwargs["model_param"] = model_param
    else:
        base_url = (
            provider_config.get("base_url")
            if hasattr(provider_config, "get")
            else getattr(provider_config, "base_url", None)
        )
        factory_kwargs["base_url"] = base_url

    # 获取 API 密钥
    api_key = (
        provider_config.get("api_key")
        if hasattr(provider_config, "get")
        else getattr(provider_config, "api_key", None)
    )
    factory_kwargs["api_key"] = api_key

    # 创建 Provider
    return LLMProviderFactory.create(provider_type, **factory_kwargs)
