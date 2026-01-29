"""
OCR 子模块 - PDF 视觉检测和 OCR 文本提取

本模块提供：
    - PDF 类型检测：判断 PDF 是否为扫描文档或图表密集型
    - PaddleOCR 提取：使用 PaddleOCR 提取 PDF 文本

使用示例:
    >>> from pageindex.pdf.ocr import detect_pdf_type, PaddleOCRExtractor
    >>>
    >>> # 检测 PDF 类型
    >>> result = detect_pdf_type("document.pdf")
    >>> print(f"视觉密集型: {result.is_visual_heavy}")
    >>>
    >>> # OCR 提取
    >>> extractor = PaddleOCRExtractor()
    >>> texts = extractor.extract_from_pdf("scanned.pdf")
"""

from .detector import VisualDetector, detect_pdf_type, VisualDetectionResult
from .paddle_extractor import PaddleOCRExtractor

__all__ = [
    "VisualDetector",
    "detect_pdf_type",
    "VisualDetectionResult",
    "PaddleOCRExtractor",
]
