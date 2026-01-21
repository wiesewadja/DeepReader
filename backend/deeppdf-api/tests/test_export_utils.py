"""
导出工具函数测试
测试 export_utils 中的辅助函数
"""
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock
from deeppdf.api.export_utils import (
    get_pdf_page_count,
    build_parent_mapping,
    find_parent_id,
    format_created_at
)


class TestGetPdfPageCount:
    """测试 get_pdf_page_count 函数"""

    @patch('deeppdf.api.export_utils.pypdf.PdfReader')
    def test_valid_pdf_returns_page_count(self, mock_reader_class):
        """测试有效 PDF 返回页数"""
        mock_reader = MagicMock()
        mock_reader.pages = [1, 2, 3, 4, 5]  # 5 页
        mock_reader_class.return_value = mock_reader

        result = get_pdf_page_count("/path/to/file.pdf")
        assert result == 5

    @patch('deeppdf.api.export_utils.pypdf.PdfReader')
    def test_pdf_with_zero_pages(self, mock_reader_class):
        """测试空 PDF"""
        mock_reader = MagicMock()
        mock_reader.pages = []
        mock_reader_class.return_value = mock_reader

        result = get_pdf_page_count("/path/to/empty.pdf")
        assert result == 0

    @patch('deeppdf.api.export_utils.pypdf.PdfReader')
    def test_file_not_found_returns_zero(self, mock_reader_class):
        """测试文件不存在返回 0"""
        mock_reader_class.side_effect = FileNotFoundError()

        result = get_pdf_page_count("/nonexistent/file.pdf")
        assert result == 0

    @patch('deeppdf.api.export_utils.pypdf.PdfReader')
    def test_other_exception_returns_zero(self, mock_reader_class):
        """测试其他异常返回 0"""
        mock_reader_class.side_effect = Exception("Unknown error")

        result = get_pdf_page_count("/path/to/file.pdf")
        assert result == 0


class TestBuildParentMapping:
    """测试 build_parent_mapping 函数"""

    def test_single_root_node(self):
        """测试单根节点"""
        tree = [{"node_id": "root", "nodes": []}]
        mapping = build_parent_mapping(tree)
        assert mapping == {"root": None}

    def test_two_level_tree(self):
        """测试两层树结构"""
        tree = [
            {
                "node_id": "root",
                "nodes": [
                    {"node_id": "child1", "nodes": []},
                    {"node_id": "child2", "nodes": []}
                ]
            }
        ]
        mapping = build_parent_mapping(tree)
        assert mapping == {
            "root": None,
            "child1": "root",
            "child2": "root"
        }

    def test_three_level_tree(self):
        """测试三层树结构"""
        tree = [
            {
                "node_id": "root",
                "nodes": [
                    {
                        "node_id": "child1",
                        "nodes": [
                            {"node_id": "grandchild1", "nodes": []}
                        ]
                    }
                ]
            }
        ]
        mapping = build_parent_mapping(tree)
        assert mapping == {
            "root": None,
            "child1": "root",
            "grandchild1": "child1"
        }

    def test_multiple_root_nodes(self):
        """测试多个根节点"""
        tree = [
            {"node_id": "root1", "nodes": []},
            {"node_id": "root2", "nodes": []}
        ]
        mapping = build_parent_mapping(tree)
        assert mapping == {
            "root1": None,
            "root2": None
        }

    def test_node_without_id_is_skipped(self):
        """测试没有 node_id 的节点被跳过"""
        tree = [
            {"node_id": "root", "nodes": []},
            {"name": "unnamed", "nodes": []}  # 没有 node_id
        ]
        mapping = build_parent_mapping(tree)
        assert mapping == {"root": None}

    def test_empty_tree_returns_empty_mapping(self):
        """测试空树返回空映射"""
        mapping = build_parent_mapping([])
        assert mapping == {}


class TestFindParentId:
    """测试 find_parent_id 函数"""

    def test_find_root_parent(self):
        """测试查找根节点的父节点"""
        tree = [{"node_id": "root", "nodes": []}]
        result = find_parent_id("root", tree)
        assert result is None

    def test_find_child_parent(self):
        """测试查找子节点的父节点"""
        tree = [
            {
                "node_id": "root",
                "nodes": [
                    {"node_id": "child1", "nodes": []}
                ]
            }
        ]
        result = find_parent_id("child1", tree)
        assert result == "root"

    def test_find_grandchild_parent(self):
        """测试查找孙节点的父节点"""
        tree = [
            {
                "node_id": "root",
                "nodes": [
                    {
                        "node_id": "child1",
                        "nodes": [
                            {"node_id": "grandchild1", "nodes": []}
                        ]
                    }
                ]
            }
        ]
        result = find_parent_id("grandchild1", tree)
        assert result == "child1"

    def test_find_nonexistent_node(self):
        """测试查找不存在的节点"""
        tree = [{"node_id": "root", "nodes": []}]
        result = find_parent_id("nonexistent", tree)
        assert result is None


class TestFormatCreatedAt:
    """测试 format_created_at 函数"""

    def test_standard_format(self):
        """测试标准格式转换"""
        result = format_created_at("2026-01-21 10:00:00")
        assert result == "2026-01-21T10:00:00Z"

    def test_different_datetime(self):
        """测试不同时间"""
        result = format_created_at("2025-12-31 23:59:59")
        assert result == "2025-12-31T23:59:59Z"

    def test_midnight_time(self):
        """测试午夜时间"""
        result = format_created_at("2026-01-01 00:00:00")
        assert result == "2026-01-01T00:00:00Z"

    def test_already_has_t(self):
        """测试已经有 T 的格式（虽然不应该出现）"""
        # 输入应该总是空格分隔，但测试鲁棒性
        result = format_created_at("2026-01-21T10:00:00")
        # 会把 T 替换成 T（同一字符），然后加 Z
        assert result == "2026-01-21T10:00:00Z"
