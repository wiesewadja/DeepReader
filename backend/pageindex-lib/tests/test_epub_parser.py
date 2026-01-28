"""
测试 EPUB 解析器模块

这个测试模块验证 EpubParser 类的正确性。
"""

import pytest
import sys
import os
from typing import Dict, Any, List
from unittest.mock import MagicMock, patch

# 添加 src 目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from pageindex.epub_parser import EpubParser


@pytest.fixture
def mock_epub():
    """创建一个模拟的 EPUB 文件对象"""
    from ebooklib import ITEM_DOCUMENT

    mock_book = MagicMock()
    mock_book.title = "Test Book"
    # get_metadata 返回格式: [((namespace, element), value, ...)]
    mock_book.get_metadata = MagicMock(side_effect=lambda ns, elem: [
        ("Test Book",)  # title
    ] if elem == "title" else [
        ("Test Author",)  # creator
    ] if elem == "creator" else [
        ("en",)  # language
    ] if elem == "language" else [])

    # toc 现在是属性而不是方法
    mock_book.toc = [
        ("Chapter 1", "chapter1.xhtml", "1"),
        ("Chapter 2", "chapter2.xhtml", "2")
    ]

    # 模拟 get_items 返回迭代器
    def mock_get_items():
        return [
            MagicMock(
                get_type=MagicMock(return_value=9),  # EPUB_NAV
                get_content=MagicMock(return_value=b"<nav></nav>")
            ),
            MagicMock(
                get_type=MagicMock(return_value=ITEM_DOCUMENT),  # ITEM_DOCUMENT
                get_name=MagicMock(return_value="chapter1.xhtml"),
                get_content=MagicMock(return_value=b"<html><body><h1>Chapter 1</h1><p>Content of chapter 1</p></body></html>")
            ),
            MagicMock(
                get_type=MagicMock(return_value=ITEM_DOCUMENT),  # ITEM_DOCUMENT
                get_name=MagicMock(return_value="chapter2.xhtml"),
                get_content=MagicMock(return_value=b"<html><body><h1>Chapter 2</h1><p>Content of chapter 2</p></body></html>")
            )
        ]
    mock_book.get_items = MagicMock(side_effect=mock_get_items)

    return mock_book


@pytest.fixture
def sample_epub_path(tmp_path):
    """创建一个示例 EPUB 文件路径"""
    epub_path = tmp_path / "test.epub"
    # 创建一个空的 EPUB 文件
    epub_path.write_bytes(b"fake epub content")
    return str(epub_path)


class TestEpubParserInitialization:
    """测试 EpubParser 初始化"""

    def test_epub_parser_initialization(self, sample_epub_path):
        """测试 EpubParser 初始化"""
        parser = EpubParser(sample_epub_path)
        assert parser.epub_path == sample_epub_path
        assert parser.book is None

    def test_epub_parser_initialization_with_invalid_path(self):
        """测试使用无效路径初始化 EpubParser"""
        parser = EpubParser("/nonexistent/path.epub")
        assert parser.epub_path == "/nonexistent/path.epub"
        assert parser.book is None


class TestEpubParserLoad:
    """测试 EpubParser 加载功能"""

    @patch('pageindex.epub_parser.epub.read_epub')
    def test_epub_parser_load(self, mock_read_epub, mock_epub, sample_epub_path):
        """测试加载 EPUB 文件"""
        mock_read_epub.return_value = mock_epub

        parser = EpubParser(sample_epub_path)
        parser.load()

        assert parser.book == mock_epub
        mock_read_epub.assert_called_once_with(sample_epub_path)

    @patch('pageindex.epub_parser.epub.read_epub')
    def test_epub_parser_load_with_invalid_file(self, mock_read_epub, sample_epub_path):
        """测试加载无效的 EPUB 文件"""
        mock_read_epub.side_effect = Exception("Invalid EPUB file")

        parser = EpubParser(sample_epub_path)

        with pytest.raises(Exception, match="Invalid EPUB file"):
            parser.load()


class TestEpubParserMetadata:
    """测试 EpubParser 元数据提取"""

    @patch('pageindex.epub_parser.epub.read_epub')
    def test_get_metadata(self, mock_read_epub, mock_epub, sample_epub_path):
        """测试获取元数据"""
        mock_read_epub.return_value = mock_epub

        parser = EpubParser(sample_epub_path)
        parser.load()
        metadata = parser.get_metadata()

        assert isinstance(metadata, Dict)
        assert "title" in metadata
        assert "author" in metadata
        assert "language" in metadata
        assert metadata["title"] == "Test Book"
        assert metadata["author"] == "Test Author"
        assert metadata["language"] == "en"

    @patch('pageindex.epub_parser.epub.read_epub')
    def test_get_metadata_before_load(self, mock_read_epub, sample_epub_path):
        """测试在加载前获取元数据"""
        mock_read_epub.return_value = MagicMock()

        parser = EpubParser(sample_epub_path)

        with pytest.raises(ValueError, match="EPUB 文件未加载"):
            parser.get_metadata()


class TestEpubParserTOC:
    """测试 EpubParser 目录提取"""

    @patch('pageindex.epub_parser.epub.read_epub')
    def test_get_toc(self, mock_read_epub, mock_epub, sample_epub_path):
        """测试获取目录"""
        mock_read_epub.return_value = mock_epub

        parser = EpubParser(sample_epub_path)
        parser.load()
        toc = parser.get_toc()

        assert isinstance(toc, list)
        assert len(toc) == 2

    @patch('pageindex.epub_parser.epub.read_epub')
    def test_get_toc_before_load(self, mock_read_epub, sample_epub_path):
        """测试在加载前获取目录"""
        mock_read_epub.return_value = MagicMock()

        parser = EpubParser(sample_epub_path)

        with pytest.raises(ValueError, match="EPUB 文件未加载"):
            parser.get_toc()


class TestEpubParserChapters:
    """测试 EpubParser 章节提取"""

    @patch('pageindex.epub_parser.epub.read_epub')
    def test_get_chapters(self, mock_read_epub, mock_epub, sample_epub_path):
        """测试获取章节内容"""
        mock_read_epub.return_value = mock_epub

        parser = EpubParser(sample_epub_path)
        parser.load()
        chapters = parser.get_chapters()

        assert isinstance(chapters, list)
        # 应该有 3 个项目，但只有 2 个是 ITEM_DOCUMENT 类型
        # 实际返回的是 ITEM_DOCUMENT 类型的章节
        assert len(chapters) >= 2  # 至少有 2 个章节
        assert all(isinstance(chapter, Dict) for chapter in chapters)
        assert all("file_name" in chapter for chapter in chapters)
        assert all("content" in chapter for chapter in chapters)

        # 验证章节内容转换为纯文本（查找包含 chapter1 的章节）
        chapter1 = [c for c in chapters if "chapter1" in str(c["file_name"])][0]
        assert "Chapter 1" in chapter1["content"]
        assert "Content of chapter 1" in chapter1["content"]

    @patch('pageindex.epub_parser.epub.read_epub')
    def test_get_chapters_before_load(self, mock_read_epub, sample_epub_path):
        """测试在加载前获取章节"""
        mock_read_epub.return_value = MagicMock()

        parser = EpubParser(sample_epub_path)

        with pytest.raises(ValueError, match="EPUB 文件未加载"):
            parser.get_chapters()


class TestEpubParserHtmlToText:
    """测试 HTML 转纯文本功能"""

    def test_html_to_text_basic(self):
        """测试基本的 HTML 转换"""
        parser = EpubParser("/dummy/path.epub")

        html = "<html><body><h1>Title</h1><p>Paragraph</p></body></html>"
        text = parser._html_to_text(html)

        assert "Title" in text
        assert "Paragraph" in text
        assert "<h1>" not in text
        assert "<p>" not in text

    def test_html_to_text_ignores_links(self):
        """测试忽略链接"""
        parser = EpubParser("/dummy/path.epub")

        html = '<html><body><p>Check <a href="http://example.com">this link</a></p></body></html>'
        text = parser._html_to_text(html)

        assert "Check" in text
        assert "this link" in text
        assert '<a' not in text
        assert "href" not in text

    def test_html_to_text_ignores_images(self):
        """测试忽略图片"""
        parser = EpubParser("/dummy/path.epub")

        html = '<html><body><p>Text <img src="image.jpg" alt="Image"/> more text</p></body></html>'
        text = parser._html_to_text(html)

        assert "Text" in text
        assert "more text" in text
        assert "<img" not in text

    def test_html_to_text_ignores_emphasis(self):
        """测试忽略强调标记"""
        parser = EpubParser("/dummy/path.epub")

        html = "<html><body><p>This is <strong>bold</strong> and <em>italic</em> text</p></body></html>"
        text = parser._html_to_text(html)

        assert "This is" in text
        assert "bold" in text
        assert "and" in text
        assert "italic" in text
        assert "text" in text
        assert "<strong>" not in text
        assert "<em>" not in text


class TestEpubParserWithRealEpub:
    """使用真实 EPUB 文件的集成测试"""

    def test_epub_parser_load_real_file(self, sample_epub):
        """测试加载真实的 EPUB 文件"""
        parser = EpubParser(sample_epub)
        parser.load()

        assert parser.book is not None
        assert parser.epub_path == sample_epub

    def test_epub_parser_get_metadata_real(self, sample_epub):
        """测试从真实 EPUB 获取元数据"""
        parser = EpubParser(sample_epub)
        parser.load()
        metadata = parser.get_metadata()

        assert isinstance(metadata, Dict)
        assert "title" in metadata
        assert "author" in metadata
        assert "language" in metadata
        assert metadata["title"] == "Sample Test EPUB"
        assert metadata["author"] == "Test Author"
        assert metadata["language"] == "en"

    def test_epub_parser_get_toc_real(self, sample_epub):
        """测试从真实 EPUB 获取目录"""
        parser = EpubParser(sample_epub)
        parser.load()
        toc = parser.get_toc()

        assert isinstance(toc, list)
        assert len(toc) == 3  # 应该有 3 个章节

    def test_epub_parser_get_chapters_real(self, sample_epub):
        """测试从真实 EPUB 获取章节"""
        parser = EpubParser(sample_epub)
        parser.load()
        chapters = parser.get_chapters()

        assert isinstance(chapters, list)
        assert len(chapters) == 3  # 应该有 3 个章节
        assert all("file_name" in chapter for chapter in chapters)
        assert all("content" in chapter for chapter in chapters)

        # 验证第一章内容
        chapter1 = next((c for c in chapters if "chapter1" in c["file_name"]), None)
        assert chapter1 is not None
        assert "Chapter 1" in chapter1["content"]
        assert "Introduction" in chapter1["content"]

    def test_epub_parser_html_to_text_real(self, sample_epub):
        """测试真实 EPUB 的 HTML 转文本"""
        parser = EpubParser(sample_epub)
        parser.load()
        chapters = parser.get_chapters()

        # 验证 HTML 标签被正确移除
        for chapter in chapters:
            content = chapter["content"]
            # 不应该有 HTML 标签
            assert "<h1>" not in content
            assert "<p>" not in content
            assert "<html>" not in content
            # 应该有文本内容
            assert len(content.strip()) > 0

    def test_epub_parser_full_workflow(self, sample_epub):
        """测试完整的解析工作流"""
        parser = EpubParser(sample_epub)

        # 1. 加载
        parser.load()
        assert parser.book is not None

        # 2. 获取元数据
        metadata = parser.get_metadata()
        assert metadata["title"] == "Sample Test EPUB"

        # 3. 获取 TOC
        toc = parser.get_toc()
        assert len(toc) == 3

        # 4. 获取章节
        chapters = parser.get_chapters()
        assert len(chapters) == 3

        # 验证所有章节都有有效内容
        for chapter in chapters:
            assert "file_name" in chapter
            assert "content" in chapter
            assert len(chapter["content"]) > 0


class TestEpubParserWithNestedToc:
    """测试嵌套目录结构的 EPUB"""

    def test_nested_toc_structure(self, sample_epub_with_nested_toc):
        """测试嵌套 TOC 的解析"""
        parser = EpubParser(sample_epub_with_nested_toc)
        parser.load()

        toc = parser.get_toc()
        assert isinstance(toc, list)
        assert len(toc) > 0

    def test_nested_toc_metadata(self, sample_epub_with_nested_toc):
        """测试嵌套 TOC EPUB 的元数据"""
        parser = EpubParser(sample_epub_with_nested_toc)
        parser.load()

        metadata = parser.get_metadata()
        assert metadata["title"] == "Nested TOC Test EPUB"

    def test_nested_toc_chapters(self, sample_epub_with_nested_toc):
        """测试嵌套 TOC EPUB 的章节"""
        parser = EpubParser(sample_epub_with_nested_toc)
        parser.load()

        chapters = parser.get_chapters()
        assert len(chapters) == 4  # 应该有 4 个章节


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
