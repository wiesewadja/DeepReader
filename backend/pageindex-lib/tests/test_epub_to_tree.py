"""
测试 EPUB → PageIndex 树结构转换器模块

这个测试模块验证 EpubTreeConverter 类和 epub_to_tree 函数的正确性。
"""

import pytest
import sys
import os

# 添加 src 目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from pageindex.epub_to_tree import epub_to_tree, EpubTreeConverter


class TestEpubToTreeBasic:
    """测试基本的 EPUB → tree 转换"""

    def test_epub_to_tree_basic(self):
        """测试基本的 EPUB → tree 转换"""
        epub_data = {
            "metadata": {"title": "Test Book", "author": "Test Author"},
            "toc": [],
            "chapters": [
                {"file_name": "chapter1.xhtml", "content": "Chapter 1 content"},
            ],
        }

        tree = epub_to_tree(epub_data, assign_node_ids=True)

        assert tree["title"] == "Test Book"
        assert "structure" in tree
        assert isinstance(tree["structure"], list)

    def test_epub_to_tree_without_node_ids(self):
        """测试不分配 node_id 的转换"""
        epub_data = {
            "metadata": {"title": "Test Book"},
            "toc": [],
            "chapters": [],
        }

        tree = epub_to_tree(epub_data, assign_node_ids=False)

        assert tree["title"] == "Test Book"
        assert isinstance(tree["structure"], list)
        # 验证没有 node_id
        if tree["structure"]:
            assert "node_id" not in tree["structure"][0]


class TestEpubTreeConverter:
    """测试 EpubTreeConverter 类"""

    def test_converter_with_empty_toc(self):
        """测试空 TOC 的转换"""
        epub_data = {
            "metadata": {"title": "Test"},
            "toc": [],
            "chapters": [],
        }

        converter = EpubTreeConverter()
        tree = converter.convert(epub_data, assign_node_ids=False)

        assert tree["title"] == "Test"
        assert tree["structure"] == []

    def test_converter_with_simple_toc(self):
        """测试简单 TOC 的转换"""
        from ebooklib import epub

        # 模拟简单 TOC 结构
        link1 = epub.Link("chapter1.xhtml", "Chapter 1", "ch1")
        link2 = epub.Link("chapter2.xhtml", "Chapter 2", "ch2")

        epub_data = {
            "metadata": {"title": "Test Book"},
            "toc": [link1, link2],
            "chapters": [
                {"file_name": "chapter1.xhtml", "content": "Content 1"},
                {"file_name": "chapter2.xhtml", "content": "Content 2"},
            ],
        }

        converter = EpubTreeConverter()
        tree = converter.convert(epub_data, assign_node_ids=False)

        assert len(tree["structure"]) == 2
        assert tree["structure"][0]["title"] == "Chapter 1"
        assert tree["structure"][1]["title"] == "Chapter 2"
        assert "text" in tree["structure"][0]

    def test_node_id_assignment(self):
        """测试 node_id 分配"""
        from ebooklib import epub

        link1 = epub.Link("chapter1.xhtml", "Chapter 1", "ch1")
        link2 = epub.Link("chapter2.xhtml", "Chapter 2", "ch2")
        link3 = epub.Link("chapter3.xhtml", "Chapter 3", "ch3")

        epub_data = {
            "metadata": {"title": "Test"},
            "toc": [link1, link2, link3],
            "chapters": [
                {"file_name": "chapter1.xhtml", "content": "Content 1"},
                {"file_name": "chapter2.xhtml", "content": "Content 2"},
                {"file_name": "chapter3.xhtml", "content": "Content 3"},
            ],
        }

        converter = EpubTreeConverter()
        tree = converter.convert(epub_data, assign_node_ids=True)

        assert tree["structure"][0]["node_id"] == "0001"
        assert tree["structure"][1]["node_id"] == "0002"
        assert tree["structure"][2]["node_id"] == "0003"

    def test_nested_toc(self):
        """测试嵌套 TOC 结构"""
        from ebooklib import epub

        # 模拟嵌套 TOC: (Link, [Link, Link])
        section = epub.Section("Part 1")
        link1 = epub.Link("chapter1.xhtml", "Chapter 1", "ch1")
        link2 = epub.Link("chapter2.xhtml", "Chapter 2", "ch2")

        epub_data = {
            "metadata": {"title": "Test"},
            "toc": [(section, [link1, link2])],
            "chapters": [
                {"file_name": "chapter1.xhtml", "content": "Content 1"},
                {"file_name": "chapter2.xhtml", "content": "Content 2"},
            ],
        }

        converter = EpubTreeConverter()
        tree = converter.convert(epub_data, assign_node_ids=False)

        assert tree["structure"][0]["title"] == "Part 1"
        assert "nodes" in tree["structure"][0]
        assert len(tree["structure"][0]["nodes"]) == 2

    def test_nested_toc_with_node_ids(self):
        """测试嵌套 TOC 的 node_id 分配"""
        from ebooklib import epub

        section = epub.Section("Part 1")
        link1 = epub.Link("chapter1.xhtml", "Chapter 1", "ch1")
        link2 = epub.Link("chapter2.xhtml", "Chapter 2", "ch2")

        epub_data = {
            "metadata": {"title": "Test"},
            "toc": [(section, [link1, link2])],
            "chapters": [
                {"file_name": "chapter1.xhtml", "content": "Content 1"},
                {"file_name": "chapter2.xhtml", "content": "Content 2"},
            ],
        }

        converter = EpubTreeConverter()
        tree = converter.convert(epub_data, assign_node_ids=True)

        # 父节点
        assert tree["structure"][0]["node_id"] == "0001"
        # 子节点
        assert tree["structure"][0]["nodes"][0]["node_id"] == "0002"
        assert tree["structure"][0]["nodes"][1]["node_id"] == "0003"

    def test_converter_preserves_chapter_content(self):
        """测试转换器保留章节内容"""
        from ebooklib import epub

        link = epub.Link("chapter1.xhtml", "Chapter 1", "ch1")

        epub_data = {
            "metadata": {"title": "Test"},
            "toc": [link],
            "chapters": [
                {"file_name": "chapter1.xhtml", "content": "This is the chapter content."},
            ],
        }

        converter = EpubTreeConverter()
        tree = converter.convert(epub_data, assign_node_ids=False)

        assert "text" in tree["structure"][0]
        assert "This is the chapter content" in tree["structure"][0]["text"]

    def test_converter_with_multiple_converts(self):
        """测试多次转换会重置计数器"""
        from ebooklib import epub

        link1 = epub.Link("chapter1.xhtml", "Chapter 1", "ch1")

        epub_data = {
            "metadata": {"title": "Test"},
            "toc": [link1],
            "chapters": [{"file_name": "chapter1.xhtml", "content": "Content"}],
        }

        converter = EpubTreeConverter()

        # 第一次转换
        tree1 = converter.convert(epub_data, assign_node_ids=True)
        assert tree1["structure"][0]["node_id"] == "0001"

        # 第二次转换
        tree2 = converter.convert(epub_data, assign_node_ids=True)
        assert tree2["structure"][0]["node_id"] == "0001"


class TestEpubToTreeEdgeCases:
    """测试边界情况"""

    def test_empty_metadata(self):
        """测试空元数据"""
        epub_data = {
            "metadata": {},
            "toc": [],
            "chapters": [],
        }

        tree = epub_to_tree(epub_data, assign_node_ids=False)
        assert tree["title"] == ""

    def test_missing_chapter_content(self):
        """测试章节内容缺失"""
        from ebooklib import epub

        link = epub.Link("missing.xhtml", "Missing Chapter", "missing")

        epub_data = {
            "metadata": {"title": "Test"},
            "toc": [link],
            "chapters": [],  # 空章节列表
        }

        converter = EpubTreeConverter()
        tree = converter.convert(epub_data, assign_node_ids=False)

        # 应该仍然创建节点，但 text 为空
        assert len(tree["structure"]) == 1
        assert tree["structure"][0]["title"] == "Missing Chapter"
        assert tree["structure"][0]["text"] == ""

    def test_malformed_toc_item(self):
        """测试格式错误的 TOC 项"""
        # 使用无效的 TOC 项
        epub_data = {
            "metadata": {"title": "Test"},
            "toc": ["invalid_item"],  # 字符串而不是 Link
            "chapters": [],
        }

        converter = EpubTreeConverter()
        tree = converter.convert(epub_data, assign_node_ids=False)

        # 应该跳过无效项
        assert tree["structure"] == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
