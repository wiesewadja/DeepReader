"""
PDF 处理模块

包含：
    - PDFParser: PDF 解析器（pypdf、PyMuPDF）
    - OCR: 视觉检测和 OCR 提取
    - Token 计数工具
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
# 新增 OCR 导出
from .ocr import VisualDetector, detect_pdf_type, VisualDetectionResult, PaddleOCRExtractor

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
    # OCR
    "VisualDetector",
    "detect_pdf_type",
    "VisualDetectionResult",
    "PaddleOCRExtractor",
]
