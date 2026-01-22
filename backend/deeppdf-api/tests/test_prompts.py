# tests/test_prompts.py
"""Agent Prompt 管理测试"""
import pytest
from deeppdf.agent.prompts import (
    PromptBuilder,
    RouteDecision,
)


# ========== PromptBuilder 测试 ==========

class TestPromptBuilder:
    """PromptBuilder 测试套件"""

    def test_build_with_tool_descriptions(self):
        """测试: 使用工具描述构建 prompt"""
        builder = PromptBuilder(
            tool_descriptions="## 可用工具\n\n### inspect_toc\n查看目录",
            enable_few_shot=False
        )

        prompt = builder.build()

        assert "你是一个专业的 PDF 阅读助手" in prompt
        assert "### inspect_toc\n查看目录" in prompt
        assert "示例对话" not in prompt  # Few-Shot 被禁用

    def test_build_with_few_shot(self):
        """测试: 包含 Few-Shot 示例"""
        builder = PromptBuilder(
            tool_descriptions="",
            enable_few_shot=True
        )

        prompt = builder.build()

        assert "示例对话" in prompt
        assert "示例 1: 简单事实查询" in prompt
        assert "错误示例" in prompt

    def test_build_without_few_shot(self):
        """测试: 不包含 Few-Shot 示例"""
        builder = PromptBuilder(
            tool_descriptions="",
            enable_few_shot=False
        )

        prompt = builder.build()

        assert "示例对话" not in prompt
        assert "快速检索" in prompt  # 但保留核心内容

    def test_build_chat_message(self):
        """测试: 构建聊天消息格式"""
        builder = PromptBuilder(
            tool_descriptions="",
            enable_few_shot=False
        )

        message = builder.build_chat_message()

        assert message["role"] == "system"
        assert "你是一个专业的 PDF 阅读助手" in message["content"]

    def test_from_tool_executor(self, mock_executor):
        """测试: 从 ToolExecutor 创建 PromptBuilder"""
        builder = PromptBuilder.from_tool_executor(
            executor=mock_executor,
            enable_few_shot=True
        )

        prompt = builder.build()

        assert "你是一个专业的 PDF 阅读助手" in prompt
        assert "inspect_toc" in prompt  # 来自 mock_executor


# ========== RouteDecision 测试 ==========

class TestRouteDecision:
    """RouteDecision 路由决策测试套件"""

    def test_classify_simple_fact_query(self):
        """测试: 分类简单事实查询"""
        queries = [
            "乔布斯哪年发布的 iPhone?",
            "什么是深度学习?",
            "文档中提到的方法有哪些?",
            "谁发明了电话?",
            "是否包含这个功能?"
        ]

        for query in queries:
            route = RouteDecision.classify_query(query)
            assert route == "fast", f"查询 '{query}' 应该被分类为 fast，实际是 {route}"

    def test_classify_complex_analysis_query(self):
        """测试: 分类复杂分析查询"""
        queries = [
            "分析乔布斯管理风格的演变",
            "对比文中提到的两种方法",
            "总结第三章的核心观点",
            "为什么这个方法有效?",
            "如何评价这个策略?"
        ]

        for query in queries:
            route = RouteDecision.classify_query(query)
            assert route == "slow", f"查询 '{query}' 应该被分类为 slow，实际是 {route}"

    def test_classify_section_query(self):
        """测试: 分类章节查询"""
        queries = [
            "查看第10页的内容",
            "阅读第三章",
            "第5节讲了什么?",
            "显示第100页"
        ]

        for query in queries:
            route = RouteDecision.classify_query(query)
            assert route == "section", f"查询 '{query}' 应该被分类为 section，实际是 {route}"

    def test_suggest_tool_fast_track(self):
        """测试: 为快速检索建议工具"""
        query = "乔布斯哪年发布的 iPhone?"
        tool = RouteDecision.suggest_tool(query)

        assert tool == "hybrid_search"

    def test_suggest_tool_slow_track(self):
        """测试: 为深度阅读建议工具"""
        query = "分析乔布斯管理风格的演变"
        tool = RouteDecision.suggest_tool(query)

        assert tool == "inspect_toc"

    def test_suggest_tool_section(self):
        """测试: 为章节查询建议工具"""
        query = "查看第10页的内容"
        tool = RouteDecision.suggest_tool(query)

        assert tool == "read_page"

    def test_has_section_reference_chapter(self):
        """测试: 检测章节引用 (章)"""
        assert RouteDecision._has_section_reference("第三章") is True
        assert RouteDecision._has_section_reference("第5章") is True
        assert RouteDecision._has_section_reference("第 10 章") is True

    def test_has_section_reference_section(self):
        """测试: 检测章节引用 (节)"""
        assert RouteDecision._has_section_reference("第2节") is True
        assert RouteDecision._has_section_reference("第 3 节") is True

    def test_has_section_reference_page(self):
        """测试: 检测章节引用 (页)"""
        assert RouteDecision._has_section_reference("第10页") is True
        assert RouteDecision._has_section_reference("第5页") is True
        assert RouteDecision._has_section_reference("100页") is True

    def test_has_section_reference_negative(self):
        """测试: 非章节引用"""
        assert RouteDecision._has_section_reference("乔布斯哪年发布的") is False
        assert RouteDecision._has_section_reference("分析管理风格") is False

    def test_ambiguous_query_default_to_fast(self):
        """测试: 模糊查询默认使用快速检索"""
        query = "告诉我关于乔布斯的信息"
        route = RouteDecision.classify_query(query)

        # 不包含明确关键词，默认为 fast
        assert route == "fast"


# ========== 函数式 API 测试 ==========

class TestFunctionalAPI:
    """函数式 API 测试套件"""

    def test_build_system_prompt(self):
        """测试: 构建 System Prompt"""
        from deeppdf.agent.prompts import build_system_prompt

        tool_desc = "### test_tool\n测试工具描述"
        prompt = build_system_prompt(tool_desc)

        assert "PDF 阅读助手" in prompt
        assert "test_tool" in prompt
        assert "测试工具描述" in prompt

    def test_build_messages_empty(self):
        """测试: 构建空消息"""
        from deeppdf.agent.prompts import build_messages

        messages = build_messages("测试查询", [], [])

        assert len(messages) == 1
        assert messages[0]["role"] == "user"
        assert messages[0]["content"] == "测试查询"

    def test_build_messages_with_history(self):
        """测试: 构建带历史的消息"""
        from deeppdf.agent.prompts import build_messages

        history = [
            {"role": "user", "content": "第一个问题"},
            {"role": "assistant", "content": "第一个回答"}
        ]
        messages = build_messages("第二个问题", history, [])

        assert len(messages) == 3
        assert messages[0]["content"] == "第一个问题"
        assert messages[1]["content"] == "第一个回答"
        assert messages[2]["content"] == "第二个问题"

    def test_build_messages_with_tool_results(self):
        """测试: 构建带工具结果的消息"""
        from deeppdf.agent.prompts import build_messages

        tool_results = [
            {
                "tool_call": {
                    "id": "call_123",
                    "type": "function",
                    "function": {"name": "test_tool", "arguments": "{}"}
                },
                "output": "工具执行结果"
            }
        ]
        messages = build_messages("测试", [], tool_results)

        assert len(messages) == 3
        # 用户查询
        assert messages[0]["role"] == "user"
        # assistant 的工具调用
        assert messages[1]["role"] == "assistant"
        assert messages[1]["tool_calls"][0]["id"] == "call_123"
        # 工具返回结果
        assert messages[2]["role"] == "tool"
        assert messages[2]["content"] == "工具执行结果"

    def test_build_messages_complete(self):
        """测试: 构建完整消息（历史 + 工具结果）"""
        from deeppdf.agent.prompts import build_messages

        history = [
            {"role": "user", "content": "之前的问题"}
        ]
        tool_results = [
            {
                "tool_call": {
                    "id": "call_456",
                    "type": "function",
                    "function": {"name": "search", "arguments": '{"q": "test"}'}
                },
                "output": "搜索结果"
            }
        ]
        messages = build_messages("新问题", history, tool_results)

        assert len(messages) == 4
        assert messages[0]["content"] == "之前的问题"
        assert messages[1]["content"] == "新问题"
        assert messages[2]["tool_calls"][0]["id"] == "call_456"
        assert messages[3]["content"] == "搜索结果"


# ========== Fixture ==========

@pytest.fixture
def mock_executor():
    """模拟 ToolExecutor fixture"""
    from deeppdf.agent.executor import ToolExecutor
    from deeppdf.agent.tools import InspectTocTool

    tool = InspectTocTool({
        "structure": [
            {
                "title": "测试章节",
                "node_id": "node_1",
                "start_index": 1,
                "end_index": 10,
                "nodes": []
            }
        ]
    })

    executor = ToolExecutor({"inspect_toc": tool})
    return executor
