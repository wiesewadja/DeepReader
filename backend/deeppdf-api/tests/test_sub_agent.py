# tests/test_sub_agent.py
"""SubAgentExecutor 单元测试"""
import json
from unittest.mock import MagicMock, patch
from deeppdf.agent.sub_agent import SubAgentExecutor
from deeppdf.agent.executor import ToolExecutor


class TestSubAgentInit:
    """测试 SubAgentExecutor 初始化"""

    def test_sub_agent_init_with_default_params(self):
        """测试: 使用默认参数初始化"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        assert sub_agent.client is mock_client
        assert sub_agent.model == "deepseek-chat"
        assert sub_agent.executor is mock_executor
        assert sub_agent.temperature == 0.7
        assert sub_agent.top_p == 1.0

    def test_sub_agent_init_with_custom_params(self):
        """测试: 使用自定义参数初始化"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="gpt-4",
            executor=mock_executor,
            temperature=0.5,
            top_p=0.9,
        )

        assert sub_agent.temperature == 0.5
        assert sub_agent.top_p == 0.9


class TestSubAgentNoToolCall:
    """测试无工具调用时的直接返回"""

    def test_sub_agent_no_tool_call_returns_content(self):
        """测试: 无工具调用时直接返回内容"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)
        mock_executor.tools = {}

        # 模拟 LLM 响应（无工具调用）
        mock_response = MagicMock()
        mock_message = MagicMock()
        mock_message.content = "这是最终回答"
        mock_message.tool_calls = None
        mock_response.choices = [MagicMock(message=mock_message)]

        mock_client.chat.completions.create.return_value = mock_response

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        result = sub_agent.execute(
            skill_knowledge="你是一个帮助助手",
            user_query="你好",
        )

        assert result == "这是最终回答"

    def test_sub_agent_empty_content_returns_empty_string(self):
        """测试: 空内容返回空字符串"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)
        mock_executor.tools = {}

        # 模拟 LLM 响应（无内容）
        mock_response = MagicMock()
        mock_message = MagicMock()
        mock_message.content = None
        mock_message.tool_calls = None
        mock_response.choices = [MagicMock(message=mock_message)]

        mock_client.chat.completions.create.return_value = mock_response

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        result = sub_agent.execute(
            skill_knowledge="你是一个帮助助手",
            user_query="你好",
        )

        assert result == ""

    def test_sub_agent_cleans_deepseek_tags(self):
        """测试: 清理 DeepSeek 内部标签"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)
        mock_executor.tools = {}

        # 模拟包含 DeepSeek 内部标签的响应
        mock_response = MagicMock()
        mock_message = MagicMock()
        mock_message.content = "回答内容<|DSML|function_calls|>内部标签</|DSML|function_calls|>更多内容"
        mock_message.tool_calls = None
        mock_response.choices = [MagicMock(message=mock_message)]

        mock_client.chat.completions.create.return_value = mock_response

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        result = sub_agent.execute(
            skill_knowledge="你是一个帮助助手",
            user_query="你好",
        )

        # 内部标签应该被清理掉
        assert "<|DSML|" not in result
        assert "</|DSML|" not in result


class TestSubAgentWithToolCall:
    """测试有工具调用时的执行流程"""

    def test_sub_agent_with_single_tool_call(self):
        """测试: 单个工具调用的执行流程"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)

        # 模拟工具
        mock_tool = MagicMock()
        mock_tool.description = "测试工具"
        mock_executor.tools = {"test_tool": mock_tool}
        mock_executor.execute.return_value = "[SUCCESS] 工具执行结果"

        # 第一轮：返回工具调用
        mock_response_1 = MagicMock()
        mock_tool_call = MagicMock()
        mock_tool_call.id = "call_123"
        mock_tool_call.type = "function"
        mock_tool_call.function.name = "test_tool"
        mock_tool_call.function.arguments = '{"arg1": "value1"}'

        mock_message_1 = MagicMock()
        mock_message_1.content = None
        mock_message_1.tool_calls = [mock_tool_call]
        mock_response_1.choices = [MagicMock(message=mock_message_1)]

        # 第二轮：返回最终回答
        mock_response_2 = MagicMock()
        mock_message_2 = MagicMock()
        mock_message_2.content = "基于工具结果的最终回答"
        mock_message_2.tool_calls = None
        mock_response_2.choices = [MagicMock(message=mock_message_2)]

        mock_client.chat.completions.create.side_effect = [
            mock_response_1,
            mock_response_2,
        ]

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        result = sub_agent.execute(
            skill_knowledge="你是一个帮助助手",
            user_query="请帮我调用工具",
        )

        assert result == "基于工具结果的最终回答"
        # 验证工具被调用
        mock_executor.execute.assert_called_once_with("test_tool", arg1="value1")

    def test_sub_agent_with_multiple_tool_calls(self):
        """测试: 多个工具调用的执行流程"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)

        # 模拟工具
        mock_tool = MagicMock()
        mock_tool.description = "测试工具"
        mock_executor.tools = {"tool_a": mock_tool, "tool_b": mock_tool}
        mock_executor.execute.return_value = "[SUCCESS] 工具执行结果"

        # 第一轮：返回多个工具调用
        mock_response_1 = MagicMock()

        mock_tool_call_1 = MagicMock()
        mock_tool_call_1.id = "call_1"
        mock_tool_call_1.type = "function"
        mock_tool_call_1.function.name = "tool_a"
        mock_tool_call_1.function.arguments = '{"x": 1}'

        mock_tool_call_2 = MagicMock()
        mock_tool_call_2.id = "call_2"
        mock_tool_call_2.type = "function"
        mock_tool_call_2.function.name = "tool_b"
        mock_tool_call_2.function.arguments = '{"y": 2}'

        mock_message_1 = MagicMock()
        mock_message_1.content = None
        mock_message_1.tool_calls = [mock_tool_call_1, mock_tool_call_2]
        mock_response_1.choices = [MagicMock(message=mock_message_1)]

        # 第二轮：返回最终回答
        mock_response_2 = MagicMock()
        mock_message_2 = MagicMock()
        mock_message_2.content = "最终回答"
        mock_message_2.tool_calls = None
        mock_response_2.choices = [MagicMock(message=mock_message_2)]

        mock_client.chat.completions.create.side_effect = [
            mock_response_1,
            mock_response_2,
        ]

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        result = sub_agent.execute(
            skill_knowledge="你是一个帮助助手",
            user_query="请帮我调用多个工具",
        )

        assert result == "最终回答"
        # 验证两个工具都被调用
        assert mock_executor.execute.call_count == 2

    def test_sub_agent_with_invalid_json_arguments(self):
        """测试: 工具参数 JSON 解析失败时的处理"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)

        # 模拟工具
        mock_tool = MagicMock()
        mock_tool.description = "测试工具"
        mock_executor.tools = {"test_tool": mock_tool}
        mock_executor.execute.return_value = "[SUCCESS] 工具执行结果"

        # 第一轮：返回无效 JSON 参数的工具调用
        mock_response_1 = MagicMock()
        mock_tool_call = MagicMock()
        mock_tool_call.id = "call_123"
        mock_tool_call.type = "function"
        mock_tool_call.function.name = "test_tool"
        mock_tool_call.function.arguments = "invalid json"  # 无效 JSON

        mock_message_1 = MagicMock()
        mock_message_1.content = None
        mock_message_1.tool_calls = [mock_tool_call]
        mock_response_1.choices = [MagicMock(message=mock_message_1)]

        # 第二轮：返回最终回答
        mock_response_2 = MagicMock()
        mock_message_2 = MagicMock()
        mock_message_2.content = "最终回答"
        mock_message_2.tool_calls = None
        mock_response_2.choices = [MagicMock(message=mock_message_2)]

        mock_client.chat.completions.create.side_effect = [
            mock_response_1,
            mock_response_2,
        ]

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        result = sub_agent.execute(
            skill_knowledge="你是一个帮助助手",
            user_query="请帮我调用工具",
        )

        assert result == "最终回答"
        # 验证工具被调用（使用空参数）
        mock_executor.execute.assert_called_once_with("test_tool")

    def test_sub_agent_respects_available_tools(self):
        """测试: 限制可用工具列表"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)

        # 模拟多个工具
        mock_tool = MagicMock()
        mock_tool.description = "测试工具"
        mock_executor.tools = {
            "allowed_tool": mock_tool,
            "restricted_tool": mock_tool,
        }

        # 直接返回（无工具调用）
        mock_response = MagicMock()
        mock_message = MagicMock()
        mock_message.content = "回答"
        mock_message.tool_calls = None
        mock_response.choices = [MagicMock(message=mock_message)]

        mock_client.chat.completions.create.return_value = mock_response

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        sub_agent.execute(
            skill_knowledge="你是一个帮助助手",
            user_query="你好",
            available_tools=["allowed_tool"],  # 只允许一个工具
        )

        # 验证 LLM 调用时只传递允许的工具
        call_args = mock_client.chat.completions.create.call_args
        tools = call_args.kwargs.get("tools", [])
        assert len(tools) == 1
        assert tools[0]["function"]["name"] == "allowed_tool"


class TestSubAgentContextIsolation:
    """测试上下文隔离"""

    def test_sub_agent_uses_isolated_message_history(self):
        """测试: 子 Agent 使用隔离的消息历史"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)
        mock_executor.tools = {}

        # 捕获传递给 LLM 的 messages
        captured_messages = []

        def capture_create(**kwargs):
            captured_messages.append(kwargs.get("messages", []))
            mock_response = MagicMock()
            mock_message = MagicMock()
            mock_message.content = "回答"
            mock_message.tool_calls = None
            mock_response.choices = [MagicMock(message=mock_message)]
            return mock_response

        mock_client.chat.completions.create.side_effect = capture_create

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        sub_agent.execute(
            skill_knowledge="Skill 知识",
            user_query="用户问题",
        )

        # 验证消息历史只包含 system 和 user 消息
        assert len(captured_messages) == 1
        messages = captured_messages[0]
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[0]["content"] == "Skill 知识"
        assert messages[1]["role"] == "user"
        assert messages[1]["content"] == "用户问题"

    def test_sub_agent_tool_results_not_leaked(self):
        """测试: 工具结果不会泄露到外部上下文"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)

        mock_tool = MagicMock()
        mock_tool.description = "测试工具"
        mock_executor.tools = {"test_tool": mock_tool}
        mock_executor.execute.return_value = "[SUCCESS] 敏感数据"

        # 第一轮：工具调用
        mock_response_1 = MagicMock()
        mock_tool_call = MagicMock()
        mock_tool_call.id = "call_123"
        mock_tool_call.type = "function"
        mock_tool_call.function.name = "test_tool"
        mock_tool_call.function.arguments = "{}"

        mock_message_1 = MagicMock()
        mock_message_1.content = None
        mock_message_1.tool_calls = [mock_tool_call]
        mock_response_1.choices = [MagicMock(message=mock_message_1)]

        # 第二轮：最终回答
        mock_response_2 = MagicMock()
        mock_message_2 = MagicMock()
        mock_message_2.content = "基于敏感数据的回答"
        mock_message_2.tool_calls = None
        mock_response_2.choices = [MagicMock(message=mock_message_2)]

        mock_client.chat.completions.create.side_effect = [
            mock_response_1,
            mock_response_2,
        ]

        # 存储外部上下文
        external_messages = [
            {"role": "user", "content": "外部消息"},
        ]

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        result = sub_agent.execute(
            skill_knowledge="Skill 知识",
            user_query="问题",
        )

        # 验证外部上下文未被修改
        assert len(external_messages) == 1
        assert external_messages[0]["content"] == "外部消息"

        # 验证子 Agent 只返回最终结果
        assert result == "基于敏感数据的回答"
        assert "敏感数据" not in result  # 原始工具结果不应出现在最终回答中


class TestSubAgentMaxTurns:
    """测试最大循环次数"""

    def test_sub_agent_max_turns_reached(self):
        """测试: 达到最大循环次数时返回错误消息"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)

        mock_tool = MagicMock()
        mock_tool.description = "测试工具"
        mock_executor.tools = {"test_tool": mock_tool}
        mock_executor.execute.return_value = "[SUCCESS] 工具结果"

        # 每次都返回工具调用（无限循环）
        mock_response = MagicMock()
        mock_tool_call = MagicMock()
        mock_tool_call.id = "call_123"
        mock_tool_call.type = "function"
        mock_tool_call.function.name = "test_tool"
        mock_tool_call.function.arguments = "{}"

        mock_message = MagicMock()
        mock_message.content = None
        mock_message.tool_calls = [mock_tool_call]
        mock_response.choices = [MagicMock(message=mock_message)]

        mock_client.chat.completions.create.return_value = mock_response

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        result = sub_agent.execute(
            skill_knowledge="Skill 知识",
            user_query="问题",
            max_turns=3,  # 限制 3 轮
        )

        assert result == "达到最大循环次数，未能完成任务"
        # 验证确实调用了 3 次
        assert mock_client.chat.completions.create.call_count == 3


class TestSubAgentErrorHandling:
    """测试错误处理"""

    def test_sub_agent_llm_call_failure(self):
        """测试: LLM 调用失败时的处理"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)
        mock_executor.tools = {}

        # 模拟 LLM 调用失败
        mock_client.chat.completions.create.side_effect = Exception("API 错误")

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        result = sub_agent.execute(
            skill_knowledge="Skill 知识",
            user_query="问题",
        )

        assert "SubAgent 执行失败" in result
        assert "API 错误" in result


class TestSubAgentToolSchemas:
    """测试工具 Schema 生成"""

    def test_get_tool_schemas_inspect_toc(self):
        """测试: inspect_toc 工具 Schema"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)

        mock_tool = MagicMock()
        mock_tool.description = "查看目录"
        mock_executor.tools = {"inspect_toc": mock_tool}

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        schemas = sub_agent._get_tool_schemas()

        assert len(schemas) == 1
        assert schemas[0]["type"] == "function"
        assert schemas[0]["function"]["name"] == "inspect_toc"
        assert schemas[0]["function"]["parameters"] == {"type": "object", "properties": {}}

    def test_get_tool_schemas_read_page(self):
        """测试: read_page 工具 Schema"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)

        mock_tool = MagicMock()
        mock_tool.description = "读取页面"
        mock_executor.tools = {"read_page": mock_tool}

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        schemas = sub_agent._get_tool_schemas()

        assert len(schemas) == 1
        assert schemas[0]["function"]["name"] == "read_page"
        params = schemas[0]["function"]["parameters"]
        assert "page_num" in params["properties"]
        assert "force_visual" in params["properties"]
        assert params["required"] == ["page_num"]

    def test_get_tool_schemas_hybrid_search(self):
        """测试: hybrid_search 工具 Schema"""
        mock_client = MagicMock()
        mock_executor = MagicMock(spec=ToolExecutor)

        mock_tool = MagicMock()
        mock_tool.description = "混合搜索"
        mock_executor.tools = {"hybrid_search": mock_tool}

        sub_agent = SubAgentExecutor(
            client=mock_client,
            model="deepseek-chat",
            executor=mock_executor,
        )

        schemas = sub_agent._get_tool_schemas()

        assert len(schemas) == 1
        assert schemas[0]["function"]["name"] == "hybrid_search"
        params = schemas[0]["function"]["parameters"]
        assert "query" in params["properties"]
        assert "top_k" in params["properties"]
        assert params["required"] == ["query"]
