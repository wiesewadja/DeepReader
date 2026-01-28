# tests/test_executor.py
"""工具执行器测试"""
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
                "nodes": [],
            }
        ]
    }

    executor = create_tool_executor(
        index_id="test_idx",
        storage_dir="/fake/path",
        tree_structure=tree_structure,
        pageindex_lib_path=None,  # 不包含 read_page
    )

    # 验证工具已注册
    assert "inspect_toc" in executor.tools
    assert "hybrid_search" in executor.tools
    assert "read_page" not in executor.tools  # 未提供 pageindex_lib_path


def test_create_tool_executor_with_markdown_locator():
    """测试: 创建工具执行器时传递 markdown_locator"""
    from deeppdf.agent.markdown_locator import MarkdownLocator

    tree_structure = {
        "structure": [
            {
                "title": "测试",
                "node_id": "node_1",
                "start_index": 1,
                "end_index": 10,
                "nodes": [],
            }
        ]
    }

    # 创建一个模拟的 index_metadata
    index_metadata = {
        "markdown_files": {"node_1": "test_file.md"},
        "pdf_name": "test.pdf",
        "tree_structure": tree_structure,
    }

    # 创建 markdown_locator
    markdown_locator = MarkdownLocator(index_metadata)

    executor = create_tool_executor(
        index_id="test_idx",
        storage_dir="/fake/path",
        tree_structure=tree_structure,
        pageindex_lib_path=None,
        markdown_locator=markdown_locator,
    )

    # 验证 markdown_locator 已传递给 HybridSearchTool
    assert "hybrid_search" in executor.tools
    hybrid_search_tool = executor.tools["hybrid_search"]
    assert hybrid_search_tool.markdown_locator is markdown_locator
    assert hybrid_search_tool.markdown_locator is not None


def test_tool_executor_includes_llm_tree_search():
    """测试: 启用 LLM 树搜索时包含工具"""
    from deeppdf.agent.markdown_locator import MarkdownLocator
    from deeppdf.agent.tools import LLMTreeSearchTool

    tree_structure = {
        "structure": [
            {
                "title": "测试",
                "node_id": "node_1",
                "start_index": 1,
                "end_index": 10,
                "nodes": [],
            }
        ]
    }

    # 创建一个模拟的 index_metadata
    index_metadata = {
        "markdown_files": {"node_1": "test_file.md"},
        "pdf_name": "test.pdf",
        "tree_structure": tree_structure,
    }

    # 创建 markdown_locator
    markdown_locator = MarkdownLocator(index_metadata)

    # 创建模拟的 LLM 客户端
    class MockLLMClient:
        def chat(self, prompt: str) -> str:
            return '{"node_list": ["node_1"]}'

    llm_client = MockLLMClient()

    executor = create_tool_executor(
        index_id="test_idx",
        storage_dir="/fake/path",
        tree_structure=tree_structure,
        pageindex_lib_path=None,
        markdown_locator=markdown_locator,
        enable_llm_tree_search=True,
        llm_client=llm_client,
    )

    # 验证 llm_tree_search 工具已注册
    assert "llm_tree_search" in executor.tools
    assert isinstance(executor.tools["llm_tree_search"], LLMTreeSearchTool)


def test_tool_executor_llm_tree_search_optional():
    """测试: 禁用 LLM 树搜索时不包含工具"""
    from deeppdf.agent.markdown_locator import MarkdownLocator

    tree_structure = {
        "structure": [
            {
                "title": "测试",
                "node_id": "node_1",
                "start_index": 1,
                "end_index": 10,
                "nodes": [],
            }
        ]
    }

    # 创建一个模拟的 index_metadata
    index_metadata = {
        "markdown_files": {"node_1": "test_file.md"},
        "pdf_name": "test.pdf",
        "tree_structure": tree_structure,
    }

    # 创建 markdown_locator
    markdown_locator = MarkdownLocator(index_metadata)

    # 测试默认行为（禁用）
    executor = create_tool_executor(
        index_id="test_idx",
        storage_dir="/fake/path",
        tree_structure=tree_structure,
        pageindex_lib_path=None,
        markdown_locator=markdown_locator,
    )

    # 验证 llm_tree_search 工具未注册
    assert "llm_tree_search" not in executor.tools

    # 测试显式禁用
    executor = create_tool_executor(
        index_id="test_idx",
        storage_dir="/fake/path",
        tree_structure=tree_structure,
        pageindex_lib_path=None,
        markdown_locator=markdown_locator,
        enable_llm_tree_search=False,
        llm_client=None,
    )

    # 验证 llm_tree_search 工具未注册
    assert "llm_tree_search" not in executor.tools
