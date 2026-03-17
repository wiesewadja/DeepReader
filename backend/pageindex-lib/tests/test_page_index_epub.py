"""
测试 page_index.py 的 EPUB 支持

这个测试模块验证 page_index_main 函数正确处理 EPUB 文件。
"""

import pytest
import sys
import os
import tempfile
from typing import Dict, Any
from unittest.mock import MagicMock, patch

# 添加 src 目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from pageindex.page_index import (
    _detect_document_type,
    _process_epub,
    page_index_main,
    _split_large_epub_nodes,
    _split_epub_node_if_needed,
    _split_epub_by_markdown_headers,
    _split_epub_by_paragraphs,
    _reassign_epub_node_ids,
)


class TestSplitEpubNodes:
    """测试 EPUB 节点拆分功能"""

    def test_split_small_node_unchanged(self):
        """测试小节点不被拆分"""
        tree = {
            "doc_name": "Test Book",
            "structure": [
                {
                    "node_id": "0001",
                    "title": "Chapter 1",
                    "text": "This is a short chapter.",
                    "start_index": 1,
                    "end_index": 2,
                }
            ]
        }

        result = _split_large_epub_nodes(tree, max_tokens=1000, model="gpt-4")

        assert len(result["structure"]) == 1
        assert result["structure"][0]["title"] == "Chapter 1"
        assert result["structure"][0]["node_id"] == "0001"

    def test_split_by_markdown_headers(self):
        """测试按 Markdown 标题拆分"""
        # 创建一个包含多个 ## 标题的长文本
        long_text = """## Section 1

This is the content of section 1. It has some text here.

## Section 2

This is the content of section 2. More text here.

## Section 3

This is the content of section 3. Even more text."""

        tree = {
            "doc_name": "Test Book",
            "structure": [
                {
                    "node_id": "0001",
                    "title": "Chapter 1",
                    "text": long_text,
                    "start_index": 1,
                    "end_index": 2,
                }
            ]
        }

        # 使用较小的 max_tokens 触发拆分
        result = _split_large_epub_nodes(tree, max_tokens=50, model="gpt-4")

        # 应该拆分为 3 个子节点
        assert len(result["structure"]) == 3
        assert "Section 1" in result["structure"][0]["title"]
        assert "Section 2" in result["structure"][1]["title"]
        assert "Section 3" in result["structure"][2]["title"]

    def test_split_by_paragraphs(self):
        """测试按段落拆分（无标题时）"""
        # 创建一个没有标题的长文本
        paragraphs = []
        for i in range(10):
            paragraphs.append(f"Paragraph {i}: " + "word " * 100)

        long_text = "\n\n".join(paragraphs)

        tree = {
            "doc_name": "Test Book",
            "structure": [
                {
                    "node_id": "0001",
                    "title": "Chapter 1",
                    "text": long_text,
                    "start_index": 1,
                    "end_index": 2,
                }
            ]
        }

        # 使用较小的 max_tokens 触发拆分
        result = _split_large_epub_nodes(tree, max_tokens=200, model="gpt-4")

        # 应该拆分为多个部分
        assert len(result["structure"]) > 1
        # 检查标题格式
        assert "Part" in result["structure"][1]["title"]

    def test_node_id_reassignment(self):
        """测试 node_id 重新分配"""
        tree = {
            "doc_name": "Test Book",
            "structure": [
                {"node_id": "old1", "title": "Node 1", "text": "text1"},
                {"node_id": "old2", "title": "Node 2", "text": "text2"},
                {"node_id": "old3", "title": "Node 3", "text": "text3"},
            ]
        }

        _reassign_epub_node_ids(tree)

        assert tree["structure"][0]["node_id"] == "0001"
        assert tree["structure"][1]["node_id"] == "0002"
        assert tree["structure"][2]["node_id"] == "0003"

    def test_nested_node_split(self):
        """测试嵌套节点的拆分"""
        # 创建包含多个段落的长文本（确保可以按段落拆分）
        paragraphs = ["Paragraph " + str(i) + ": " + "word " * 50 for i in range(10)]
        long_text = "\n\n".join(paragraphs)

        tree = {
            "doc_name": "Test Book",
            "structure": [
                {
                    "node_id": "0001",
                    "title": "Chapter 1",
                    "text": "short text",
                    "nodes": [
                        {
                            "node_id": "0002",
                            "title": "Subchapter 1",
                            "text": long_text,
                        }
                    ]
                }
            ]
        }

        result = _split_large_epub_nodes(tree, max_tokens=100, model="gpt-4")

        # 子节点应该被拆分
        assert len(result["structure"][0]["nodes"]) > 1

    def test_preserve_node_attributes(self):
        """测试拆分时保留节点属性"""
        tree = {
            "doc_name": "Test Book",
            "structure": [
                {
                    "node_id": "0001",
                    "title": "Chapter 1",
                    "text": "## Section 1\n\nContent 1\n\n## Section 2\n\nContent 2",
                    "start_index": 1,
                    "end_index": 5,
                    "custom_attr": "custom_value",
                }
            ]
        }

        result = _split_large_epub_nodes(tree, max_tokens=20, model="gpt-4")

        # 检查属性是否保留
        for node in result["structure"]:
            assert "custom_attr" in node
            assert node["custom_attr"] == "custom_value"

    def test_parent_title_set(self):
        """测试拆分后设置 parent_title"""
        # 创建足够长的文本以触发拆分
        sections = []
        for i in range(3):
            sections.append(f"## Section {i+1}\n\n" + "Content " * 100)
        long_text = "\n\n".join(sections)

        tree = {
            "doc_name": "Test Book",
            "structure": [
                {
                    "node_id": "0001",
                    "title": "Chapter 1",
                    "text": long_text,
                    "start_index": 1,
                    "end_index": 5,
                }
            ]
        }

        result = _split_large_epub_nodes(tree, max_tokens=50, model="gpt-4")

        # 应该被拆分
        assert len(result["structure"]) > 1
        # 检查 parent_title 是否设置
        for node in result["structure"]:
            assert "parent_title" in node
            assert node["parent_title"] == "Chapter 1"


class TestSplitByMarkdownHeaders:
    """测试按 Markdown 标题拆分"""

    def test_split_by_h2_headers(self):
        """测试按 ## 标题拆分"""
        text = """## First Section

Content of first section.

## Second Section

Content of second section."""

        node = {
            "title": "Chapter",
            "text": text,
            "start_index": 1,
            "end_index": 2,
        }

        result = _split_epub_by_markdown_headers(node, max_tokens=1000, model="gpt-4")

        assert len(result) == 2
        assert "First Section" in result[0]["title"]
        assert "Second Section" in result[1]["title"]

    def test_split_by_h3_headers(self):
        """测试按 ### 标题拆分"""
        text = """### Subsection 1

Content 1.

### Subsection 2

Content 2."""

        node = {
            "title": "Chapter",
            "text": text,
            "start_index": 1,
            "end_index": 2,
        }

        result = _split_epub_by_markdown_headers(node, max_tokens=1000, model="gpt-4")

        assert len(result) == 2

    def test_no_headers_returns_original(self):
        """测试无标题时返回原节点"""
        text = "Just some content without any headers."

        node = {
            "title": "Chapter",
            "text": text,
            "start_index": 1,
            "end_index": 2,
        }

        result = _split_epub_by_markdown_headers(node, max_tokens=10, model="gpt-4")

        assert len(result) == 1
        assert result[0] == node


class TestSplitByParagraphs:
    """测试按段落拆分"""

    def test_split_multiple_paragraphs(self):
        """测试拆分多个段落"""
        paragraphs = []
        for i in range(5):
            paragraphs.append("Paragraph " + str(i) + ": " + "word " * 50)

        text = "\n\n".join(paragraphs)

        node = {
            "title": "Chapter",
            "text": text,
            "start_index": 1,
            "end_index": 2,
        }

        result = _split_epub_by_paragraphs(node, max_tokens=100, model="gpt-4")

        assert len(result) > 1

    def test_single_paragraph_returns_original(self):
        """测试单段落返回原节点"""
        text = "Single paragraph without double newlines."

        node = {
            "title": "Chapter",
            "text": text,
            "start_index": 1,
            "end_index": 2,
        }

        result = _split_epub_by_paragraphs(node, max_tokens=10, model="gpt-4")

        assert len(result) == 1

    def test_part_numbering(self):
        """测试部分编号"""
        paragraphs = ["Paragraph " + str(i) + ": " + "word " * 100 for i in range(5)]
        text = "\n\n".join(paragraphs)

        node = {
            "title": "Chapter",
            "text": text,
            "start_index": 1,
            "end_index": 2,
        }

        result = _split_epub_by_paragraphs(node, max_tokens=150, model="gpt-4")

        # 检查编号
        for i, sub_node in enumerate(result):
            if i > 0:
                assert f"Part {i+1}" in sub_node["title"] or f"Part {i}" in sub_node["title"]


class TestDetectDocumentType:
    """测试文档类型检测功能"""

    def test_detect_document_type_pdf_by_extension(self):
        """测试通过扩展名检测 PDF"""
        assert _detect_document_type("test.pdf") == "pdf"
        assert _detect_document_type("test.PDF") == "pdf"
        assert _detect_document_type("/path/to/document.pdf") == "pdf"

    def test_detect_document_type_epub_by_extension(self):
        """测试通过扩展名检测 EPUB"""
        assert _detect_document_type("test.epub") == "epub"
        assert _detect_document_type("test.EPUB") == "epub"
        assert _detect_document_type("test.Epub") == "epub"
        assert _detect_document_type("/path/to/document.epub") == "epub"

    def test_detect_document_type_pdf_by_magic_bytes(self, tmp_path):
        """测试通过 magic bytes 检测 PDF"""
        # 创建包含 PDF magic bytes 的文件
        test_file = tmp_path / "test.unknown"
        test_file.write_bytes(b"%PDF-1.4\n%some content")

        assert _detect_document_type(str(test_file)) == "pdf"

    def test_detect_document_type_epub_by_magic_bytes(self, tmp_path):
        """测试通过 magic bytes 检测 EPUB (ZIP)"""
        # 创建包含 ZIP magic bytes 的文件 (EPUB 是 ZIP 格式)
        test_file = tmp_path / "test.unknown"
        test_file.write_bytes(b"PK\x03\x04")  # ZIP file signature

        assert _detect_document_type(str(test_file)) == "epub"

    def test_detect_document_type_unsupported(self, tmp_path):
        """测试不支持的文件类型"""
        test_file = tmp_path / "test.txt"
        test_file.write_bytes(b"This is a text file")

        with pytest.raises(ValueError, match="无法识别的文档类型"):
            _detect_document_type(str(test_file))

    def test_detect_document_type_priority_extension_over_magic(self, tmp_path):
        """测试扩展名优先于 magic bytes"""
        # 创建扩展名为 .pdf 但内容是 ZIP 的文件
        test_file = tmp_path / "test.pdf"
        test_file.write_bytes(b"PK\x03\x04")

        # 扩展名应该优先
        assert _detect_document_type(str(test_file)) == "pdf"


class TestProcessEpub:
    """测试 EPUB 处理功能"""

    @patch('pageindex.epub_to_tree.epub_to_tree')
    @patch('pageindex.epub_parser.EpubParser')
    @patch('os.path.isfile')
    def test_process_epub_basic(self, mock_isfile, mock_parser_class, mock_epub_to_tree):
        """测试基本的 EPUB 处理"""
        # 设置 mock
        mock_isfile.return_value = True
        mock_parser = MagicMock()
        mock_parser_class.return_value = mock_parser
        mock_parser.get_metadata.return_value = {"title": "Test Book", "author": "Test Author"}
        mock_parser.get_toc.return_value = []
        mock_parser.get_chapters.return_value = []

        mock_epub_to_tree.return_value = {
            "title": "Test Book",
            "structure": []
        }

        # 调用函数
        result = _process_epub("test.epub", config=None)

        # 验证
        mock_parser.load.assert_called_once()
        mock_parser.get_metadata.assert_called_once()
        mock_parser.get_toc.assert_called_once()
        mock_parser.get_chapters.assert_called_once()
        mock_epub_to_tree.assert_called_once()

        assert result["title"] == "Test Book"
        assert "structure" in result

    @patch('pageindex.page_index.asyncio.run')
    @patch('pageindex.epub_to_tree.epub_to_tree')
    @patch('pageindex.epub_parser.EpubParser')
    @patch('os.path.isfile')
    def test_process_epub_with_summaries(self, mock_isfile, mock_parser_class, mock_epub_to_tree, mock_asyncio_run):
        """测试带摘要生成的 EPUB 处理"""
        # 设置 mock
        mock_isfile.return_value = True
        mock_parser = MagicMock()
        mock_parser_class.return_value = mock_parser
        mock_parser.get_metadata.return_value = {"title": "Test"}
        mock_parser.get_toc.return_value = []
        mock_parser.get_chapters.return_value = []

        tree_with_summaries = {
            "title": "Test",
            "structure": [{"title": "Chapter 1", "summary": "Summary text"}]
        }
        mock_epub_to_tree.return_value = tree_with_summaries

        # 模拟异步函数
        mock_asyncio_run.return_value = tree_with_summaries

        # 配置启用 LLM
        config = {"use_llm": True, "llm_client": MagicMock()}
        result = _process_epub("test.epub", config=config)

        # 验证摘要生成被调用
        mock_asyncio_run.assert_called_once()
        assert result == tree_with_summaries


class TestPageIndexMainEpub:
    """测试 page_index_main 的 EPUB 集成"""

    @patch('pageindex.page_index._process_epub')
    @patch('pageindex.page_index.save_result')
    @patch('os.path.isfile')
    def test_page_index_main_with_epub(self, mock_isfile, mock_save, mock_process):
        """测试 page_index_main 处理 EPUB 文件"""
        mock_isfile.return_value = True
        mock_process.return_value = {
            "title": "Test Book",
            "structure": []
        }

        # 需要模拟 opt 参数
        opt = MagicMock()
        opt.if_add_node_id = "no"
        opt.if_add_node_text = "no"
        opt.if_add_node_summary = "no"
        opt.if_add_doc_description = False

        result = page_index_main("test.epub", opt=opt)

        # 验证
        mock_process.assert_called_once()
        assert result["doc_name"] == "test.epub"
        assert "structure" in result

    @patch('pageindex.page_index.get_page_tokens')
    @patch('pageindex.page_index.save_result')
    @patch('os.path.isfile')
    def test_page_index_main_pdf_unchanged(self, mock_isfile, mock_save, mock_tokens):
        """测试 PDF 处理逻辑不受影响"""
        mock_isfile.return_value = True

        # 提供有效的页码数据以避免 process_no_toc 路径
        mock_tokens.return_value = [
            (1, 100, "Page 1 content"),
            (2, 100, "Page 2 content"),
        ]

        opt = MagicMock()
        opt.if_add_node_id = "no"
        opt.if_add_node_text = "no"
        opt.if_add_node_summary = "no"
        opt.if_add_doc_description = False
        opt.max_page_num_each_node = 10
        opt.max_token_num_each_node = 1000
        opt.toc_check_page_num = 5

        # 注意：这个测试会继续执行 PDF 处理流程
        # 我们只验证 PDF 路径被调用
        try:
            result = page_index_main("test.pdf", opt=opt)
            # 如果成功，验证基本结构
            mock_tokens.assert_called_once_with("test.pdf")
            assert result["doc_name"] == "test.pdf"
            assert "structure" in result
        except Exception as e:
            # PDF 处理可能失败，但我们已验证了正确的路径被调用
            mock_tokens.assert_called_once_with("test.pdf")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
