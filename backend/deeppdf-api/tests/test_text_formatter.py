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

    def test_short_paragraph_as_heading(self):
        """测试短段落（<50字符，无句号）识别为三级标题"""
        # 短段落，没有句号结尾 -> 应该是三级标题
        text = "这是一个小节标题\n\n正文内容在这里。"
        result = self.formatter._detect_headings(text)
        assert "### 这是一个小节标题" in result

    def test_short_paragraph_with_period_not_heading(self):
        """测试以句号结尾的短段落不应识别为标题"""
        # 短段落，但有句号结尾 -> 不应该是标题
        text = "这是一个完整的句子。\n\n正文内容在这里。"
        result = self.formatter._detect_headings(text)
        assert "### 这是一个完整的句子。" not in result

    def test_long_paragraph_not_heading(self):
        """测试长段落不应识别为标题"""
        # 长段落（>=50字符），没有句号结尾 -> 不应该是标题
        # 生成一个确定超过 50 字符的长文本
        long_text = "这是一段测试文本内容，它包含了足够多的字符数量以超过五十个字符的限制要求"
        # 确保长度超过 50
        while len(long_text) < 55:
            long_text += "测试"
        assert len(long_text) >= 50, f"测试文本长度 {len(long_text)} 不满足 >= 50"
        text = f"{long_text}\n\n正文内容在这里。"
        result = self.formatter._detect_headings(text)
        assert f"### {long_text}" not in result

    def test_short_paragraph_with_various_endings(self):
        """测试各种句子结束标点"""
        # 以感叹号结尾 -> 不是标题
        text1 = "太棒了！\n\n正文。"
        result1 = self.formatter._detect_headings(text1)
        assert "### 太棒了！" not in result1

        # 以问号结尾 -> 不是标题
        text2 = "为什么？\n\n正文。"
        result2 = self.formatter._detect_headings(text2)
        assert "### 为什么？" not in result2

        # 无标点结尾 -> 是标题
        text3 = "重要提示\n\n正文。"
        result3 = self.formatter._detect_headings(text3)
        assert "### 重要提示" in result3

    def test_non_heading_patterns_excluded(self):
        """测试不应作为标题的模式被排除"""
        # 纯数字不应是标题
        text1 = "123\n\n正文。"
        result1 = self.formatter._detect_headings(text1)
        assert "### 123" not in result1

        # 分隔线不应是标题
        text2 = "---\n\n正文。"
        result2 = self.formatter._detect_headings(text2)
        assert "### ---" not in result2

        # 日期不应是标题
        text3 = "2024-03-11\n\n正文。"
        result3 = self.formatter._detect_headings(text3)
        assert "### 2024-03-11" not in result3
