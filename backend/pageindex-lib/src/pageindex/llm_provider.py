import asyncio
import logging
import time
from abc import ABC, abstractmethod
from typing import Optional

import openai
import os
from dotenv import load_dotenv

load_dotenv()

# 支持 CHATGPT_API_KEY（向后兼容）和 OPENAI_API_KEY（更通用）
CHATGPT_API_KEY = os.getenv("CHATGPT_API_KEY") or os.getenv("OPENAI_API_KEY")

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


class LLMProvider(ABC):
    @abstractmethod
    def chat(self, model: str, messages: list, temperature: float = 0) -> str:
        pass

    @abstractmethod
    async def chat_async(
        self, model: str, messages: list, temperature: float = 0
    ) -> str:
        pass


class OpenAIProvider(LLMProvider):
    def __init__(self, api_key: str = None, base_url: str = None, timeout: float = 300.0):
        self.api_key = api_key or CHATGPT_API_KEY
        self.base_url = base_url
        self.timeout = timeout  # 默认 5 分钟超时

    def chat(self, model: str, messages: list, temperature: float = 0) -> str:
        client = openai.OpenAI(api_key=self.api_key, base_url=self.base_url, timeout=self.timeout)
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
        )
        return response.choices[0].message.content

    async def chat_async(
        self, model: str, messages: list, temperature: float = 0
    ) -> str:
        async with openai.AsyncOpenAI(
            api_key=self.api_key, base_url=self.base_url, timeout=self.timeout
        ) as client:
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
            )
            return response.choices[0].message.content


class GoogleProvider(LLMProvider):
    def __init__(self, api_key: str = None):
        self.api_key = api_key
        if genai is None:
            raise ImportError(
                "google-genai is not installed. Install with: pip install google-genai"
            )

    def chat(self, model: str, messages: list, temperature: float = 0) -> str:
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
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.chat, model, messages, temperature)


class DeepSeekProvider(LLMProvider):
    def __init__(self, base_url: str = None, api_key: str = None, timeout: float = 300.0):
        self.base_url = base_url or "https://api.deepseek.com"
        self.api_key = api_key
        self.timeout = timeout

    def chat(self, model: str, messages: list, temperature: float = 0) -> str:
        client = openai.OpenAI(api_key=self.api_key, base_url=self.base_url, timeout=self.timeout)
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
        )
        return response.choices[0].message.content

    async def chat_async(
        self, model: str, messages: list, temperature: float = 0
    ) -> str:
        client = openai.OpenAI(api_key=self.api_key, base_url=self.base_url, timeout=self.timeout)
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
            ),
        )
        return response.choices[0].message.content


class CustomProvider(LLMProvider):
    def __init__(self, base_url: str, api_key: str = None, model_param: str = "model", timeout: float = 300.0):
        self.base_url = base_url
        self.api_key = api_key
        self.model_param = model_param
        self.timeout = timeout
        logging.info(f"[CustomProvider] 初始化: base_url={base_url}, model_param={model_param}, timeout={timeout}")

    def chat(self, model: str, messages: list, temperature: float = 0) -> str:
        logging.info(f"[CustomProvider] chat: 使用 base_url={self.base_url}, model={model}")
        client = openai.OpenAI(api_key=self.api_key, base_url=self.base_url, timeout=self.timeout)
        kwargs = {self.model_param: model}
        response = client.chat.completions.create(
            messages=messages, temperature=temperature, **kwargs
        )
        return response.choices[0].message.content

    async def chat_async(
        self, model: str, messages: list, temperature: float = 0
    ) -> str:
        client = openai.OpenAI(api_key=self.api_key, base_url=self.base_url, timeout=self.timeout)
        kwargs = {self.model_param: model}
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: client.chat.completions.create(
                messages=messages, temperature=temperature, **kwargs
            ),
        )
        return response.choices[0].message.content


class LLMProviderFactory:
    _providers = {
        "openai": OpenAIProvider,
        "google": GoogleProvider,
        "deepseek": DeepSeekProvider,
        "custom": CustomProvider,
    }

    @classmethod
    def create(cls, provider: str, **kwargs) -> LLMProvider:
        if provider not in cls._providers:
            raise ValueError(
                f"Unknown provider: {provider}. Available: {list(cls._providers.keys())}"
            )
        return cls._providers[provider](**kwargs)

    @classmethod
    def register(cls, name: str, provider_class: type):
        cls._providers[name] = provider_class


def get_provider(provider_config) -> LLMProvider:
    if hasattr(provider_config, "get"):
        provider_type = provider_config.get("type", "openai")
    else:
        provider_type = getattr(provider_config, "type", "openai")

    factory_kwargs = {}

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

    api_key = (
        provider_config.get("api_key")
        if hasattr(provider_config, "get")
        else getattr(provider_config, "api_key", None)
    )
    factory_kwargs["api_key"] = api_key

    return LLMProviderFactory.create(provider_type, **factory_kwargs)


class UnifiedLLM:
    def __init__(self, provider: LLMProvider, model: str, max_retries: int = 10):
        self.provider = provider
        self.model = model
        self.max_retries = max_retries
        self._call_counter = 0  # 用于跟踪调用次数
        self._context_stack = []  # 用于跟踪上下文栈

    def push_context(self, context: str):
        """推入上下文信息"""
        self._context_stack.append(context)

    def pop_context(self):
        """弹出上下文信息"""
        if self._context_stack:
            self._context_stack.pop()

    def _get_context_str(self) -> str:
        """获取当前上下文字符串"""
        if self._context_stack:
            return " | ".join(self._context_stack)
        return ""

    def _log_request(self, messages: list, temperature: float, call_type: str = "chat", context: str = None):
        """记录请求详情"""
        self._call_counter += 1

        # 合并传入的 context 和当前栈中的 context
        all_contexts = []
        if self._context_stack:
            all_contexts.extend(self._context_stack)
        if context:
            all_contexts.append(context)

        context_str = " | ".join(all_contexts) if all_contexts else ""

        # 计算请求 token 数（粗略估算：1 token ≈ 4 字符）
        total_chars = sum(len(str(msg.get("content", ""))) for msg in messages)
        estimated_tokens = total_chars // 4

        # 如果有上下文，显示更清晰的标题
        if context_str:
            logging.info(f"[LLM请求 #{self._call_counter}] {context_str}")
        else:
            logging.info(f"[LLM请求 #{self._call_counter}] {call_type.upper()}")

        logging.info(f"  - 模型: {self.model}")
        logging.info(f"  - 温度: {temperature}")
        logging.info(f"  - 消息数: {len(messages)}")
        logging.info(f"  - 估算请求 tokens: ~{estimated_tokens}")
        logging.info(f"  - 提示词长度: {total_chars} 字符")

        # 显示第一条消息的前 200 字符
        if messages:
            first_msg_content = str(messages[0].get("content", ""))
            preview = first_msg_content[:200]
            if len(first_msg_content) > 200:
                preview += "..."
            logging.debug(f"  - 提示词预览: {preview}")

        return self._call_counter, time.time()

    def _log_response(self, content: str, start_time: float, call_id: int):
        """记录响应详情"""
        elapsed = time.time() - start_time

        # 计算响应 token 数
        response_chars = len(content)
        estimated_tokens = response_chars // 4

        logging.info(f"[LLM响应 #{call_id}] 完成")
        logging.info(f"  - 耗时: {elapsed:.2f} 秒")
        logging.info(f"  - 响应长度: {response_chars} 字符")
        logging.info(f"  - 估算响应 tokens: ~{estimated_tokens}")

        # 显示响应的前 300 字符
        preview = content[:300]
        if len(content) > 300:
            preview += "..."
        logging.debug(f"  - 响应内容预览: {preview}")

        return elapsed

    def _log_error(self, e: Exception, attempt: int, call_id: int):
        """记录错误详情"""
        error_msg = str(e)
        error_type = type(e).__name__

        logging.error(f"[LLM错误 #{call_id}] 尝试 {attempt}/{self.max_retries}")
        logging.error(f"  - 错误类型: {error_type}")
        logging.error(f"  - 错误信息: {error_msg}")

        # 检测是否为连接错误
        is_connection_error = any(
            keyword in error_msg.lower()
            for keyword in ["connection", "timeout", "network", "temporarily", "unreachable"]
        )

        if is_connection_error:
            wait_time = min(2 ** (attempt - 1), 10)
            logging.error(f"  - 网络错误检测到，等待 {wait_time} 秒后重试...")
        else:
            logging.error(f"  - 非网络错误，1 秒后重试...")

        return is_connection_error

    def chat(
        self, prompt: str, chat_history: list = None, temperature: float = 0, context: str = None
    ) -> str:
        if chat_history:
            messages = chat_history.copy()
            messages.append({"role": "user", "content": prompt})
        else:
            messages = [{"role": "user", "content": prompt}]

        # 记录请求
        call_id, start_time = self._log_request(messages, temperature, "chat", context)

        for i in range(1, self.max_retries + 1):
            try:
                response = self.provider.chat(self.model, messages, temperature)
                # 记录响应
                self._log_response(response, start_time, call_id)
                return response
            except Exception as e:
                is_connection_error = self._log_error(e, i, call_id)

                if i < self.max_retries:
                    wait_time = min(2 ** (i - 1), 10) if is_connection_error else 1
                    time.sleep(wait_time)
                else:
                    logging.error(f"[LLM失败 #{call_id}] 达到最大重试次数，放弃")
                    logging.error(f"  - 提示词: {prompt[:100]}...")
                    return "Error"

    def chat_with_finish_reason(
        self, prompt: str, chat_history: list = None, temperature: float = 0, context: str = None
    ):
        if chat_history:
            messages = chat_history.copy()
            messages.append({"role": "user", "content": prompt})
        else:
            messages = [{"role": "user", "content": prompt}]

        # 记录请求
        call_id, start_time = self._log_request(messages, temperature, "chat_with_finish_reason", context)

        for i in range(1, self.max_retries + 1):
            try:
                response = self.provider.chat(self.model, messages, temperature)
                # 记录响应
                self._log_response(response, start_time, call_id)
                return response, "finished"
            except Exception as e:
                is_connection_error = self._log_error(e, i, call_id)

                if i < self.max_retries:
                    wait_time = min(2 ** (i - 1), 10) if is_connection_error else 1
                    time.sleep(wait_time)
                else:
                    logging.error(f"[LLM失败 #{call_id}] 达到最大重试次数，放弃")
                    logging.error(f"  - 提示词: {prompt[:100]}...")
                    return "Error", "error"

    async def chat_async(self, prompt: str, temperature: float = 0, context: str = None) -> str:
        messages = [{"role": "user", "content": prompt}]

        # 记录请求
        call_id, start_time = self._log_request(messages, temperature, "chat_async", context)

        for i in range(1, self.max_retries + 1):
            try:
                response = await self.provider.chat_async(self.model, messages, temperature)
                # 记录响应
                self._log_response(response, start_time, call_id)
                return response
            except Exception as e:
                is_connection_error = self._log_error(e, i, call_id)

                if i < self.max_retries:
                    wait_time = min(2 ** (i - 1), 10) if is_connection_error else 1
                    await asyncio.sleep(wait_time)
                else:
                    logging.error(f"[LLM失败 #{call_id}] 达到最大重试次数，放弃")
                    logging.error(f"  - 提示词: {prompt[:100]}...")
                    return "Error"

    async def chat_with_finish_reason_async(
        self, prompt: str, chat_history: list = None, temperature: float = 0, context: str = None
    ):
        if chat_history:
            messages = chat_history.copy()
            messages.append({"role": "user", "content": prompt})
        else:
            messages = [{"role": "user", "content": prompt}]

        # 记录请求
        call_id, start_time = self._log_request(messages, temperature, "chat_with_finish_reason_async", context)

        for i in range(1, self.max_retries + 1):
            try:
                response = await self.provider.chat_async(self.model, messages, temperature)
                # 记录响应
                self._log_response(response, start_time, call_id)
                return response, "finished"
            except Exception as e:
                is_connection_error = self._log_error(e, i, call_id)

                if i < self.max_retries:
                    wait_time = min(2 ** (i - 1), 10) if is_connection_error else 1
                    await asyncio.sleep(wait_time)
                else:
                    logging.error(f"[LLM失败 #{call_id}] 达到最大重试次数，放弃")
                    logging.error(f"  - 提示词: {prompt[:100]}...")
                    return "Error", "error"
