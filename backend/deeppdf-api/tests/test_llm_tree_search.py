"""LLM 树搜索模块测试"""

from deeppdf.services.llm_tree_search import (
    format_tree_structure,
    build_tree_prompt,
    LLMTreeSearchResult,
)


class TestFormatTreeStructure:
    """测试树结构格式化"""

    def test_empty_structure(self):
        """测试空结构"""
        result = format_tree_structure({})
        assert result == ""

    def test_single_node(self):
        """测试单个节点"""
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "0001",
                    "summary": "这是摘要",
                    "nodes": [],
                }
            ]
        }
        result = format_tree_structure(tree)
        assert "第一章" in result
        assert "node_id: 0001" in result
        assert "摘要: 这是摘要" in result

    def test_nested_nodes(self):
        """测试嵌套节点"""
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "0001",
                    "summary": "章节摘要",
                    "nodes": [
                        {
                            "title": "1.1 子章节",
                            "node_id": "0002",
                            "summary": "子章节摘要",
                            "nodes": [],
                        }
                    ],
                }
            ]
        }
        result = format_tree_structure(tree)
        assert "第一章" in result
        assert "1.1 子章节" in result
        assert "node_id: 0001" in result
        assert "node_id: 0002" in result

    def test_truncates_long_summary(self):
        """测试截断长摘要"""
        long_summary = "x" * 200
        tree = {
            "structure": [
                {
                    "title": "章节",
                    "node_id": "0001",
                    "summary": long_summary,
                    "nodes": [],
                }
            ]
        }
        result = format_tree_structure(tree, max_text_length=50)
        assert "..." in result
        assert len([line for line in result.split("\n") if "摘要" in line][0]) < 100


class TestBuildTreePrompt:
    """测试 Prompt 构建"""

    def test_basic_prompt(self):
        """测试基本 Prompt 生成"""
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "0001",
                    "summary": "摘要内容",
                    "nodes": [],
                }
            ]
        }
        prompt = build_tree_prompt(
            tree_structure=tree,
            query="什么是投资？",
            doc_name="投资学",
            max_results=5,
        )

        assert "投资学" in prompt
        assert "什么是投资？" in prompt
        assert "第一章" in prompt
        assert "node_id: 0001" in prompt
        assert "最多 5 个" in prompt

    def test_prompt_with_empty_doc_name(self):
        """测试空文档名称"""
        tree = {"structure": [{"title": "章节", "node_id": "001", "nodes": []}]}
        prompt = build_tree_prompt(tree, "查询", max_results=3)

        assert "未知文档" in prompt
        assert "最多 3 个" in prompt
