"""LLM 树搜索集成测试"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from deeppdf.services.llm_tree_search import (
    llm_tree_search,
    extract_nodes_by_ids,
    build_tree_prompt,
)
from deeppdf.services.querier import _query_with_llm_tree_search


# 测试用的树结构
MOCK_TREE = {
    "structure": [
        {
            "title": "第一章 投资入门",
            "node_id": "0001",
            "summary": "介绍投资的基本概念",
            "start_index": 1,
            "end_index": 20,
            "nodes": [
                {
                    "title": "1.1 什么是投资",
                    "node_id": "0002",
                    "summary": "投资的定义和分类",
                    "text": "投资是指投入资金以获取收益的行为...",
                    "start_index": 1,
                    "end_index": 10,
                    "nodes": [],
                }
            ],
        },
        {
            "title": "第二章 股票投资",
            "node_id": "0003",
            "summary": "股票投资的基本知识",
            "start_index": 21,
            "end_index": 50,
            "nodes": [],
        },
    ]
}


class TestLLMTreeSearchIntegration:
    """LLM 树搜索集成测试"""

    @pytest.mark.asyncio
    async def test_llm_tree_search_success(self):
        """测试 LLM 树搜索成功场景"""
        # Mock LLM 客户端
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content='''```json
{
  "thinking": "用户问的是投资定义，应该看第一章第一节",
  "node_list": ["0002"]
}
```'''))
        ]
        mock_client.chat.completions.create = MagicMock(return_value=mock_response)

        result = await llm_tree_search(
            query="什么是投资？",
            tree_structure=MOCK_TREE,
            llm_client=mock_client,
            model="deepseek-chat",
            doc_name="投资学",
            max_results=5,
        )

        assert result.success is True
        assert "0002" in result.node_ids
        assert "投资" in result.thinking

    @pytest.mark.asyncio
    async def test_extract_and_format(self):
        """测试节点提取和格式化"""
        nodes = extract_nodes_by_ids(MOCK_TREE, ["0002", "0003"])

        assert len(nodes) == 2
        assert nodes[0]["title"] == "1.1 什么是投资"
        assert nodes[0]["path"] == "第一章 投资入门 > 1.1 什么是投资"
        assert nodes[1]["title"] == "第二章 股票投资"

    @pytest.mark.asyncio
    async def test_query_with_llm_tree_search(self):
        """测试完整的查询流程"""
        mock_metadata = {
            "pdf_name": "投资学.pdf",
            "pdf_path": "/path/to/test.pdf",
            "node_count": 3,
            "created_at": "2026-03-08",
            "tree_structure": MOCK_TREE,
        }

        with patch("deeppdf.services.querier.get_llm_client") as mock_get_client:
            # Mock LLM 客户端
            mock_client = MagicMock()
            mock_response = MagicMock()
            mock_response.choices = [
                MagicMock(message=MagicMock(content='''```json
{
  "thinking": "测试推理",
  "node_list": ["0001"]
}
```'''))
            ]
            mock_client.chat.completions.create = MagicMock(return_value=mock_response)
            mock_get_client.return_value = (mock_client, "deepseek-chat")

            result = await _query_with_llm_tree_search(
                query="测试查询",
                tree_structure=MOCK_TREE,
                index_metadata=mock_metadata,
                max_results=5,
            )

            assert result["status"] == "success"
            assert result["search_method"] == "llm_tree_search"
            assert "thinking" in result
            assert len(result["results"]) > 0
