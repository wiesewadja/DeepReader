# tests/test_agent_tools.py
"""工具模块单元测试"""
import pytest
import json
from pathlib import Path
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
    with patch.object(tool, '_load_page_index', side_effect=FileNotFoundError("文件不存在")):
        result = tool(page_num=1)

        assert "错误" in result
        assert "读取页面失败" in result


def test_read_page_lazy_loading():
    """测试: 验证延迟加载机制 - PageIndex 只加载一次"""
    tool = ReadPageTool(
        pageindex_lib_path="/fake/path",
        index_id="test_idx",
        storage_dir="/fake/storage"
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
    result2 = tool(page_num=2)
    assert tool._pi is mock_pi, "_pi 应该仍然是同一个实例"

    # 验证 get_text_with_tags 被调用了两次（page_num=1 和 page_num=2）
    assert mock_pi.get_text_with_tags.call_count == 2


def test_read_page_with_specific_exceptions():
    """测试: 具体的异常类型处理"""
    tool = ReadPageTool(
        pageindex_lib_path="/fake/path",
        index_id="test_idx",
        storage_dir="/fake/storage"
    )

    # 测试 FileNotFoundError
    with patch.object(tool, '_load_page_index', side_effect=FileNotFoundError("未找到文件")):
        result = tool(page_num=1)
        assert "读取页面失败" in result

    # 测试 ValueError
    with patch.object(tool, '_load_page_index', side_effect=ValueError("无效值")):
        result = tool(page_num=1)
        assert "读取页面失败" in result

    # 测试未知异常
    with patch.object(tool, '_load_page_index', side_effect=RuntimeError("未知错误")):
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
                    "nodes": []
                }
            ]
        }
    }

    with open(index_dir / "test_idx.json", "w") as f:
        json.dump(metadata, f)

    return str(tmp_path)


def test_hybrid_search_with_results(temp_index_dir, monkeypatch):
    """测试: 有结果的检索"""
    # Mock query_pdf 函数
    async def mock_query_pdf(*args, **kwargs):
        return {
            "status": "success",
            "results": [
                {
                    "text": "这是搜索结果的内容",
                    "metadata": {
                        "section": "第一章",
                        "score": 0.95
                    }
                }
            ],
            "search_method": "hybrid_title_bm25_vector"
        }

    # Mock asyncio.run 和 query_pdf
    with patch('deeppdf.services.querier.query_pdf', mock_query_pdf):
        from deeppdf.agent.tools import HybridSearchTool

        tool = HybridSearchTool(
            index_id="test_idx",
            storage_dir=temp_index_dir
        )
        result = tool(query="测试查询", top_k=5)

        assert "检索结果" in result
        assert "第一章" in result
        assert "0.95" in result


def test_hybrid_search_no_results(temp_index_dir, monkeypatch):
    """测试: 无结果的检索"""
    async def mock_query_pdf(*args, **kwargs):
        return {
            "status": "success",
            "results": [],
            "search_method": "hybrid_title_bm25_vector"
        }

    with patch('deeppdf.services.querier.query_pdf', mock_query_pdf):
        from deeppdf.agent.tools import HybridSearchTool

        tool = HybridSearchTool(
            index_id="test_idx",
            storage_dir=temp_index_dir
        )
        result = tool(query="不存在的查询", top_k=5)

        assert "未找到" in result
        assert "不存在的查询" in result


def test_hybrid_search_with_error(temp_index_dir, monkeypatch):
    """测试: 检索服务错误"""
    async def mock_query_pdf(*args, **kwargs):
        return {
            "status": "error",
            "error": "索引不存在"
        }

    with patch('deeppdf.services.querier.query_pdf', mock_query_pdf):
        from deeppdf.agent.tools import HybridSearchTool

        tool = HybridSearchTool(
            index_id="test_idx",
            storage_dir=temp_index_dir
        )
        result = tool(query="测试查询", top_k=5)

        assert "错误" in result
        assert "索引不存在" in result
