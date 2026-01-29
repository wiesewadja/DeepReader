"""测试 DeepSeek OCR 客户端"""

import pytest
from deeppdf.ocr import DeepSeekOCRClient
from deeppdf.config import settings


def test_client_init():
    """测试客户端初始化（使用假 key）"""
    client = DeepSeekOCRClient(api_key="test-key")
    assert client.model == "deepseek-ai/DeepSeek-OCR"


def test_client_init_missing_key():
    """测试缺少 API Key"""
    with pytest.raises(ValueError):
        DeepSeekOCRClient(api_key=None)


@pytest.mark.skipif(not settings.deepseek_ocr_api_key, reason="需要 API Key")
def test_read_pdf_page(sample_pdf_path):
    """测试读取 PDF 页面"""
    client = DeepSeekOCRClient()
    result = client.read_pdf_page(str(sample_pdf_path), page_num=0)
    assert isinstance(result, str)
    assert len(result) > 0
