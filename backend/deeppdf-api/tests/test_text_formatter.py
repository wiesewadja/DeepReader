"""
文本格式化服务测试
"""

from deeppdf.services.text_formatter import TextFormatter


class TestTextFormatter:
    """TextFormatter 测试类"""

    def setup_method(self):
        self.formatter = TextFormatter()

    def test_merge_soft_line_breaks(self):
        """测试软换行合并"""
        text = "This is a test\nsentence split across\nlines."
        result = self.formatter._merge_soft_line_breaks(text)
        assert "This is a test sentence split across lines." in result

    def test_preserve_paragraph_breaks(self):
        """测试保留段落分隔"""
        text = "First paragraph.\n\nSecond paragraph."
        result = self.formatter._normalize_paragraphs(text)
        assert "First paragraph." in result
        assert "Second paragraph." in result

    def test_detect_chinese_heading(self):
        """测试中文章节标题检测"""
        text = "第一章 引言\n\n正文内容"
        result = self.formatter._detect_headings(text)
        assert "# 第一章 引言" in result

    def test_detect_numbered_heading(self):
        """测试数字编号标题检测"""
        text = "1.1 背景\n\n内容"
        result = self.formatter._detect_headings(text)
        assert "## 1.1 背景" in result

    def test_clean_whitespace(self):
        """测试空白清理"""
        text = "  多余空格  \n\n"
        result = self.formatter._clean_whitespace(text)
        assert result == "多余空格"

    def test_full_format_pdf(self):
        """测试完整 PDF 格式化"""
        text = """第一章 测试

This is a sentence that
was split across lines.

1.1 小节

More content here."""
        result = self.formatter.format(text, "pdf")
        assert "# 第一章 测试" in result
        assert "## 1.1 小节" in result
