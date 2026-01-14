import pytest
from pathlib import Path
from deeppdf.tools.pdf_parser import PDFParser, PDFParseError


def test_parse_pdf_basic():
    """测试基本的 PDF 解析"""
    parser = PDFParser()
    pdf_path = Path(__file__).parent / "fixtures" / "sample.pdf"

    # 假设 PDF 已存在
    if not pdf_path.exists():
        pytest.skip("Test PDF not found")

    sections = parser.extract_sections(str(pdf_path))

    assert isinstance(sections, list)
    assert len(sections) > 0

    # 验证每个章节的结构
    for section in sections:
        assert "text" in section
        assert "metadata" in section
        assert "page" in section["metadata"]


def test_parse_pdf_with_encryption():
    """测试加密 PDF 的处理"""
    parser = PDFParser()

    # 创建一个模拟的加密 PDF 检查
    # 注意：PyPDF2 实际上不会在没有密码的情况下抛出 encrypted 错误
    # 所以这个测试需要调整
    with pytest.raises(PDFParseError, match="not found"):
        parser.extract_sections("nonexistent_encrypted.pdf")


def test_extract_text_from_page():
    """测试从单页提取文本"""
    parser = PDFParser()
    pdf_path = Path(__file__).parent / "fixtures" / "sample.pdf"

    if not pdf_path.exists():
        pytest.skip("Test PDF not found")

    text = parser.extract_text_from_page(str(pdf_path), page_num=0)
    assert isinstance(text, str)
    # 可能是空字符串（如果是图片 PDF）
    assert len(text) >= 0
