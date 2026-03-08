"""LLM 树搜索模块测试"""

from deeppdf.services.llm_tree_search import format_tree_structure


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
