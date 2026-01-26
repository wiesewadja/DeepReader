# tests/test_markdown_locator.py
"""MarkdownLocator 单元测试"""

import pytest
from deeppdf.agent.markdown_locator import MarkdownLocator


def test_find_file_with_valid_node_id():
    """测试: 使用有效的 node_id 查找文件"""
    index_metadata = {
        "pdf_name": "Test Document.pdf",
        "markdown_files": {
            "node_1": "chapter1.md",
            "node_2": "chapter2.md",
            "node_3": "chapter3.md",
        },
    }

    locator = MarkdownLocator(index_metadata)

    assert locator.find_file("node_1") == "chapter1.md"
    assert locator.find_file("node_2") == "chapter2.md"
    assert locator.find_file("node_3") == "chapter3.md"


def test_find_file_with_invalid_node_id():
    """测试: 使用无效的 node_id 查找文件"""
    index_metadata = {
        "pdf_name": "Test Document.pdf",
        "markdown_files": {"node_1": "chapter1.md"},
    }

    locator = MarkdownLocator(index_metadata)

    assert locator.find_file("nonexistent") is None
    assert locator.find_file("") is None
    assert locator.find_file("node_999") is None


def test_find_file_with_empty_markdown_files():
    """测试: markdown_files 为空字典"""
    index_metadata = {"pdf_name": "Test Document.pdf", "markdown_files": {}}

    locator = MarkdownLocator(index_metadata)

    assert locator.find_file("node_1") is None


def test_generate_obsidian_link_with_page_num():
    """测试: 生成带页码的 Obsidian 链接"""
    index_metadata = {
        "pdf_name": "Test Document.pdf",
        "markdown_files": {"node_1": "chapter1.md"},
    }

    locator = MarkdownLocator(index_metadata)

    assert locator.generate_obsidian_link("node_1", 5) == "[[chapter1.md#^page-5]]"
    assert locator.generate_obsidian_link("node_1", 1) == "[[chapter1.md#^page-1]]"
    assert locator.generate_obsidian_link("node_1", 100) == "[[chapter1.md#^page-100]]"


def test_generate_obsidian_link_without_page_num():
    """测试: 生成不带页码的 Obsidian 链接"""
    index_metadata = {
        "pdf_name": "Test Document.pdf",
        "markdown_files": {"node_1": "chapter1.md"},
    }

    locator = MarkdownLocator(index_metadata)

    assert locator.generate_obsidian_link("node_1") == "[[chapter1.md]]"
    assert locator.generate_obsidian_link("node_1", None) == "[[chapter1.md]]"


def test_generate_obsidian_link_with_unknown_node_id():
    """测试: 使用未知的 node_id 生成链接（回退到 PDF 名称）"""
    index_metadata = {
        "pdf_name": "Test Document.pdf",
        "markdown_files": {"node_1": "chapter1.md"},
    }

    locator = MarkdownLocator(index_metadata)

    assert locator.generate_obsidian_link("unknown_node") == "[[Test Document.pdf]]"
    assert locator.generate_obsidian_link("unknown_node", 5) == "[[Test Document.pdf]]"


def test_generate_obsidian_link_with_empty_pdf_name():
    """测试: PDF 名称为空时的回退行为"""
    index_metadata = {"pdf_name": "", "markdown_files": {}}

    locator = MarkdownLocator(index_metadata)

    assert locator.generate_obsidian_link("unknown_node") == "[[Unknown]]"


def test_generate_obsidian_link_with_missing_pdf_name():
    """测试: 缺少 pdf_name 字段时的默认值"""
    index_metadata = {"markdown_files": {}}

    locator = MarkdownLocator(index_metadata)

    assert locator.generate_obsidian_link("unknown_node") == "[[Unknown]]"


def test_generate_citation_metadata_returns_complete_structure():
    """测试: 生成完整的引用元数据结构"""
    index_metadata = {
        "pdf_name": "Test Document.pdf",
        "markdown_files": {"node_1": "chapter1.md"},
    }

    locator = MarkdownLocator(index_metadata)
    citation = locator.generate_citation_metadata("node_1", 5, "这是一段测试文本")

    assert citation["node_id"] == "node_1"
    assert citation["obsidian_link"] == "[[chapter1.md#^page-5]]"
    assert citation["page"] == 5
    assert citation["anchor"] == "^page-5"
    assert citation["text"] == "这是一段测试文本"


def test_generate_citation_metadata_without_page_num():
    """测试: 不带页码的引用元数据"""
    index_metadata = {
        "pdf_name": "Test Document.pdf",
        "markdown_files": {"node_1": "chapter1.md"},
    }

    locator = MarkdownLocator(index_metadata)
    citation = locator.generate_citation_metadata("node_1", None, "测试文本")

    assert citation["node_id"] == "node_1"
    assert citation["obsidian_link"] == "[[chapter1.md]]"
    assert citation["page"] is None
    assert citation["anchor"] == ""
    assert citation["text"] == "测试文本"


def test_generate_citation_metadata_with_unknown_node():
    """测试: 使用未知 node_id 的引用元数据"""
    index_metadata = {
        "pdf_name": "Test Document.pdf",
        "markdown_files": {"node_1": "chapter1.md"},
    }

    locator = MarkdownLocator(index_metadata)
    citation = locator.generate_citation_metadata("unknown", 5, "测试文本")

    assert citation["node_id"] == "unknown"
    assert citation["obsidian_link"] == "[[Test Document.pdf]]"
    assert citation["page"] == 5
    assert citation["anchor"] == "^page-5"
    assert citation["text"] == "测试文本"
