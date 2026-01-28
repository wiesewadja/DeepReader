# tests/test_llm_tree_search_tool.py
"""LLMTreeSearchTool 单元测试"""
import pytest
from unittest.mock import Mock
from deeppdf.agent.tools import LLMTreeSearchTool, HybridSearchTool
from deeppdf.agent.markdown_locator import MarkdownLocator
import hashlib


def test_tool_initialization():
    """测试: LLMTreeSearchTool 初始化"""
    # 创建 mock 对象
    mock_hybrid_search = Mock(spec=HybridSearchTool)
    mock_markdown_locator = Mock(spec=MarkdownLocator)
    node_map = {"node_1": {"title": "第一章", "start_index": 1, "end_index": 10}}
    mock_llm_client = Mock()

    # 创建工具实例
    tool = LLMTreeSearchTool(
        hybrid_search_tool=mock_hybrid_search,
        markdown_locator=mock_markdown_locator,
        node_map=node_map,
        llm_client=mock_llm_client,
        cache_ttl=300,
    )

    # 验证属性
    assert tool.name == "llm_tree_search"
    assert tool._hybrid_search is mock_hybrid_search
    assert tool._markdown_locator is mock_markdown_locator
    assert tool._node_map == node_map
    assert tool._llm_client is mock_llm_client
    assert tool._cache_ttl == 300
    assert tool._cache == {}


def test_tool_initialization_with_default_cache_ttl():
    """测试: 使用默认 cache_ttl 初始化"""
    mock_hybrid_search = Mock(spec=HybridSearchTool)
    mock_markdown_locator = Mock(spec=MarkdownLocator)
    node_map = {}
    mock_llm_client = Mock()

    tool = LLMTreeSearchTool(
        hybrid_search_tool=mock_hybrid_search,
        markdown_locator=mock_markdown_locator,
        node_map=node_map,
        llm_client=mock_llm_client,
    )

    assert tool._cache_ttl == 300


def test_tool_description_format():
    """测试: 工具描述包含必要信息"""
    mock_hybrid_search = Mock(spec=HybridSearchTool)
    mock_markdown_locator = Mock(spec=MarkdownLocator)
    node_map = {}
    mock_llm_client = Mock()

    tool = LLMTreeSearchTool(
        hybrid_search_tool=mock_hybrid_search,
        markdown_locator=mock_markdown_locator,
        node_map=node_map,
        llm_client=mock_llm_client,
    )

    # 验证描述包含关键信息
    assert "基于深度理解的智能检索" in tool.description
    assert "跨章节推理" in tool.description
    assert "query" in tool.description
    assert "JSON 数组" in tool.description
    assert "obsidian_link" in tool.description


def test_cache_hit():
    """测试: 缓存命中场景"""
    mock_hybrid_search = Mock(spec=HybridSearchTool)
    mock_markdown_locator = Mock(spec=MarkdownLocator)
    node_map = {}
    mock_llm_client = Mock()

    tool = LLMTreeSearchTool(
        hybrid_search_tool=mock_hybrid_search,
        markdown_locator=mock_markdown_locator,
        node_map=node_map,
        llm_client=mock_llm_client,
    )

    # 验证缓存键生成
    query = "测试查询语句"
    expected_key = hashlib.md5(query.encode()).hexdigest()
    assert tool._get_cache_key(query) == expected_key

    # 验证缓存未命中（初始状态）
    result = tool._get_from_cache(query)
    assert result is None

    # 保存到缓存
    cached_result = "缓存的结果内容"
    tool._save_to_cache(query, cached_result)

    # 验证缓存命中
    result = tool._get_from_cache(query)
    assert result == cached_result


def test_cache_key_isolation():
    """测试: 不同查询的缓存键隔离"""
    mock_hybrid_search = Mock(spec=HybridSearchTool)
    mock_markdown_locator = Mock(spec=MarkdownLocator)
    node_map = {}
    mock_llm_client = Mock()

    tool = LLMTreeSearchTool(
        hybrid_search_tool=mock_hybrid_search,
        markdown_locator=mock_markdown_locator,
        node_map=node_map,
        llm_client=mock_llm_client,
    )

    # 不同查询应该生成不同的缓存键
    query1 = "第一个查询"
    query2 = "第二个查询"
    key1 = tool._get_cache_key(query1)
    key2 = tool._get_cache_key(query2)

    assert key1 != key2

    # 保存第一个查询的结果
    tool._save_to_cache(query1, "结果1")

    # 第二个查询不应该命中第一个查询的缓存
    result2 = tool._get_from_cache(query2)
    assert result2 is None

    # 第一个查询应该命中缓存
    result1 = tool._get_from_cache(query1)
    assert result1 == "结果1"


def test_stage1_hybrid_search_called():
    """测试: 阶段 1 粗筛时 HybridSearchTool 被正确调用"""
    import json

    # 不使用 spec 参数，避免签名检查问题
    mock_hybrid_search = Mock()
    mock_markdown_locator = Mock()
    node_map = {
        "node_1": {"title": "第一章", "start_index": 1, "end_index": 10},
        "node_2": {"title": "第二章", "start_index": 11, "end_index": 20},
    }
    mock_llm_client = Mock()

    # 模拟 HybridSearchTool 的返回结果
    mock_hybrid_result = json.dumps(
        [
            {
                "node_id": "node_1",
                "obsidian_link": "[[test.md#^page-5]]",
                "page": 5,
                "anchor": "^page-5",
                "text": "测试内容1",
            },
            {
                "node_id": "node_2",
                "obsidian_link": "[[test.md#^page-15]]",
                "page": 15,
                "anchor": "^page-15",
                "text": "测试内容2",
            },
        ],
        ensure_ascii=False,
    )
    mock_hybrid_search.return_value = mock_hybrid_result

    tool = LLMTreeSearchTool(
        hybrid_search_tool=mock_hybrid_search,
        markdown_locator=mock_markdown_locator,
        node_map=node_map,
        llm_client=mock_llm_client,
    )

    # 调用工具
    query = "测试查询"
    result = tool(query=query, top_k=5)

    # 验证 HybridSearchTool 被调用，且参数正确（top_k=20 进行粗筛）
    mock_hybrid_search.assert_called_once_with(query=query, top_k=20)

    # 验证返回结果是 HybridSearchTool 的结果
    assert result == mock_hybrid_result
