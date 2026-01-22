# tests/test_agent_tools.py
"""工具模块单元测试"""
import pytest
from deeppdf.agent.tools import InspectTocTool


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
