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
from typing import Optional, List

import openai
import os
from dotenv import load_dotenv

load_dotenv()

# 支持 CHATGPT_API_KEY（向后兼容）和 OPENAI_API_KEY（更通用）
CHATGPT_API_KEY = os.getenv("CHATGPT_API_KEY") or os.getenv("OPENAI_API_KEY")

# SiliconFlow API Key（用于多 Provider 并行）
SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY")

# 智谱 API Key（用于多 Provider 并行）
ZHIPU_API_KEY = os.getenv("ZHIPU_API_KEY")

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
        timeout: Optional[float] = None,
    ):
        """
        初始化 OpenAI Provider

        参数:
            api_key: OpenAI API 密钥 (可选，默认使用环境变量)
            base_url: API 基础 URL (可选，用于兼容其他服务)
            timeout: 请求超时时间 (秒，可选，默认从配置文件读取)
        """
        self.api_key = api_key or CHATGPT_API_KEY
        self.base_url = base_url

        # 从配置文件读取默认 timeout
        if timeout is None:
            try:
                from ..core.config import load_config
                config = load_config()
                timeout = getattr(config, "llm_timeout", 300)
            except Exception:
                timeout = 300

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
        timeout: Optional[float] = None,
    ):
        """
        初始化 DeepSeek Provider

        参数:
            api_key: DeepSeek API 密钥 (None 时从 DEEPSEEK_API_KEY 环境变量读取)
            base_url: API 基础 URL (默认 https://api.deepseek.com)
            timeout: 请求超时时间 (秒，可选，默认从配置文件读取)
        """
        self.base_url = base_url or "https://api.deepseek.com"

        # 从参数或环境变量获取 API Key
        if api_key is None:
            api_key = os.environ.get("DEEPSEEK_API_KEY")

        self.api_key = api_key

        # 从配置文件读取默认 timeout
        if timeout is None:
            try:
                from ..core.config import load_config
                config = load_config()
                timeout = getattr(config, "llm_timeout", 300)
            except Exception:
                timeout = 300

        self.timeout = timeout

        logger.debug(
            f"DeepSeekProvider 初始化: base_url={self.base_url}, api_key={'***' if self.api_key else 'None'}, timeout={timeout}"
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
# Multi Provider (负载均衡)
# ============================================================
# 注意: SiliconFlowProvider 和 ZhipuProvider 在 CustomProvider 之后定义

class MultiProvider(LLMProvider):
    """
    多 Provider 负载均衡器

    支持多个 LLM Provider 轮询和并行处理，实现负载均衡。
    每个 Provider 可以配置独立的模型名称。

    特性:
        - 轮询分发请求到不同的 Provider
        - 每个 Provider 使用自己的模型名称
        - 支持权重配置
        - 单个 Provider 失败不影响整体

    使用示例:
        >>> providers = [
        ...     DeepSeekProvider(api_key="..."),
        ...     SiliconFlowProvider(api_key="..."),
        ... ]
        >>> models = ["deepseek-chat", "deepseek-ai/DeepSeek-V3"]
        >>> multi = MultiProvider(providers, models=models)
        >>> # 调用时忽略传入的 model，使用 Provider 自己的模型
        >>> response = multi.chat("", [{"role": "user", "content": "Hello"}])
    """

    def __init__(
        self,
        providers: List[LLMProvider],
        weights: Optional[List[int]] = None,
        names: Optional[List[str]] = None,
        models: Optional[List[str]] = None,
    ):
        """
        初始化 MultiProvider

        参数:
            providers: Provider 实例列表
            weights: 各 Provider 的权重 (用于负载均衡)
            names: Provider 名称列表 (用于日志)
            models: 各 Provider 使用的模型名称列表
        """
        if not providers:
            raise ValueError("providers 列表不能为空")

        self.providers = providers
        self.weights = weights or [1] * len(providers)
        self.names = names or [f"Provider_{i}" for i in range(len(providers))]
        self.models = models or [""] * len(providers)  # 每个 Provider 的模型

        # 构建加权索引池
        self._weighted_indices = []
        for i, w in enumerate(self.weights):
            self._weighted_indices.extend([i] * w)

        self._current_index = 0
        self._lock = asyncio.Lock()  # 用于线程安全的轮询

        logger.info(
            f"[MultiProvider] 初始化完成: "
            f"{len(providers)} 个 Provider, 权重={self.weights}, 模型={self.models}"
        )

    def _get_next_provider_index(self) -> int:
        """获取下一个 Provider 索引（轮询）"""
        index = self._weighted_indices[self._current_index]
        self._current_index = (self._current_index + 1) % len(self._weighted_indices)
        return index

    async def _get_next_provider_index_async(self) -> int:
        """异步获取下一个 Provider 索引（线程安全）"""
        async with self._lock:
            return self._get_next_provider_index()

    def chat(self, model: str, messages: list, temperature: float = 0) -> str:
        """
        同步调用（使用下一个 Provider 及其配置的模型，失败时自动切换到下一个）

        注意: model 参数会被忽略，使用 Provider 配置的模型
        """
        # 记录已尝试的 Provider，避免重复尝试同一个
        tried_indices = set()
        last_error = None

        while len(tried_indices) < len(self.providers):
            idx = self._get_next_provider_index()

            # 如果已经尝试过这个 Provider，跳过
            if idx in tried_indices:
                continue

            tried_indices.add(idx)
            provider = self.providers[idx]
            provider_model = self.models[idx] or model

            logger.info(f"[MultiProvider] 尝试 {self.names[idx]} (model={provider_model})")

            try:
                return provider.chat(provider_model, messages, temperature)
            except Exception as e:
                last_error = e
                logger.warning(
                    f"[MultiProvider] {self.names[idx]} 失败: {type(e).__name__}: {str(e)[:100]}"
                )
                # 继续尝试下一个 Provider
                continue

        # 所有 Provider 都失败
        raise RuntimeError(
            f"[MultiProvider] 所有 {len(self.providers)} 个 Provider 都失败。"
            f"最后错误: {type(last_error).__name__}: {str(last_error)[:200]}"
        )

    async def chat_async(
        self, model: str, messages: list, temperature: float = 0
    ) -> str:
        """
        异步调用（使用下一个 Provider 及其配置的模型，失败时自动切换到下一个）

        注意: model 参数会被忽略，使用 Provider 配置的模型
        """
        # 记录已尝试的 Provider，避免重复尝试同一个
        tried_indices = set()
        last_error = None

        while len(tried_indices) < len(self.providers):
            idx = await self._get_next_provider_index_async()

            # 如果已经尝试过这个 Provider，跳过
            if idx in tried_indices:
                continue

            tried_indices.add(idx)
            provider = self.providers[idx]
            provider_model = self.models[idx] or model

            logger.info(f"[MultiProvider] 尝试 {self.names[idx]} (model={provider_model})")

            try:
                return await provider.chat_async(provider_model, messages, temperature)
            except Exception as e:
                last_error = e
                logger.warning(
                    f"[MultiProvider] {self.names[idx]} 失败: {type(e).__name__}: {str(e)[:100]}"
                )
                # 继续尝试下一个 Provider
                continue

        # 所有 Provider 都失败
        raise RuntimeError(
            f"[MultiProvider] 所有 {len(self.providers)} 个 Provider 都失败。"
            f"最后错误: {type(last_error).__name__}: {str(last_error)[:200]}"
        )

    def get_provider(self, index: int) -> LLMProvider:
        """获取指定索引的 Provider"""
        return self.providers[index]


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
        timeout: Optional[float] = None,
    ):
        """
        初始化自定义 Provider

        参数:
            base_url: API 基础 URL (必需)
            api_key: API 密钥 (可选)
            model_param: 模型参数名称 (默认 "model")
            timeout: 请求超时时间 (秒，可选，默认从配置文件读取)

        注意:
            model_param 用于兼容不同 API 的模型参数命名:
            - OpenAI 格式: "model"
            - 其他格式: 可能是 "model_id", "engine" 等
        """
        self.base_url = base_url
        self.api_key = api_key
        self.model_param = model_param

        # 从配置文件读取默认 timeout
        if timeout is None:
            try:
                from ..core.config import load_config
                config = load_config()
                timeout = getattr(config, "llm_timeout", 300)
            except Exception:
                timeout = 300

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
# SiliconFlow Provider
# ============================================================

class SiliconFlowProvider(CustomProvider):
    """
    硅基流动 API Provider

    硅基流动（SiliconFlow）提供多种开源模型的 API 服务，
    使用 OpenAI 兼容的 API 格式。

    支持的模型:
        - deepseek-ai/DeepSeek-V3
        - Qwen/Qwen2.5-72B-Instruct
        - meta-llama/Llama-3.3-70B-Instruct
        - 等等

    使用示例:
        >>> provider = SiliconFlowProvider(api_key="sk-...")
        >>> response = provider.chat(
        ...     "deepseek-ai/DeepSeek-V3",
        ...     [{"role": "user", "content": "Hello"}]
        ... )
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        timeout: Optional[float] = None,
    ):
        """
        初始化 SiliconFlow Provider

        参数:
            api_key: SiliconFlow API 密钥 (可选，默认使用环境变量)
            timeout: 请求超时时间 (秒，可选)
        """
        # 从环境变量获取 API Key
        api_key = api_key or SILICONFLOW_API_KEY

        # 调用父类初始化，使用 SiliconFlow 的 base_url
        super().__init__(
            base_url="https://api.siliconflow.cn/v1",
            api_key=api_key,
            model_param="model",
            timeout=timeout,
        )

        logger.info(f"[SiliconFlowProvider] 初始化完成")


# ============================================================
# Zhipu Provider
# ============================================================

class ZhipuProvider(CustomProvider):
    """
    智谱 AI Provider

    智谱 GLM 系列 API， 官方文档: https://open.bigmodel.cn/dev/api

    支持的模型:
        - GLM-4-Flash (推荐，速度快、便宜)
        - GLM-4-Plus
        - GLM-4-0520

    使用示例:
        >>> provider = ZhipuProvider(api_key="...")
        >>> response = provider.chat(
        ...     "GLM-4-Flash",
        ...     [{"role": "user", "content": "Hello"}]
        ... )
    """

    def __init__(
        self, api_key: Optional[str] = None, timeout: Optional[float] = None
    ):
        """
        初始化智谱 Provider

        参数:
            api_key: 智谱 API 密钥 (可选，默认使用环境变量)
            timeout: 请求超时时间 (秒，可选)
        """
        # 从环境变量获取 API Key
        api_key = api_key or ZHIPU_API_KEY

        # 调用父类初始化，使用智谱的 base_url
        super().__init__(
            base_url="https://open.bigmodel.cn/api/paas/v4",
            api_key=api_key,
            model_param="model",
            timeout=timeout,
        )

        logger.info(f"[ZhipuProvider] 初始化完成")


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
        - siliconflow: SiliconFlowProvider

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
        "siliconflow": SiliconFlowProvider,
        "zhipu": ZhipuProvider,
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

    # 处理不同 Provider 的特殊参数
    if provider_type == "custom":
        # Custom Provider 需要 base_url 和 model_param
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
    elif provider_type in ("openai", "deepseek"):
        # OpenAI 和 DeepSeek 支持 base_url 覆盖
        base_url = (
            provider_config.get("base_url")
            if hasattr(provider_config, "get")
            else getattr(provider_config, "base_url", None)
        )
        if base_url:
            factory_kwargs["base_url"] = base_url
    # 其他 Provider (siliconflow, zhipu, google) 不需要 base_url 参数

    # 获取 API 密钥
    api_key = (
        provider_config.get("api_key")
        if hasattr(provider_config, "get")
        else getattr(provider_config, "api_key", None)
    )
    factory_kwargs["api_key"] = api_key

    # 获取 timeout (null 表示使用配置文件的 llm_timeout)
    timeout = (
        provider_config.get("timeout")
        if hasattr(provider_config, "get")
        else getattr(provider_config, "timeout", None)
    )
    factory_kwargs["timeout"] = timeout

    # 创建 Provider
    return LLMProviderFactory.create(provider_type, **factory_kwargs)


def get_multi_provider(providers_config) -> MultiProvider:
    """
    从配置创建 MultiProvider 实例（多 Provider 并行处理）

    参数:
        providers_config: Provider 列表配置
            [
                {"type": "deepseek", "model": "deepseek-chat", "weight": 1},
                {"type": "siliconflow", "model": "deepseek-ai/DeepSeek-V3", "weight": 1},
                {"type": "zhipu", "model": "GLM-4-Flash", "weight": 1}
            ]

    返回:
        MultiProvider 实例

    使用示例:
        >>> config = [
        ...     {"type": "deepseek", "model": "deepseek-chat", "weight": 1},
        ...     {"type": "siliconflow", "model": "deepseek-ai/DeepSeek-V3", "weight": 1}
        ... ]
        >>> multi_provider = get_multi_provider(config)
        >>> # 轮询使用不同 Provider，每个 Provider 使用自己的模型
        >>> response1 = await multi_provider.chat_async("", [...])  # DeepSeek + deepseek-chat
        >>> response2 = await multi_provider.chat_async("", [...])  # SiliconFlow + DeepSeek-V3
    """
    if not providers_config:
        raise ValueError("providers_config 不能为空")

    providers = []
    weights = []
    names = []
    models = []

    for i, cfg in enumerate(providers_config):
        # 获取权重
        weight = (
            cfg.get("weight", 1)
            if hasattr(cfg, "get")
            else getattr(cfg, "weight", 1)
        )

        # 获取名称
        name = (
            cfg.get("name", f"provider_{i}")
            if hasattr(cfg, "get")
            else getattr(cfg, "name", f"provider_{i}")
        )

        # 获取模型（每个 Provider 独立配置）
        model = (
            cfg.get("model", "")
            if hasattr(cfg, "get")
            else getattr(cfg, "model", "")
        )

        # 创建单个 Provider
        provider = get_provider(cfg)

        providers.append(provider)
        weights.append(weight)
        names.append(name)
        models.append(model)

        logger.info(f"[MultiProvider] 添加 Provider: {name}, model={model}, 权重={weight}")

    return MultiProvider(providers=providers, weights=weights, names=names, models=models)
