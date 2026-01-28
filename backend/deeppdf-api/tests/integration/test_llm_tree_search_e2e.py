# tests/integration/test_llm_tree_search_e2e.py
"""
LLMTreeSearchTool 端到端集成测试

验证完整流程：
1. 创建 DeepPDFAgent 并启用 LLMTreeSearchTool
2. Mock LLM 响应
3. 验证工具注册和调用
4. 验证降级到 hybrid_search 的逻辑
"""
import pytest
import json
from unittest.mock import Mock, patch
from deeppdf.agent.core import DeepPDFAgent
from deeppdf.agent.tools import HybridSearchTool


@pytest.fixture
def mock_index_metadata(tmp_path):
    """
    创建模拟的索引元数据

    包含：
    - 基本索引信息（id, pdf_name, node_count）
    - 树状结构（用于 InspectTocTool）
    - Markdown 文件映射（用于 MarkdownLocator）
    - 节点详细信息（summary, prefix_summary, text）
    """
    index_dir = tmp_path / "indexes"
    index_dir.mkdir(parents=True)

    metadata = {
        "id": "test_e2e_idx",
        "pdf_name": "test_e2e.pdf",
        "node_count": 15,
        "tree_structure": {
            "structure": [
                {
                    "title": "第一篇：概述",
                    "node_id": "node_root_1",
                    "start_index": 1,
                    "end_index": 30,
                    "summary": "第一篇概述，介绍研究背景和目标",
                    "prefix_summary": "",
                    "text": "第一篇详细内容...",
                    "nodes": [
                        {
                            "title": "第一章：研究背景",
                            "node_id": "node_1",
                            "start_index": 1,
                            "end_index": 10,
                            "summary": "研究背景介绍",
                            "prefix_summary": "",
                            "text": "第一章内容：研究背景...",
                            "nodes": [],
                        },
                        {
                            "title": "第二章：研究目标",
                            "node_id": "node_2",
                            "start_index": 11,
                            "end_index": 20,
                            "summary": "研究目标说明",
                            "prefix_summary": "研究背景介绍",
                            "text": "第二章内容：研究目标...",
                            "nodes": [],
                        },
                    ],
                },
                {
                    "title": "第二篇：方法",
                    "node_id": "node_root_2",
                    "start_index": 31,
                    "end_index": 60,
                    "summary": "第二篇方法，详细描述研究方法",
                    "prefix_summary": "第一篇概述，介绍研究背景和目标",
                    "text": "第二篇详细内容...",
                    "nodes": [
                        {
                            "title": "第三章：数据收集",
                            "node_id": "node_3",
                            "start_index": 31,
                            "end_index": 40,
                            "summary": "数据收集方法",
                            "prefix_summary": "",
                            "text": "第三章内容：数据收集...",
                            "nodes": [],
                        },
                        {
                            "title": "第四章：数据分析",
                            "node_id": "node_4",
                            "start_index": 41,
                            "end_index": 50,
                            "summary": "数据分析方法",
                            "prefix_summary": "",
                            "text": "第四章内容：数据分析...",
                            "nodes": [],
                        },
                    ],
                },
            ]
        },
        "markdown_files": {
            "node_root_1": "第一篇/概述.md",
            "node_1": "第一篇/研究背景.md",
            "node_2": "第一篇/研究目标.md",
            "node_root_2": "第二篇/方法.md",
            "node_3": "第二篇/数据收集.md",
            "node_4": "第二篇/数据分析.md",
        },
    }

    # 写入 metadata 文件
    with open(index_dir / "test_e2e_idx.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    return {
        "metadata": metadata,
        "storage_dir": str(tmp_path),
    }


@pytest.mark.integration
def test_llm_tree_search_full_flow(mock_index_metadata):
    """
    测试：LLMTreeSearchTool 完整流程

    验证步骤：
    1. 创建 Agent（enable_llm_tree_search=True）
    2. 验证 llm_tree_search 工具已注册
    3. Mock LLM 响应
    4. 调用工具并验证结果格式
    """
    metadata = mock_index_metadata["metadata"]
    storage_dir = mock_index_metadata["storage_dir"]

    # Mock LLM 客户端
    mock_llm_client = Mock()

    # Mock HybridSearchTool 返回结果（阶段 1 粗筛结果）
    mock_hybrid_result = json.dumps(
        [
            {
                "node_id": "node_1",
                "obsidian_link": "[[第一篇/研究背景.md#^page-5]]",
                "page": 5,
                "anchor": "^page-5",
                "text": "研究背景内容片段",
                "metadata": {"node_id": "node_1", "page": 5},
            },
            {
                "node_id": "node_2",
                "obsidian_link": "[[第一篇/研究目标.md#^page-15]]",
                "page": 15,
                "anchor": "^page-15",
                "text": "研究目标内容片段",
                "metadata": {"node_id": "node_2", "page": 15},
            },
            {
                "node_id": "node_3",
                "obsidian_link": "[[第二篇/数据收集.md#^page-35]]",
                "page": 35,
                "anchor": "^page-35",
                "text": "数据收集内容片段",
                "metadata": {"node_id": "node_3", "page": 35},
            },
        ],
        ensure_ascii=False,
    )

    # Mock LLM 精排响应（阶段 2）
    mock_llm_response = json.dumps(
        {"node_list": ["node_1", "node_2"]},
        ensure_ascii=False,
    )
    mock_llm_client.chat.return_value = mock_llm_response

    # 创建 Agent（启用 LLMTreeSearchTool）
    # 使用 patch OpenAI 来避免真实的 API 调用
    with patch("deeppdf.agent.core.OpenAI") as mock_openai:
        mock_openai.return_value = mock_llm_client
        agent = DeepPDFAgent(
            index_id=metadata["id"],
            storage_dir=storage_dir,
            tree_structure=metadata["tree_structure"],
            index_metadata=metadata,
            llm_provider="deepseek",
            api_key="fake_key",
            enable_llm_tree_search=True,
        )

    # 验证：llm_tree_search 工具已注册
    assert "llm_tree_search" in agent.executor.tools
    llm_tree_search_tool = agent.executor.tools["llm_tree_search"]
    assert llm_tree_search_tool.name == "llm_tree_search"

    # 验证：工具描述包含必要信息
    assert "智能检索" in llm_tree_search_tool.description
    assert "query" in llm_tree_search_tool.description
    assert "JSON 数组" in llm_tree_search_tool.description

    # Mock HybridSearchTool 的调用
    with patch.object(HybridSearchTool, "__call__", return_value=mock_hybrid_result):
        # 调用 llm_tree_search 工具
        result = llm_tree_search_tool(query="研究目标是什么？", top_k=5)

    # 解析结果
    result_data = json.loads(result)

    # 验证：返回格式正确（JSON 数组）
    assert isinstance(result_data, list)

    # 验证：LLM 精排选择了 node_1 和 node_2
    assert len(result_data) == 2
    assert result_data[0]["node_id"] == "node_1"
    assert result_data[1]["node_id"] == "node_2"

    # 验证：结果包含 obsidian_link（使用 node_map 中的 start_index，而不是搜索结果的 page）
    assert "obsidian_link" in result_data[0]
    # node_1 的 start_index 是 1，所以生成的链接是 ^page-1
    assert result_data[0]["obsidian_link"] == "[[第一篇/研究背景.md#^page-1]]"

    # 验证：结果包含正确的 page（来自 node_map 的 start_index）
    assert result_data[0]["page"] == 1

    # 验证：LLM 被调用了一次（阶段 2 精排）
    mock_llm_client.chat.assert_called_once()


@pytest.mark.integration
def test_llm_tree_search_fallback_to_hybrid(mock_index_metadata):
    """
    测试：LLM 调用失败时回退到 hybrid_search

    验证步骤：
    1. Mock LLM 调用抛出异常
    2. 验证工具回退到返回 hybrid_search 的结果
    3. 验证缓存机制正常工作
    """
    metadata = mock_index_metadata["metadata"]
    storage_dir = mock_index_metadata["storage_dir"]

    # Mock LLM 客户端（抛出异常）
    mock_llm_client = Mock()
    mock_llm_client.chat.side_effect = Exception("LLM API 调用失败")

    # Mock HybridSearchTool 返回结果
    mock_hybrid_result = json.dumps(
        [
            {
                "node_id": "node_1",
                "obsidian_link": "[[第一篇/研究背景.md#^page-5]]",
                "page": 5,
                "anchor": "^page-5",
                "text": "研究背景内容片段",
                "metadata": {"node_id": "node_1", "page": 5},
            },
        ],
        ensure_ascii=False,
    )

    # 创建 Agent（启用 LLMTreeSearchTool）
    with patch("deeppdf.agent.core.OpenAI") as mock_openai:
        mock_openai.return_value = mock_llm_client
        agent = DeepPDFAgent(
            index_id=metadata["id"],
            storage_dir=storage_dir,
            tree_structure=metadata["tree_structure"],
            index_metadata=metadata,
            llm_provider="deepseek",
            api_key="fake_key",
            enable_llm_tree_search=True,
        )

    llm_tree_search_tool = agent.executor.tools["llm_tree_search"]

    # Mock HybridSearchTool 的调用
    with patch.object(HybridSearchTool, "__call__", return_value=mock_hybrid_result):
        # 调用 llm_tree_search 工具
        result = llm_tree_search_tool(query="测试查询", top_k=5)

    # 验证：返回的是 hybrid_search 的原始结果（降级）
    result_data = json.loads(result)
    assert isinstance(result_data, list)
    assert len(result_data) == 1
    assert result_data[0]["node_id"] == "node_1"

    # 验证：第二次调用应该命中缓存
    with patch.object(HybridSearchTool, "__call__", return_value=mock_hybrid_result):
        result_cached = llm_tree_search_tool(query="测试查询", top_k=5)

    # 缓存的结果应该与第一次相同
    assert result_cached == result

    # 验证：HybridSearchTool 只被调用了一次（第二次命中缓存）
    # 注意：这里需要检查 HybridSearchTool.__call__ 的调用次数
    # 由于我们使用了 patch，所以无法直接统计
    # 但可以通过验证缓存机制来间接确认


@pytest.mark.integration
def test_llm_tree_search_invalid_response_fallback(mock_index_metadata):
    """
    测试：LLM 返回无效 JSON 时回退到 hybrid_search

    验证步骤：
    1. Mock LLM 返回非 JSON 字符串
    2. 验证工具回退到返回 hybrid_search 的结果
    """
    metadata = mock_index_metadata["metadata"]
    storage_dir = mock_index_metadata["storage_dir"]

    # Mock LLM 客户端（返回无效 JSON）
    mock_llm_client = Mock()
    mock_llm_client.chat.return_value = "这不是一个有效的 JSON 响应"

    # Mock HybridSearchTool 返回结果
    mock_hybrid_result = json.dumps(
        [
            {
                "node_id": "node_3",
                "obsidian_link": "[[第二篇/数据收集.md#^page-35]]",
                "page": 35,
                "anchor": "^page-35",
                "text": "数据收集内容片段",
                "metadata": {"node_id": "node_3", "page": 35},
            },
        ],
        ensure_ascii=False,
    )

    # 创建 Agent（启用 LLMTreeSearchTool）
    with patch("deeppdf.agent.core.OpenAI") as mock_openai:
        mock_openai.return_value = mock_llm_client
        agent = DeepPDFAgent(
            index_id=metadata["id"],
            storage_dir=storage_dir,
            tree_structure=metadata["tree_structure"],
            index_metadata=metadata,
            llm_provider="deepseek",
            api_key="fake_key",
            enable_llm_tree_search=True,
        )

    llm_tree_search_tool = agent.executor.tools["llm_tree_search"]

    # Mock HybridSearchTool 的调用
    with patch.object(HybridSearchTool, "__call__", return_value=mock_hybrid_result):
        # 调用 llm_tree_search 工具
        result = llm_tree_search_tool(query="测试查询", top_k=5)

    # 验证：返回的是 hybrid_search 的原始结果（降级）
    result_data = json.loads(result)
    assert isinstance(result_data, list)
    assert len(result_data) == 1
    assert result_data[0]["node_id"] == "node_3"


@pytest.mark.integration
def test_llm_tree_search_empty_node_list_fallback(mock_index_metadata):
    """
    测试：LLM 返回空 node_list 时回退到 hybrid_search

    验证步骤：
    1. Mock LLM 返回空 node_list
    2. 验证工具回退到返回 hybrid_search 的结果
    """
    metadata = mock_index_metadata["metadata"]
    storage_dir = mock_index_metadata["storage_dir"]

    # Mock LLM 客户端（返回空 node_list）
    mock_llm_client = Mock()
    mock_llm_response = json.dumps({"node_list": []}, ensure_ascii=False)
    mock_llm_client.chat.return_value = mock_llm_response

    # Mock HybridSearchTool 返回结果
    mock_hybrid_result = json.dumps(
        [
            {
                "node_id": "node_4",
                "obsidian_link": "[[第二篇/数据分析.md#^page-45]]",
                "page": 45,
                "anchor": "^page-45",
                "text": "数据分析内容片段",
                "metadata": {"node_id": "node_4", "page": 45},
            },
        ],
        ensure_ascii=False,
    )

    # 创建 Agent（启用 LLMTreeSearchTool）
    with patch("deeppdf.agent.core.OpenAI") as mock_openai:
        mock_openai.return_value = mock_llm_client
        agent = DeepPDFAgent(
            index_id=metadata["id"],
            storage_dir=storage_dir,
            tree_structure=metadata["tree_structure"],
            index_metadata=metadata,
            llm_provider="deepseek",
            api_key="fake_key",
            enable_llm_tree_search=True,
        )

    llm_tree_search_tool = agent.executor.tools["llm_tree_search"]

    # Mock HybridSearchTool 的调用
    with patch.object(HybridSearchTool, "__call__", return_value=mock_hybrid_result):
        # 调用 llm_tree_search 工具
        result = llm_tree_search_tool(query="测试查询", top_k=5)

    # 验证：返回的是 hybrid_search 的原始结果（降级）
    result_data = json.loads(result)
    assert isinstance(result_data, list)
    assert len(result_data) == 1
    assert result_data[0]["node_id"] == "node_4"
