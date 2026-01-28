# tests/test_prompt_builder.py
"""PromptBuilder 单元测试"""
import pytest
from deeppdf.agent.prompt_builder import PromptBuilder


class TestPromptBuilder:
    """PromptBuilder 测试类"""

    def test_init(self):
        """测试: 初始化"""
        builder = PromptBuilder()
        assert builder._has_summary is None

    def test_check_has_summary_with_summary(self):
        """测试: 检测树结构包含 summary 字段"""
        builder = PromptBuilder()
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "node_1",
                    "summary": "这是摘要",
                    "nodes": [],
                }
            ]
        }
        result = builder._check_has_summary(tree)
        assert result is True

    def test_check_has_summary_without_summary(self):
        """测试: 检测树结构不包含 summary 字段"""
        builder = PromptBuilder()
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "node_1",
                    "nodes": [],
                }
            ]
        }
        result = builder._check_has_summary(tree)
        assert result is False

    def test_check_has_summary_nested(self):
        """测试: 递归检查嵌套结构的 summary 字段"""
        builder = PromptBuilder()
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "node_1",
                    "nodes": [
                        {
                            "title": "1.1 小节",
                            "node_id": "node_1_1",
                            "summary": "子节点摘要",
                            "nodes": [],
                        }
                    ],
                }
            ]
        }
        result = builder._check_has_summary(tree)
        assert result is True

    def test_count_nodes(self):
        """测试: 统计树节点数量"""
        builder = PromptBuilder()
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "node_1",
                    "nodes": [
                        {
                            "title": "1.1 小节",
                            "node_id": "node_1_1",
                            "nodes": [],
                        }
                    ],
                },
                {"title": "第二章", "node_id": "node_2", "nodes": []},
            ]
        }
        result = builder._count_nodes(tree)
        assert result == 3

    def test_build_tree_text_with_summary(self):
        """测试: 构建包含 summary 的树结构文本"""
        builder = PromptBuilder()
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "node_1",
                    "summary": "第一章的摘要内容",
                    "nodes": [
                        {
                            "title": "1.1 小节",
                            "node_id": "node_1_1",
                            "summary": "小节摘要",
                            "nodes": [],
                        }
                    ],
                }
            ]
        }
        result = builder._build_tree_text(tree, include_summary=True)
        assert "第一章" in result
        assert "node_1" in result
        assert "第一章的摘要内容" in result
        assert "小节摘要" in result

    def test_build_tree_text_without_summary(self):
        """测试: 构建不包含 summary 的树结构文本"""
        builder = PromptBuilder()
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "node_1",
                    "nodes": [
                        {
                            "title": "1.1 小节",
                            "node_id": "node_1_1",
                            "nodes": [],
                        }
                    ],
                }
            ]
        }
        result = builder._build_tree_text(tree, include_summary=False)
        assert "第一章" in result
        assert "node_1" in result
        assert "1.1 小节" in result

    def test_build_with_summary(self):
        """测试: 构建包含 summary 的完整 Prompt"""
        builder = PromptBuilder()
        query = "什么是机器学习？"
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "node_1",
                    "summary": "机器学习基础",
                    "nodes": [],
                }
            ]
        }
        result = builder.build(query, tree)
        assert "问题：什么是机器学习？" in result
        assert "文档候选章节" in result
        assert "共 1 个" in result
        assert "机器学习基础" in result
        assert "请分析上述章节，找出最可能包含答案的节点" in result
        assert (
            '{"thinking": "你的推理过程", "node_list": ["node_id1", "node_id2"]}'
            in result
        )

    def test_build_without_summary(self):
        """测试: 构建不包含 summary 的完整 Prompt"""
        builder = PromptBuilder()
        query = "什么是机器学习？"
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "node_1",
                    "nodes": [],
                }
            ]
        }
        result = builder.build(query, tree)
        assert "问题：什么是机器学习？" in result
        assert "文档候选章节标题" in result
        assert "共 1 个" in result
        assert "请根据章节标题判断相关性，找出可能相关的节点" in result

    def test_build_with_prefix_summary(self):
        """测试: 构建包含 prefix_summary 的树结构文本"""
        builder = PromptBuilder()
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "node_1",
                    "prefix_summary": "前缀摘要",
                    "nodes": [],
                }
            ]
        }
        result = builder._build_tree_text(tree, include_summary=True)
        assert "前缀摘要" in result

    def test_count_nodes_empty_tree(self):
        """测试: 空树的节点统计"""
        builder = PromptBuilder()
        tree = {"structure": []}
        result = builder._count_nodes(tree)
        assert result == 0

    def test_build_tree_text_empty_tree(self):
        """测试: 空树的文本构建"""
        builder = PromptBuilder()
        tree = {"structure": []}
        result = builder._build_tree_text(tree, include_summary=False)
        assert result == ""

    def test_check_has_summary_empty_tree(self):
        """测试: 空树的 summary 检测"""
        builder = PromptBuilder()
        tree = {"structure": []}
        result = builder._check_has_summary(tree)
        assert result is False

    def test_build_caches_has_summary(self):
        """测试: build 方法缓存 has_summary 结果"""
        builder = PromptBuilder()
        tree = {
            "structure": [
                {"title": "第一章", "node_id": "node_1", "summary": "摘要", "nodes": []}
            ]
        }
        # 第一次调用
        result1 = builder.build("测试", tree)
        assert builder._has_summary is True
        # 第二次调用应该使用缓存的 _has_summary
        result2 = builder.build("测试", tree)
        assert result1 == result2
