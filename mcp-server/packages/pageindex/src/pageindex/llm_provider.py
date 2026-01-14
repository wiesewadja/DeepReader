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
    def __init__(self, api_key: str = None, base_url: str = None):
        self.api_key = api_key or CHATGPT_API_KEY
        self.base_url = base_url

    def chat(self, model: str, messages: list, temperature: float = 0) -> str:
        client = openai.OpenAI(api_key=self.api_key, base_url=self.base_url)
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
            api_key=self.api_key, base_url=self.base_url
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
    def __init__(self, base_url: str = None, api_key: str = None):
        self.base_url = base_url or "https://api.deepseek.com"
        self.api_key = api_key

    def chat(self, model: str, messages: list, temperature: float = 0) -> str:
        client = openai.OpenAI(api_key=self.api_key, base_url=self.base_url)
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
        )
        return response.choices[0].message.content

    async def chat_async(
        self, model: str, messages: list, temperature: float = 0
    ) -> str:
        client = openai.OpenAI(api_key=self.api_key, base_url=self.base_url)
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
    def __init__(self, base_url: str, api_key: str = None, model_param: str = "model"):
        self.base_url = base_url
        self.api_key = api_key
        self.model_param = model_param

    def chat(self, model: str, messages: list, temperature: float = 0) -> str:
        client = openai.OpenAI(api_key=self.api_key, base_url=self.base_url)
        kwargs = {self.model_param: model}
        response = client.chat.completions.create(
            messages=messages, temperature=temperature, **kwargs
        )
        return response.choices[0].message.content

    async def chat_async(
        self, model: str, messages: list, temperature: float = 0
    ) -> str:
        client = openai.OpenAI(api_key=self.api_key, base_url=self.base_url)
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

    def chat(
        self, prompt: str, chat_history: list = None, temperature: float = 0
    ) -> str:
        if chat_history:
            messages = chat_history.copy()
            messages.append({"role": "user", "content": prompt})
        else:
            messages = [{"role": "user", "content": prompt}]

        for i in range(self.max_retries):
            try:
                return self.provider.chat(self.model, messages, temperature)
            except Exception as e:
                logging.error(f"Error: {e}")
                if i < self.max_retries - 1:
                    time.sleep(1)
                else:
                    logging.error(f"Max retries reached for prompt: {prompt[:100]}...")
                    return "Error"

    def chat_with_finish_reason(
        self, prompt: str, chat_history: list = None, temperature: float = 0
    ):
        if chat_history:
            messages = chat_history.copy()
            messages.append({"role": "user", "content": prompt})
        else:
            messages = [{"role": "user", "content": prompt}]

        for i in range(self.max_retries):
            try:
                content = self.provider.chat(self.model, messages, temperature)
                return content, "finished"
            except Exception as e:
                logging.error(f"Error: {e}")
                if i < self.max_retries - 1:
                    time.sleep(1)
                else:
                    logging.error(f"Max retries reached for prompt: {prompt[:100]}...")
                    return "Error", "error"

    async def chat_async(self, prompt: str, temperature: float = 0) -> str:
        messages = [{"role": "user", "content": prompt}]

        for i in range(self.max_retries):
            try:
                return await self.provider.chat_async(self.model, messages, temperature)
            except Exception as e:
                logging.error(f"Error: {e}")
                if i < self.max_retries - 1:
                    await asyncio.sleep(1)
                else:
                    logging.error(f"Max retries reached for prompt: {prompt[:100]}...")
                    return "Error"
