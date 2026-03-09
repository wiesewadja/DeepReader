"""LLM 树搜索模块测试"""

from deeppdf.services.llm_tree_search import (
    format_tree_structure,
    build_tree_prompt,
    parse_llm_response,
    extract_nodes_by_ids,
    LLMTreeSearchResult,
)


class TestFormatTreeStructure:
    """测试树结构格式化"""

    def test_empty_structure(self):
        """测试空结构"""
        text, chars = format_tree_structure({})
        assert text == ""
        assert chars == 0

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
        text, chars = format_tree_structure(tree)
        assert "第一章" in text
        assert "node_id: 0001" in text
        assert "摘要: 这是摘要" in text
        assert chars > 0

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
        text, chars = format_tree_structure(tree)
        assert "第一章" in text
        assert "1.1 子章节" in text
        assert "node_id: 0001" in text
        assert "node_id: 0002" in text

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
        text, chars = format_tree_structure(tree, max_text_length=50)
        assert "..." in text
        assert len([line for line in text.split("\n") if "摘要" in line][0]) < 100

    def test_respects_max_total_chars(self):
        """测试总字符数限制"""
        # 创建一个大树
        tree = {
            "structure": [
                {
                    "title": f"章节 {i}",
                    "node_id": f"{i:04d}",
                    "summary": "x" * 500,
                    "nodes": [],
                }
                for i in range(100)
            ]
        }
        text, chars = format_tree_structure(tree, max_total_chars=1000)
        assert chars <= 1100  # 允许少量超出（省略提示）
        assert "已达到长度限制" in text or chars < 1000

    def test_depth_limit(self):
        """测试深度限制"""
        # 创建深度嵌套的树
        tree = {
            "structure": [
                {
                    "title": "Level 1",
                    "node_id": "001",
                    "summary": "Summary 1",
                    "nodes": [
                        {
                            "title": "Level 2",
                            "node_id": "002",
                            "summary": "Summary 2",
                            "nodes": [
                                {
                                    "title": "Level 3",
                                    "node_id": "003",
                                    "summary": "Summary 3",
                                    "nodes": [
                                        {
                                            "title": "Level 4",
                                            "node_id": "004",
                                            "summary": "Summary 4",
                                            "nodes": [
                                                {
                                                    "title": "Level 5",
                                                    "node_id": "005",
                                                    "summary": "Summary 5",  # 超过默认深度 4
                                                    "nodes": [],
                                                }
                                            ],
                                        }
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ]
        }
        text, chars = format_tree_structure(tree, max_depth=4)
        assert "Summary 4" in text  # 第 4 层应该有摘要
        # 注意：第 5 层的标题会显示，但摘要不会


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


class TestExtractNodesByIds:
    """测试节点提取"""

    def test_extract_single_node(self):
        """测试提取单个节点"""
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "0001",
                    "text": "章节内容",
                    "summary": "摘要",
                    "start_index": 1,
                    "end_index": 10,
                    "nodes": [],
                }
            ]
        }
        results = extract_nodes_by_ids(tree, ["0001"])

        assert len(results) == 1
        assert results[0]["node_id"] == "0001"
        assert results[0]["title"] == "第一章"
        assert results[0]["text"] == "章节内容"

    def test_extract_multiple_nodes(self):
        """测试提取多个节点"""
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "0001",
                    "nodes": [
                        {
                            "title": "1.1 子章节",
                            "node_id": "0002",
                            "text": "子章节内容",
                            "nodes": [],
                        }
                    ],
                },
                {
                    "title": "第二章",
                    "node_id": "0003",
                    "nodes": [],
                },
            ]
        }
        results = extract_nodes_by_ids(tree, ["0002", "0003"])

        assert len(results) == 2
        # 验证顺序保持
        assert results[0]["node_id"] == "0002"
        assert results[1]["node_id"] == "0003"

    def test_extract_nonexistent_node(self):
        """测试提取不存在的节点"""
        tree = {"structure": [{"title": "章节", "node_id": "0001", "nodes": []}]}
        results = extract_nodes_by_ids(tree, ["9999"])

        assert len(results) == 0

    def test_extract_with_path(self):
        """测试路径构建"""
        tree = {
            "structure": [
                {
                    "title": "第一章",
                    "node_id": "0001",
                    "nodes": [
                        {
                            "title": "1.1 子章节",
                            "node_id": "0002",
                            "nodes": [],
                        }
                    ],
                }
            ]
        }
        results = extract_nodes_by_ids(tree, ["0002"])

        assert results[0]["path"] == "第一章 > 1.1 子章节"
