# tests/test_agent_tools.py
"""工具模块单元测试"""
import pytest
import json
from unittest.mock import Mock, patch
from deeppdf.agent.tools import InspectTocTool, ReadPageTool, HybridSearchTool
from deeppdf.agent.markdown_locator import MarkdownLocator


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
                        "nodes": [],
                    }
                ],
            },
            {
                "title": "第二章：方法",
                "node_id": "node_2",
                "start_index": 11,
                "end_index": 20,
                "nodes": [],
            },
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
                                "nodes": [],
                            }
                        ],
                    }
                ],
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
        storage_dir="/fake/storage",
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
        storage_dir="/fake/storage",
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
        storage_dir="/fake/storage",
    )

    # Mock _load_page_index 方法抛出异常
    with patch.object(
        tool, "_load_page_index", side_effect=FileNotFoundError("文件不存在")
    ):
        result = tool(page_num=1)

        assert "错误" in result
        assert "读取页面失败" in result


def test_read_page_lazy_loading():
    """测试: 验证延迟加载机制 - PageIndex 只加载一次"""
    tool = ReadPageTool(
        pageindex_lib_path="/fake/path",
        index_id="test_idx",
        storage_dir="/fake/storage",
    )

    # 验证初始状态：_pi 为 None
    assert tool._pi is None, "初始化后 _pi 应该为 None"

    # Mock PageIndex 实例
    mock_pi = Mock()
    mock_pi.page_count = 100
    mock_pi.get_text_with_tags.return_value = "页面内容"

    # 直接设置 _pi，模拟延迟加载完成后的状态
    tool._pi = mock_pi

    # 调用工具 - 应该使用已有的 _pi，不会重新加载
    result1 = tool(page_num=1)
    assert tool._pi is mock_pi, "_pi 应该保持为 mock_pi"
    assert "第 1 页内容" in result1
    mock_pi.get_text_with_tags.assert_called_once_with(1)

    # 再次调用 - 仍然使用同一个 _pi 实例
    tool(page_num=2)
    assert tool._pi is mock_pi, "_pi 应该仍然是同一个实例"

    # 验证 get_text_with_tags 被调用了两次（page_num=1 和 page_num=2）
    assert mock_pi.get_text_with_tags.call_count == 2


def test_read_page_with_specific_exceptions():
    """测试: 具体的异常类型处理"""
    tool = ReadPageTool(
        pageindex_lib_path="/fake/path",
        index_id="test_idx",
        storage_dir="/fake/storage",
    )

    # 测试 FileNotFoundError
    with patch.object(
        tool, "_load_page_index", side_effect=FileNotFoundError("未找到文件")
    ):
        result = tool(page_num=1)
        assert "读取页面失败" in result

    # 测试 ValueError
    with patch.object(tool, "_load_page_index", side_effect=ValueError("无效值")):
        result = tool(page_num=1)
        assert "读取页面失败" in result

    # 测试未知异常
    with patch.object(tool, "_load_page_index", side_effect=RuntimeError("未知错误")):
        result = tool(page_num=1)
        assert "发生未知错误" in result


@pytest.fixture
def temp_index_dir(tmp_path):
    """创建临时索引目录"""
    index_dir = tmp_path / "indexes"
    index_dir.mkdir(parents=True)

    # 创建模拟的索引元数据
    metadata = {
        "id": "test_idx",
        "pdf_name": "test.pdf",
        "node_count": 10,
        "tree_structure": {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "node_1",
                    "start_index": 1,
                    "end_index": 10,
                    "nodes": [],
                }
            ]
        },
    }

    with open(index_dir / "test_idx.json", "w") as f:
        json.dump(metadata, f)

    return str(tmp_path)


def test_hybrid_search_with_results(temp_index_dir, monkeypatch):
    """测试: 有结果的检索（旧格式兼容测试）"""

    # Mock query_pdf 函数
    async def mock_query_pdf(*args, **kwargs):
        return {
            "status": "success",
            "results": [
                {
                    "text": "这是搜索结果的内容",
                    "metadata": {
                        "section": "第一章",
                        "score": 0.95,
                        "node_id": "node_1",
                        "page": 5,
                    },
                }
            ],
            "search_method": "hybrid_title_bm25_vector",
        }

    # Mock asyncio.run 和 query_pdf
    with patch("deeppdf.agent.tools.query_pdf", mock_query_pdf):
        tool = HybridSearchTool(index_id="test_idx", storage_dir=temp_index_dir)
        result = tool(query="测试查询", top_k=5)

        # 解析 JSON 结果
        results = json.loads(result)
        assert isinstance(results, list)
        assert len(results) == 1
        assert results[0]["text"] == "这是搜索结果的内容"
        assert results[0]["page"] == 5


def test_hybrid_search_no_results(temp_index_dir, monkeypatch):
    """测试: 无结果的检索"""

    async def mock_query_pdf(*args, **kwargs):
        return {
            "status": "success",
            "results": [],
            "search_method": "hybrid_title_bm25_vector",
        }

    with patch("deeppdf.agent.tools.query_pdf", mock_query_pdf):
        tool = HybridSearchTool(index_id="test_idx", storage_dir=temp_index_dir)
        result = tool(query="不存在的查询", top_k=5)

        # 解析 JSON 结果
        result_obj = json.loads(result)
        assert "error" in result_obj
        assert "未找到" in result_obj["error"]
        assert "不存在的查询" in result_obj["error"]


def test_hybrid_search_with_error(temp_index_dir, monkeypatch):
    """测试: 检索服务错误"""

    async def mock_query_pdf(*args, **kwargs):
        return {"status": "error", "error": "索引不存在"}

    with patch("deeppdf.agent.tools.query_pdf", mock_query_pdf):
        tool = HybridSearchTool(index_id="test_idx", storage_dir=temp_index_dir)
        result = tool(query="测试查询", top_k=5)

        # 解析 JSON 结果
        result_obj = json.loads(result)
        assert "error" in result_obj
        assert "索引不存在" in result_obj["error"]


def test_hybrid_search_with_markdown_locator(temp_index_dir):
    """测试: 使用 markdown_locator 返回增强的引用元数据"""
    # 创建 markdown_locator
    index_metadata = {
        "markdown_files": {
            "node_1": "第一章/引言.md",
            "node_2": "第二章/方法.md",
        },
        "pdf_name": "test.pdf",
    }
    markdown_locator = MarkdownLocator(index_metadata)

    # Mock query_pdf 返回带有 node_id 的结果
    async def mock_query_pdf(*args, **kwargs):
        return {
            "status": "success",
            "results": [
                {
                    "text": "这是搜索结果的内容",
                    "metadata": {
                        "section": "第一章",
                        "node_id": "node_1",
                        "page": 5,
                        "score": 0.95,
                    },
                },
                {
                    "text": "另一个结果",
                    "metadata": {
                        "section": "第二章",
                        "node_id": "node_2",
                        "page": 10,
                        "score": 0.85,
                    },
                },
            ],
            "search_method": "hybrid_title_bm25_vector",
        }

    with patch("deeppdf.agent.tools.query_pdf", mock_query_pdf):
        tool = HybridSearchTool(
            index_id="test_idx",
            storage_dir=temp_index_dir,
            markdown_locator=markdown_locator,
        )
        result = tool(query="测试查询", top_k=5)

        # 解析 JSON 结果
        results = json.loads(result)

        # 验证结果结构
        assert isinstance(results, list)
        assert len(results) == 2

        # 验证第一个结果的引用元数据
        first_result = results[0]
        assert first_result["node_id"] == "node_1"
        assert first_result["obsidian_link"] == "[[第一章/引言.md#^page-5]]"
        assert first_result["page"] == 5
        assert first_result["anchor"] == "^page-5"
        assert first_result["text"] == "这是搜索结果的内容"

        # 验证第二个结果的引用元数据
        second_result = results[1]
        assert second_result["node_id"] == "node_2"
        assert second_result["obsidian_link"] == "[[第二章/方法.md#^page-10]]"
        assert second_result["page"] == 10
        assert second_result["anchor"] == "^page-10"


def test_hybrid_search_without_markdown_locator(temp_index_dir):
    """测试: 不使用 markdown_locator 时返回基本元数据（向后兼容）"""

    # Mock query_pdf 返回带有 node_id 的结果
    async def mock_query_pdf(*args, **kwargs):
        return {
            "status": "success",
            "results": [
                {
                    "text": "这是搜索结果的内容",
                    "metadata": {
                        "section": "第一章",
                        "node_id": "node_1",
                        "page": 5,
                        "score": 0.95,
                    },
                },
            ],
            "search_method": "hybrid_title_bm25_vector",
        }

    with patch("deeppdf.agent.tools.query_pdf", mock_query_pdf):
        # 不提供 markdown_locator
        tool = HybridSearchTool(
            index_id="test_idx", storage_dir=temp_index_dir, markdown_locator=None
        )
        result = tool(query="测试查询", top_k=5)

        # 解析 JSON 结果
        results = json.loads(result)

        # 验证结果结构
        assert isinstance(results, list)
        assert len(results) == 1

        # 验证基本元数据（不包含增强的引用字段）
        first_result = results[0]
        assert "text" in first_result
        assert first_result["text"] == "这是搜索结果的内容"
        assert "page" in first_result
        assert first_result["page"] == 5
        assert "metadata" in first_result
        assert first_result["metadata"]["node_id"] == "node_1"

        # 验证不包含增强的引用字段
        assert "node_id" not in first_result
        assert "obsidian_link" not in first_result
        assert "anchor" not in first_result


def test_hybrid_search_missing_node_id(temp_index_dir):
    """测试: 结果缺少 node_id 时的回退行为"""
    # 创建 markdown_locator
    index_metadata = {
        "markdown_files": {"node_1": "第一章/引言.md"},
        "pdf_name": "test.pdf",
    }
    markdown_locator = MarkdownLocator(index_metadata)

    # Mock query_pdf 返回没有 node_id 的结果
    async def mock_query_pdf(*args, **kwargs):
        return {
            "status": "success",
            "results": [
                {
                    "text": "没有 node_id 的结果",
                    "metadata": {
                        "section": "未知章节",
                        "page": 3,
                        "score": 0.75,
                    },
                },
            ],
            "search_method": "vector",
        }

    with patch("deeppdf.agent.tools.query_pdf", mock_query_pdf):
        tool = HybridSearchTool(
            index_id="test_idx",
            storage_dir=temp_index_dir,
            markdown_locator=markdown_locator,
        )
        result = tool(query="测试查询", top_k=5)

        # 解析 JSON 结果
        results = json.loads(result)

        # 验证回退到基本元数据
        assert isinstance(results, list)
        assert len(results) == 1

        first_result = results[0]
        assert "text" in first_result
        assert first_result["text"] == "没有 node_id 的结果"
        assert "page" in first_result
        assert first_result["page"] == 3

        # 验证不包含增强的引用字段（因为缺少 node_id）
        assert "node_id" not in first_result
        assert "obsidian_link" not in first_result
        assert "anchor" not in first_result


def test_hybrid_search_invalid_query(temp_index_dir):
    """测试: 无效查询参数"""
    tool = HybridSearchTool(index_id="test_idx", storage_dir=temp_index_dir)

    # 测试空字符串
    result = tool(query="", top_k=5)
    result_obj = json.loads(result)
    assert "error" in result_obj
    assert "查询参数必须是非空字符串" in result_obj["error"]

    # 测试无效的 top_k
    result = tool(query="测试", top_k=100)
    result_obj = json.loads(result)
    assert "error" in result_obj
    assert "top_k 必须在 1-50 之间" in result_obj["error"]
