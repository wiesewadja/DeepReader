# tests/test_agent_tools.py
"""工具模块单元测试"""
import pytest
from unittest.mock import Mock, patch
from deeppdf.agent.tools import InspectTocTool, ReadPageTool


def test_inspect_toc_with_valid_structure():
    """测试: 正常目录结构"""
    tree_structure = {
        "structure": [
            {
                "title": "第一章：引言",
                "node_id": "node_1",
                "start_index": 1,
                "end_index": 10,
                "nodes": [
                    {
                        "title": "1.1 研究背景",
                        "node_id": "node_1_1",
                        "start_index": 1,
                        "end_index": 5,
                        "nodes": []
                    }
                ]
            },
            {
                "title": "第二章：方法",
                "node_id": "node_2",
                "start_index": 11,
                "end_index": 20,
                "nodes": []
            }
        ]
    }

    tool = InspectTocTool(tree_structure)
    result = tool()

    assert "第一章：引言" in result
    assert "第 1-10 页" in result
    assert "1.1 研究背景" in result
    assert "第二章：方法" in result


def test_inspect_toc_with_empty_structure():
    """测试: 空目录结构"""
    tool = InspectTocTool({"structure": []})
    result = tool()

    assert "没有目录结构" in result


def test_inspect_toc_with_nested_structure():
    """测试: 多层嵌套结构"""
    tree_structure = {
        "structure": [
            {
                "title": "第一篇",
                "node_id": "node_1",
                "start_index": 1,
                "end_index": 100,
                "nodes": [
                    {
                        "title": "第一章",
                        "node_id": "node_1_1",
                        "start_index": 1,
                        "end_index": 50,
                        "nodes": [
                            {
                                "title": "1.1 小节",
                                "node_id": "node_1_1_1",
                                "start_index": 1,
                                "end_index": 10,
                                "nodes": []
                            }
                        ]
                    }
                ]
            }
        ]
    }

    tool = InspectTocTool(tree_structure)
    result = tool()

    assert "第一篇" in result
    assert "  - 第一章" in result  # 缩进2空格 + "- "
    assert "    - 1.1 小节" in result  # 缩进4空格 + "- "


def test_read_page_with_valid_page():
    """测试: 读取有效页码"""
    # 创建工具实例
    tool = ReadPageTool(
        pageindex_lib_path="/fake/path",
        index_id="test_idx",
        storage_dir="/fake/storage"
    )

    # Mock PageIndex 实例
    mock_pi = Mock()
    mock_pi.page_count = 100
    mock_pi.get_text_with_tags.return_value = "这是第一页的内容\n<physical_index_1>"

    # 直接设置 _pi 属性，跳过 _load_page_index
    tool._pi = mock_pi

    result = tool(page_num=1)

    assert "第 1 页内容" in result
    assert "这是第一页的内容" in result
    mock_pi.get_text_with_tags.assert_called_once_with(1)


def test_read_page_with_invalid_page():
    """测试: 读取超出范围的页码"""
    tool = ReadPageTool(
        pageindex_lib_path="/fake/path",
        index_id="test_idx",
        storage_dir="/fake/storage"
    )

    mock_pi = Mock()
    mock_pi.page_count = 10

    tool._pi = mock_pi
    result = tool(page_num=999)

    assert "错误" in result
    assert "超出范围" in result
    assert "10 页" in result


def test_read_page_with_error():
    """测试: PageIndex 加载失败"""
    tool = ReadPageTool(
        pageindex_lib_path="/fake/path",
        index_id="test_idx",
        storage_dir="/fake/storage"
    )

    # Mock _load_page_index 方法抛出异常
    with patch.object(tool, '_load_page_index', side_effect=Exception("文件不存在")):
        result = tool(page_num=1)

        assert "错误" in result
        assert "读取页面失败" in result
