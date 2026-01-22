# tests/test_executor.py
"""工具执行器测试"""
import pytest
from deeppdf.agent.executor import ToolExecutor, create_tool_executor


def test_execute_valid_tool():
    """测试: 执行有效工具"""
    from deeppdf.agent.tools import InspectTocTool

    tool = InspectTocTool({"structure": []})
    executor = ToolExecutor({"test_tool": tool})

    result = executor.execute("test_tool")

    assert "[SUCCESS]" in result


def test_execute_invalid_tool():
    """测试: 执行无效工具"""
    executor = ToolExecutor({})

    result = executor.execute("nonexistent_tool")

    assert "[ERROR]" in result
    assert "未知工具" in result


def test_execute_tool_with_exception():
    """测试: 工具抛出异常"""
    class BrokenTool:
        name = "broken"
        description = "会抛出异常的工具"

        def __call__(self, **kwargs):
            raise ValueError("测试异常")

    executor = ToolExecutor({"broken": BrokenTool()})

    result = executor.execute("broken")

    assert "[ERROR]" in result
    assert "参数错误" in result


def test_get_tool_descriptions():
    """测试: 获取工具描述"""
    from deeppdf.agent.tools import InspectTocTool

    tool = InspectTocTool({"structure": []})
    executor = ToolExecutor({"test_tool": tool})

    descriptions = executor.get_tool_descriptions()

    assert "test_tool" in descriptions
    assert "查看 PDF 文档的目录结构" in descriptions


def test_create_tool_executor():
    """测试: 创建工具执行器"""
    tree_structure = {
        "structure": [
            {
                "title": "测试",
                "node_id": "node_1",
                "start_index": 1,
                "end_index": 10,
                "nodes": []
            }
        ]
    }

    executor = create_tool_executor(
        index_id="test_idx",
        storage_dir="/fake/path",
        tree_structure=tree_structure,
        pageindex_lib_path=None  # 不包含 read_page
    )

    # 验证工具已注册
    assert "inspect_toc" in executor.tools
    assert "hybrid_search" in executor.tools
    assert "read_page" not in executor.tools  # 未提供 pageindex_lib_path
