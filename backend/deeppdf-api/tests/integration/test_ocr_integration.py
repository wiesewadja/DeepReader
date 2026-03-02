"""OCR 功能端到端测试"""

import pytest
from pathlib import Path
from pageindex.pdf.ocr import detect_pdf_type, PaddleOCRExtractor, VisualDetector
from deeppdf.ocr import DeepSeekOCRClient
from deeppdf.config import settings


@pytest.mark.integration
class TestOCRIntegration:
    """OCR 集成测试"""

    def test_visual_detector_init(self):
        """测试视觉检测器初始化"""
        detector = VisualDetector(sample_pages=5)
        assert detector.sample_pages == 5

    @pytest.mark.skipif(not settings.deepseek_ocr_api_key, reason="需要 API Key")
    def test_deepseek_ocr_client_init(self):
        """测试 DeepSeek OCR 客户端初始化"""
        client = DeepSeekOCRClient()
        assert client.model == "deepseek-ai/DeepSeek-OCR"

    # 注意：以下测试需要 sample_visual_pdf fixture，需要时手动测试
    @pytest.mark.skip(reason="需要 sample_visual_pdf fixture")
    def test_visual_detection_from_lib(self, sample_visual_pdf):
        """测试从 pageindex-lib 导入的视觉检测"""
        result = detect_pdf_type(str(sample_visual_pdf))
        assert result.is_visual_heavy is True

    @pytest.mark.skip(reason="需要 sample_visual_pdf fixture")
    def test_paddle_ocr_from_lib(self, sample_visual_pdf):
        """测试从 pageindex-lib 导入的 PaddleOCR"""
        extractor = PaddleOCRExtractor(use_gpu=False)
        texts = extractor.extract_from_pdf(str(sample_visual_pdf), max_pages=1)
        assert len(texts) == 1

    @pytest.mark.skipif(not settings.deepseek_ocr_api_key, reason="需要 API Key")
    @pytest.mark.skip(reason="需要 sample_visual_pdf fixture")
    def test_deepseek_ocr_read(self, sample_visual_pdf):
        """测试 DeepSeek OCR 读取"""
        client = DeepSeekOCRClient()
        result = client.read_pdf_page(str(sample_visual_pdf), page_num=0)
        assert isinstance(result, str)
        assert len(result) > 10
