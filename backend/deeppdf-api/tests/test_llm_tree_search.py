"""LLM 树搜索模块测试"""

from deeppdf.services.llm_tree_search import (
    format_tree_structure,
    build_tree_prompt,
    parse_llm_response,
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


class TestParseLLMResponse:
    """测试 LLM 响应解析"""

    def test_valid_json_with_markdown(self):
        """测试带 markdown 代码块的有效 JSON"""
        response = '''```json
{
  "thinking": "用户问的是投资相关内容",
  "node_list": ["0001", "0003"]
}
```'''
        result = parse_llm_response(response)
        assert result.success is True
        assert result.node_ids == ["0001", "0003"]
        assert "投资相关" in result.thinking

    def test_valid_json_without_markdown(self):
        """测试不带 markdown 的有效 JSON"""
        response = '{"thinking": "推理过程", "node_list": ["0001"]}'
        result = parse_llm_response(response)
        assert result.success is True
        assert result.node_ids == ["0001"]

    def test_invalid_json(self):
        """测试无效 JSON"""
        response = "这不是 JSON"
        result = parse_llm_response(response)
        assert result.success is False
        assert "JSON parse error" in result.error

    def test_node_list_not_list(self):
        """测试 node_list 不是列表"""
        response = '{"thinking": "test", "node_list": "0001"}'
        result = parse_llm_response(response)
        assert result.success is False
        assert "not a list" in result.error

    def test_node_list_with_numbers(self):
        """测试 node_list 包含数字（自动转换）"""
        response = '{"thinking": "test", "node_list": [1, 2, 3]}'
        result = parse_llm_response(response)
        assert result.success is True
        assert result.node_ids == ["1", "2", "3"]
