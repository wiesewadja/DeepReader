"""
PageIndex Token 计数模块

本模块提供基于 tiktoken 的 Token 计数功能，支持多种 OpenAI 模型。

主要功能:
    - 精确的 Token 计数 (使用 tiktoken 库)
    - 支持多种 OpenAI 模型编码
    - 自动回退到通用编码

支持的模型:
    - GPT-4 系列: gpt-4, gpt-4-turbo, gpt-4o 等
    - GPT-3.5 系列: gpt-3.5-turbo 等
    - 其他: 使用 cl100k_base 通用编码

tiktoken 编码说明:
    - cl100k_base: GPT-4, GPT-3.5-Turbo, GPT-4o 等最新模型
    - p50k_base: 旧版 GPT-3 模型
    - r50k_base: GPT-2 模型
    - gpt2: GPT-2 原始编码

使用示例:
    >>> from pageindex.pdf.tokens import count_tokens
    >>>
    >>> # 计算文本 Token 数量
    >>> text = "这是一段中文文本"
    >>> token_count = count_tokens(text, model="gpt-4o")
    >>> print(f"Token 数量: {token_count}")
    >>>
    >>> # 自动检测模型编码
    >>> token_count = count_tokens(text, model="gpt-4-turbo")

依赖关系:
    - tiktoken: OpenAI 的 Token 计数库

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import logging
from typing import Optional

import tiktoken

logger = logging.getLogger(__name__)


# ============================================================
# 模型编码映射表
# ============================================================

# 支持的模型和对应的 tiktoken 编码
MODEL_ENCODINGS = {
    # GPT-4 系列 (cl100k_base)
    "gpt-4": "cl100k_base",
    "gpt-4-turbo": "cl100k_base",
    "gpt-4-turbo-preview": "cl100k_base",
    "gpt-4o": "cl100k_base",
    "gpt-4o-2024-11-20": "cl100k_base",
    "gpt-4o-mini": "cl100k_base",

    # GPT-3.5 系列 (cl100k_base)
    "gpt-3.5-turbo": "cl100k_base",
    "gpt-3.5-turbo-16k": "cl100k_base",
    "gpt-3.5-turbo-1106": "cl100k_base",
    "gpt-3.5-turbo-0125": "cl100k_base",

    # 旧版 GPT-3 (p50k_base)
    "gpt-3": "p50k_base",
    "text-davinci-003": "p50k_base",
    "text-davinci-002": "p50k_base",

    # GPT-2 (r50k_base / gpt2)
    "gpt-2": "r50k_base",
    "gpt-2.5": "r50k_base",

    # 其他使用通用编码
}

# 默认编码 (当模型不在映射表中时使用)
DEFAULT_ENCODING = "cl100k_base"


def count_tokens(text: str, model: Optional[str] = None) -> int:
    """
    计算文本的 Token 数量

    使用 tiktoken 库精确计算文本的 Token 数量。支持多种 OpenAI 模型，
    如果指定的模型不支持，自动回退到默认编码。

    参数:
        text: 要计算 Token 数量的文本
        model: 模型名称 (可选)
            - 如果指定，使用该模型专用的编码
            - 如果为 None，使用默认编码 cl100k_base
            - 如果模型不支持，自动回退到 cl100k_base

    返回:
        Token 数量 (整数)

    注意:
        - 空文本返回 0
        - 中文文本的 Token 数量通常比字符数多
        - 英文文本的 Token 数量通常约为字符数的 1/4 (单词数)

    使用示例:
        >>> count_tokens("Hello, world!", model="gpt-4o")
        4
        >>> count_tokens("你好，世界！", model="gpt-4o")
        7
        >>> count_tokens("")  # 空文本
        0

    模型支持示例:
        >>> # GPT-4 系列
        >>> count_tokens(text, model="gpt-4o")
        >>> count_tokens(text, model="gpt-4-turbo")
        >>>
        >>> # GPT-3.5 系列
        >>> count_tokens(text, model="gpt-3.5-turbo")
        >>>
        >>> # 不指定的模型，使用默认编码
        >>> count_tokens(text)
        >>> count_tokens(text, model="unknown-model")  # 自动使用默认编码
    """
    # ============================================================
    # 步骤1: 处理空文本
    # ============================================================
    if not text:
        return 0

    # ============================================================
    # 步骤2: 确定使用的编码
    # ============================================================
    try:
        # 尝试使用模型专用的编码
        if model:
            encoding = tiktoken.encoding_for_model(model)
        else:
            # 使用默认编码
            encoding = tiktoken.get_encoding(DEFAULT_ENCODING)

    except (KeyError, ValueError) as e:
        # 模型不支持，回退到默认编码
        logger.debug(
            f"模型 '{model}' 不支持，使用默认编码 '{DEFAULT_ENCODING}': {e}"
        )
        encoding = tiktoken.get_encoding(DEFAULT_ENCODING)

    # ============================================================
    # 步骤3: 编码文本并计算 Token 数量
    # ============================================================
    tokens = encoding.encode(text)
    token_count = len(tokens)

    logger.debug(
        f"Token 计数: model={model or 'default'}, "
        f"encoding={encoding.name}, tokens={token_count}, "
        f"chars={len(text)}"
    )

    return token_count


def get_encoding_for_model(model: str) -> tiktoken.Encoding:
    """
    获取指定模型的 tiktoken 编码对象

    这是一个高级函数，用于获取底层编码对象，适用于需要直接
    操作编码的场景。

    参数:
        model: 模型名称

    返回:
        tiktoken.Encoding 对象

    异常:
        ValueError: 如果模型完全不支持 (无默认编码)

    使用示例:
        >>> encoding = get_encoding_for_model("gpt-4o")
        >>> tokens = encoding.encode("Hello, world!")
        >>> print(tokens)
        [9906, 11, 1917, 0]
    """
    try:
        return tiktoken.encoding_for_model(model)
    except (KeyError, ValueError):
        # 回退到默认编码
        logger.debug(f"模型 '{model}' 不支持，使用默认编码")
        return tiktoken.get_encoding(DEFAULT_ENCODING)


def estimate_tokens_from_chars(
    char_count: int,
    language: str = "zh",
    model: Optional[str] = None
) -> int:
    """
    根据字符数估算 Token 数量

    这是一个快速估算函数，不需要实际编码文本。
    适用于粗略估算的场景。

    估算规则:
        - 中文: 1 Token ≈ 0.7-0.8 个字符
        - 英文: 1 Token ≈ 4 个字符 (约 1 个单词)
        - 混合: 1 Token ≈ 2 个字符

    参数:
        char_count: 字符数量
        language: 语言类型 ("zh"=中文, "en"=英文, "mixed"=混合)
        model: 模型名称 (用于记录日志，不影响估算)

    返回:
        估算的 Token 数量

    注意:
        这是粗略估算，实际数量请使用 count_tokens()

    使用示例:
        >>> # 估算 1000 个中文字符
        >>> estimate_tokens_from_chars(1000, language="zh")
        1300
        >>>
        >>> # 估算 1000 个英文字符
        >>> estimate_tokens_from_chars(1000, language="en")
        250
    """
    if char_count == 0:
        return 0

    # 根据语言选择估算比例
    if language == "zh":
        # 中文: 约 1.3 倍
        ratio = 1.3
    elif language == "en":
        # 英文: 约 0.25 倍 (4 chars ≈ 1 token)
        ratio = 0.25
    else:  # mixed
        # 混合: 约 0.5 倍
        ratio = 0.5

    estimated = int(char_count * ratio)

    logger.debug(
        f"Token 估算: chars={char_count}, language={language}, "
        f"estimated_tokens={estimated}, model={model}"
    )

    return estimated


def get_model_encoding_name(model: str) -> str:
    """
    获取模型对应的编码名称

    这是一个便捷函数，用于查询模型使用哪种 tiktoken 编码。

    参数:
        model: 模型名称

    返回:
        编码名称 (如 "cl100k_base", "p50k_base" 等)

    使用示例:
        >>> get_model_encoding_name("gpt-4o")
        'cl100k_base'
        >>> get_model_encoding_name("gpt-3.5-turbo")
        'cl100k_base'
        >>> get_model_encoding_name("unknown-model")
        'cl100k_base'  # 返回默认编码
    """
    # 检查映射表
    if model in MODEL_ENCODINGS:
        return MODEL_ENCODINGS[model]

    # 尝试 tiktoken
    try:
        encoding = tiktoken.encoding_for_model(model)
        return encoding.name
    except (KeyError, ValueError):
        # 返回默认编码
        return DEFAULT_ENCODING


# ============================================================
# 便捷函数别名 (保持向后兼容)
# ============================================================

def tokenize(text: str, model: Optional[str] = None) -> list[int]:
    """
    将文本编码为 Token 列表

    这是一个便捷函数，返回实际的 Token ID 列表。

    参数:
        text: 要编码的文本
        model: 模型名称

    返回:
        Token ID 列表

    使用示例:
        >>> tokenize("Hello", model="gpt-4o")
        [9906]
    """
    if not text:
        return []

    encoding = get_encoding_for_model(model) if model else tiktoken.get_encoding(DEFAULT_ENCODING)
    return encoding.encode(text)


def decode_tokens(tokens: list[int], model: Optional[str] = None) -> str:
    """
    将 Token 列表解码为文本

    这是一个便捷函数，用于逆向操作 tokenize()。

    参数:
        tokens: Token ID 列表
        model: 模型名称

    返回:
        解码后的文本

    使用示例:
        >>> decode_tokens([9906], model="gpt-4o")
        'Hello'
    """
    if not tokens:
        return ""

    encoding = get_encoding_for_model(model) if model else tiktoken.get_encoding(DEFAULT_ENCODING)
    return encoding.decode(tokens)
