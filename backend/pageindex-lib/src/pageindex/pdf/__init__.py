"""
PageIndex PDF 处理模块

本模块提供 PDF 文件解析和文本提取功能。

主要功能:
    - PDF 文本提取
    - 页面 Token 计数
    - 多种解析器支持 (pypdf, PyMuPDF)
    - 页面标记格式化

支持的后端:
    - pypdf (默认): 纯 Python，无外部依赖
    - PyMuPDF (fitz): 更快的 C 扩展，需要单独安装

使用示例:
    >>> from pageindex.pdf.parser import PDFParser
    >>> from pageindex.pdf.tokens import count_tokens
    >>>
    >>> # 解析 PDF
    >>> parser = PDFParser()
    >>> pages = parser.parse("document.pdf")
    >>>
    >>> # 获取带标记的文本
    >>> text = parser.get_text_with_tags(pages, 1, 5)
    >>>
    >>> # 计算 Token 数量
    >>> token_count = count_tokens(page_text)

作者: DeepPDF Team
创建时间: 2026-01-16
"""

from .parser import (
    PDFParser,
    get_page_tokens,
    get_text_of_pages,
    get_text_of_pdf_pages,
    get_text_of_pdf_pages_with_labels,
)
from .tokens import (
    count_tokens,
    get_encoding_for_model,
    estimate_tokens_from_chars,
    get_model_encoding_name,
    tokenize,
    decode_tokens,
)

__all__ = [
    # 解析器类
    "PDFParser",
    # PDF 解析便捷函数
    "get_page_tokens",
    "get_text_of_pages",
    "get_text_of_pdf_pages",
    "get_text_of_pdf_pages_with_labels",
    # Token 计数函数
    "count_tokens",
    "get_encoding_for_model",
    "estimate_tokens_from_chars",
    "get_model_encoding_name",
    "tokenize",
    "decode_tokens",
]
