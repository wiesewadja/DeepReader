"""测试 OCR 模块"""
import pytest
from pageindex.pdf.ocr import VisualDetector, PaddleOCRExtractor, detect_pdf_type


def test_detector_init():
    """测试检测器初始化"""
    detector = VisualDetector(sample_pages=5)
    assert detector.sample_pages == 5


@pytest.mark.skip(reason="PaddleOCR 初始化耗时较长，需要时手动测试")
def test_paddle_ocr_init():
    """测试 PaddleOCR 初始化"""
    extractor = PaddleOCRExtractor(use_gpu=False)
    assert extractor.ocr is not None


@pytest.mark.skip(reason="需要 sample_pdf_path fixture")
def test_detect_pdf(sample_pdf_path):
    """测试检测 PDF"""
    result = detect_pdf_type(str(sample_pdf_path))
    assert hasattr(result, "is_visual_heavy")
    assert hasattr(result, "text_density")
