"""
PageIndex 核心模块

本模块包含 PageIndex 的核心基础设施：
- 自定义异常类
- 配置管理
- 通用工具函数

主要组件:
    - exceptions: 自定义异常类层次结构
    - config: 配置加载和验证

使用示例:
    >>> from pageindex.core import PageIndexError, LLMError
    >>> from pageindex.core.config import load_config
    >>> config = load_config({"model": "gpt-4"})

作者: DeepPDF Team
创建时间: 2026-01-16
"""

from .exceptions import (
    PageIndexError,
    PDFError,
    TOCError,
    LLMError,
    ValidationError,
    RetryExhaustedError,
    TimeoutError,
)
from .config import ConfigLoader, load_config

__all__ = [
    "PageIndexError",
    "PDFError",
    "TOCError",
    "LLMError",
    "ValidationError",
    "RetryExhaustedError",
    "TimeoutError",
    "ConfigLoader",
    "load_config",
]
