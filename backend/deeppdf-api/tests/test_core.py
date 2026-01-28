# tests/test_core.py
"""
测试 DeepPDFAgent 核心类
"""
from unittest.mock import MagicMock, patch

import pytest

from deeppdf.agent import DeepPDFAgent
from deeppdf.agent.core import LLMError


# ========== 测试 Fixtures ==========


@pytest.fixture
def mock_tree_structure():
    """模拟树状结构"""
    return {
        "structure": [
            {
                "title": "第一章",
                "start_index": 1,
                "end_index": 10,
                "node_id": "ch1",
                "nodes": [],
            }
        ]
    }


@pytest.fixture
def mock_openai_client():
    """模拟 OpenAI 客户端"""
    mock_client = MagicMock()

    # 模拟 chat.completions.create
    mock_completion = MagicMock()
    mock_completion.choices = [MagicMock()]

    mock_client.chat.completions.create = MagicMock(return_value=mock_completion)

    return mock_client


@pytest.fixture
def agent(mock_tree_structure, mock_openai_client):
    """创建 Agent 实例"""
    with patch("deeppdf.agent.core.OpenAI", return_value=mock_openai_client):
        agent = DeepPDFAgent(
            index_id="test_index",
            storage_dir="/tmp/test_storage",
            tree_structure=mock_tree_structure,
            llm_provider="deepseek",
            api_key="test_key",
        )
        # 替换 client 为 mock
        agent.client = mock_openai_client
        return agent


# ========== 测试 Agent 初始化 ==========


def test_agent_init(mock_tree_structure):
    """测试 Agent 初始化"""
    with patch("deeppdf.agent.core.OpenAI") as mock_openai:
        agent = DeepPDFAgent(
            index_id="test_index",
            storage_dir="/tmp/test_storage",
            tree_structure=mock_tree_structure,
            llm_provider="deepseek",
            api_key="test_key",
        )

        assert agent.index_id == "test_index"
        assert agent.storage_dir == "/tmp/test_storage"
        assert agent.llm_provider == "deepseek"
        assert agent.llm_model == "deepseek-chat"
        assert agent.temperature == 0.7
        assert agent.max_iterations == 10
        assert agent.executor is not None
        assert agent.system_prompt != ""


def test_agent_init_openai_provider(mock_tree_structure):
    """测试使用 OpenAI provider 初始化"""
    with patch("deeppdf.agent.core.OpenAI") as mock_openai:
        agent = DeepPDFAgent(
            index_id="test_index",
            storage_dir="/tmp/test_storage",
            tree_structure=mock_tree_structure,
            llm_provider="openai",
            api_key="test_key",
        )

        assert agent.llm_provider == "openai"
        assert agent.llm_model == "gpt-4o-mini"


def test_agent_init_anthropic_provider_raises(mock_tree_structure):
    """测试 Anthropic provider 应该抛出错误"""
    with pytest.raises(ValueError, match="Anthropic 暂不支持"):
        DeepPDFAgent(
            index_id="test_index",
            storage_dir="/tmp/test_storage",
            tree_structure=mock_tree_structure,
            llm_provider="anthropic",
        )


def test_get_default_model():
    """测试获取默认模型"""
    with patch("deeppdf.agent.core.OpenAI"):
        agent = DeepPDFAgent(
            index_id="test_index",
            storage_dir="/tmp/test_storage",
            tree_structure={},
        )

        assert agent._get_default_model("deepseek") == "deepseek-chat"
        assert agent._get_default_model("openai") == "gpt-4o-mini"
        assert agent._get_default_model("unknown") == "deepseek-chat"


# ========== 测试工具 Schema ==========


def test_get_tool_schemas(agent):
    """测试获取工具 schema"""
    schemas = agent._get_tool_schemas()

    # 注意: read_page 工具需要 pageindex_lib_path，未提供时只有 2 个工具
    assert len(schemas) >= 2  # inspect_toc, hybrid_search (read_page 可选)

    # inspect_toc schema
    inspect_toc_schema = next(
        s for s in schemas if s["function"]["name"] == "inspect_toc"
    )
    assert inspect_toc_schema["type"] == "function"
    assert inspect_toc_schema["function"]["parameters"]["type"] == "object"

    # hybrid_search schema
    hybrid_search_schema = next(
        s for s in schemas if s["function"]["name"] == "hybrid_search"
    )
    assert "query" in hybrid_search_schema["function"]["parameters"]["properties"]
    assert "query" in hybrid_search_schema["function"]["parameters"]["required"]


def test_get_tool_schemas_with_read_page(mock_tree_structure):
    """测试获取包含 read_page 的工具 schema"""
    with patch("deeppdf.agent.core.OpenAI") as mock_openai:
        agent = DeepPDFAgent(
            index_id="test_index",
            storage_dir="/tmp/test_storage",
            tree_structure=mock_tree_structure,
            llm_provider="deepseek",
            pageindex_lib_path="/tmp/pageindex/lib",  # 提供此路径以启用 read_page
        )

        # 由于我们只是提供路径，实际工具仍可能因为缺少库而失败
        # 这里只验证 schema 生成逻辑
        schemas = agent._get_tool_schemas()

        # 至少应该有 inspect_toc 和 hybrid_search
        schema_names = [s["function"]["name"] for s in schemas]
        assert "inspect_toc" in schema_names
        assert "hybrid_search" in schema_names


# ========== 测试消息构建 ==========


def test_build_messages_simple(agent):
    """测试构建简单消息（使用 V2 默认版本）"""
    # 新版本：_build_messages 从 session_history 和 current_turn_history 读取
    agent.current_turn_history = [{"role": "user", "content": "测试查询"}]
    messages = agent._build_messages()

    # system 消息 + current_turn_history 中的 user 消息
    assert len(messages) == 2  # system + user
    assert messages[0]["role"] == "system"
    # V2 版本使用"读书郎"人设
    assert "读书郎" in messages[0]["content"]
    assert messages[1]["role"] == "user"
    assert messages[1]["content"] == "测试查询"


def test_build_messages_with_tool_results(agent):
    """测试构建带工具结果的消息"""
    # 新版本：_build_messages 从 session_history 和 current_turn_history 读取
    agent.current_turn_history = [
        {"role": "user", "content": "查看目录"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_123",
                    "type": "function",
                    "function": {"name": "inspect_toc", "arguments": "{}"},
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call_123",
            "content": "[SUCCESS] # 目录\n\n- 第一章",
        },
    ]

    messages = agent._build_messages()

    # 只有 system 消息 + current_turn_history 的3条消息
    assert len(messages) == 4  # system + user + assistant + tool
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    assert messages[2]["role"] == "assistant"
    assert messages[2]["tool_calls"][0]["id"] == "call_123"
    assert messages[3]["role"] == "tool"
    assert messages[3]["tool_call_id"] == "call_123"


# ========== 测试 run() 主循环 ==========


def test_run_simple_query_no_tools(agent):
    """测试简单查询（无工具调用）"""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "这是一个简单回答"
    mock_response.choices[0].message.tool_calls = None

    agent.client.chat.completions.create = MagicMock(return_value=mock_response)

    result = agent.run("你好")

    assert result == "这是一个简单回答"
    agent.client.chat.completions.create.assert_called_once()


def test_run_with_tool_call(agent):
    """测试带工具调用的查询"""
    # 第一次调用: 返回工具调用
    first_response = MagicMock()
    first_response.choices = [MagicMock()]
    first_response.choices[0].message.content = None
    tool_call = MagicMock()
    tool_call.id = "call_123"
    tool_call.type = "function"
    tool_call.function.name = "inspect_toc"
    tool_call.function.arguments = "{}"
    first_response.choices[0].message.tool_calls = [tool_call]

    # 第二次调用: 返回最终回答
    second_response = MagicMock()
    second_response.choices = [MagicMock()]
    second_response.choices[0].message.content = "根据目录，文档包含第一章"
    second_response.choices[0].message.tool_calls = None

    agent.client.chat.completions.create = MagicMock(
        side_effect=[first_response, second_response]
    )

    result = agent.run("查看目录")

    assert "根据目录" in result
    assert agent.client.chat.completions.create.call_count == 2


def test_run_max_iterations_limit(agent):
    """测试最大迭代次数限制"""
    # 模拟一直返回工具调用
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = None
    tool_call = MagicMock()
    tool_call.id = "call_123"
    tool_call.type = "function"
    tool_call.function.name = "inspect_toc"
    tool_call.function.arguments = "{}"
    mock_response.choices[0].message.tool_calls = [tool_call]

    agent.client.chat.completions.create = MagicMock(return_value=mock_response)

    # 设置较小的 max_iterations
    agent.max_iterations = 2

    result = agent.run("测试")

    # 应该达到最大迭代次数
    assert agent.client.chat.completions.create.call_count >= 2


def test_run_llm_error(agent):
    """测试 LLM 调用错误处理"""
    agent.client.chat.completions.create = MagicMock(side_effect=Exception("API 错误"))

    # LLM 错误应该抛出 LLMError 异常
    with pytest.raises(LLMError) as exc_info:
        agent.run("测试查询")

    assert "LLM调用失败" in str(exc_info.value)


# ========== 测试流式输出 ==========


def test_run_stream_simple(agent):
    """测试简单流式输出"""
    # 模拟流式响应
    mock_chunk1 = MagicMock()
    mock_chunk1.choices = [MagicMock()]
    mock_chunk1.choices[0].delta.content = "你好"
    mock_chunk1.choices[0].delta.tool_calls = None

    mock_chunk2 = MagicMock()
    mock_chunk2.choices = [MagicMock()]
    mock_chunk2.choices[0].delta.content = "世界"
    mock_chunk2.choices[0].delta.tool_calls = None

    mock_chunk3 = MagicMock()
    mock_chunk3.choices = [MagicMock()]
    mock_chunk3.choices[0].delta.content = None
    mock_chunk3.choices[0].delta.tool_calls = None

    mock_stream = MagicMock()
    mock_stream.__iter__ = MagicMock(
        return_value=iter([mock_chunk1, mock_chunk2, mock_chunk3])
    )

    agent.client.chat.completions.create = MagicMock(return_value=mock_stream)

    chunks = list(agent.run_stream("你好"))

    # 新版本的 run_stream 会输出思考标签和进度信息
    # 检查是否包含实际的文本内容
    assert "你好" in chunks
    assert "世界" in chunks


def test_run_stream_with_tool_call(agent):
    """测试流式输出带工具调用"""
    # 第一次迭代: 工具调用
    mock_chunk1 = MagicMock()
    mock_chunk1.choices = [MagicMock()]
    mock_chunk1.choices[0].delta.content = None
    tool_call = MagicMock()
    tool_call.id = "call_123"
    tool_call.index = 0
    tool_call.function.name = "inspect_toc"
    tool_call.function.arguments = "{}"
    mock_chunk1.choices[0].delta.tool_calls = [tool_call]

    mock_chunk2 = MagicMock()
    mock_chunk2.choices = [MagicMock()]
    mock_chunk2.choices[0].delta.content = None
    mock_chunk2.choices[0].delta.tool_calls = None

    mock_stream1 = MagicMock()
    mock_stream1.__iter__ = MagicMock(return_value=iter([mock_chunk1, mock_chunk2]))

    # 第二次迭代: 最终回答
    mock_chunk3 = MagicMock()
    mock_chunk3.choices = [MagicMock()]
    mock_chunk3.choices[0].delta.content = "完成"
    mock_chunk3.choices[0].delta.tool_calls = None

    mock_chunk4 = MagicMock()
    mock_chunk4.choices = [MagicMock()]
    mock_chunk4.choices[0].delta.content = None
    mock_chunk4.choices[0].delta.tool_calls = None

    mock_stream2 = MagicMock()
    mock_stream2.__iter__ = MagicMock(return_value=iter([mock_chunk3, mock_chunk4]))

    agent.client.chat.completions.create = MagicMock(
        side_effect=[mock_stream1, mock_stream2]
    )

    chunks = list(agent.run_stream("测试"))

    # 新版本的 run_stream 会输出思考标签、进度信息和工具调用信息
    # 检查是否包含最终的回答内容
    assert "完成" in chunks


# ========== 测试历史管理 ==========


def test_reset_history(agent):
    """测试重置历史"""
    agent.session_history = [{"role": "user", "content": "test"}]
    agent.current_turn_history = [{"role": "user", "content": "test2"}]
    agent.reset_history()
    assert agent.session_history == []
    assert agent.current_turn_history == []


def test_get_history(agent):
    """测试获取历史"""
    agent.current_turn_history = [{"role": "user", "content": "test"}]
    history = agent.get_history()
    assert history == [{"role": "user", "content": "test"}]
    # 确保返回的是副本
    assert history is not agent.current_turn_history


def test_run_tracks_history_no_tools(agent):
    """测试 run() 跟踪历史记录（无工具调用）"""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "简单回答"
    mock_response.choices[0].message.tool_calls = None

    agent.client.chat.completions.create = MagicMock(return_value=mock_response)

    result = agent.run("你好")

    assert result == "简单回答"
    # 新版本：session_history 包含 user query + assistant 回答
    assert len(agent.session_history) == 2
    assert agent.session_history[0]["role"] == "user"
    assert agent.session_history[0]["content"] == "你好"
    assert agent.session_history[1]["role"] == "assistant"
    assert agent.session_history[1]["content"] == "简单回答"
    # current_turn_history 应该被清空
    assert len(agent.current_turn_history) == 0


def test_run_tracks_history_with_tools(agent):
    """测试 run() 跟踪历史记录（带工具调用）"""
    # 第一次调用: 返回工具调用
    first_response = MagicMock()
    first_response.choices = [MagicMock()]
    first_response.choices[0].message.content = None
    tool_call = MagicMock()
    tool_call.id = "call_123"
    tool_call.type = "function"
    tool_call.function.name = "inspect_toc"
    tool_call.function.arguments = "{}"
    first_response.choices[0].message.tool_calls = [tool_call]

    # 第二次调用: 返回最终回答
    second_response = MagicMock()
    second_response.choices = [MagicMock()]
    second_response.choices[0].message.content = "最终回答"
    second_response.choices[0].message.tool_calls = None

    agent.client.chat.completions.create = MagicMock(
        side_effect=[first_response, second_response]
    )

    result = agent.run("查看目录")

    assert result == "最终回答"
    # 新版本：session_history 应该包含:
    # 1. user query
    # 2. assistant 最终回答（工具调用被添加到 current_turn_history，最后清空）
    # 注意：新版本中，工具调用过程记录在 current_turn_history 中，最后被清空
    # 只有最终的 user query 和 assistant 回答被保存到 session_history
    assert len(agent.session_history) == 2
    assert agent.session_history[0]["role"] == "user"
    assert agent.session_history[0]["content"] == "查看目录"
    assert agent.session_history[1]["role"] == "assistant"
    assert agent.session_history[1]["content"] == "最终回答"
    # current_turn_history 应该被清空
    assert len(agent.current_turn_history) == 0


def test_run_stream_tracks_history(agent):
    """测试 run_stream() 跟踪历史记录"""
    # 模拟流式响应（无工具调用）
    mock_chunk1 = MagicMock()
    mock_chunk1.choices = [MagicMock()]
    mock_chunk1.choices[0].delta.content = "你好"
    mock_chunk1.choices[0].delta.tool_calls = None

    mock_chunk2 = MagicMock()
    mock_chunk2.choices = [MagicMock()]
    mock_chunk2.choices[0].delta.content = None
    mock_chunk2.choices[0].delta.tool_calls = None

    mock_stream = MagicMock()
    mock_stream.__iter__ = MagicMock(return_value=iter([mock_chunk1, mock_chunk2]))

    agent.client.chat.completions.create = MagicMock(return_value=mock_stream)

    chunks = list(agent.run_stream("测试"))

    # 新版本的 run_stream 会输出思考标签和进度信息
    # 检查是否包含实际的文本内容
    assert "你好" in chunks

    # 新版本：session_history 包含 user query + assistant 回答
    assert len(agent.session_history) == 2
    assert agent.session_history[0]["role"] == "user"
    assert agent.session_history[0]["content"] == "测试"
    assert agent.session_history[1]["role"] == "assistant"
    assert agent.session_history[1]["content"] == "你好"
    # current_turn_history 应该被清空
    assert len(agent.current_turn_history) == 0


# ========== 测试工具调用格式化 ==========


def test_format_tool_call(agent):
    """测试工具调用格式化"""
    mock_tool_call = MagicMock()
    mock_tool_call.id = "call_123"
    mock_tool_call.type = "function"
    mock_tool_call.function.name = "test_tool"
    mock_tool_call.function.arguments = '{"arg": "value"}'

    formatted = agent._format_tool_call(mock_tool_call)

    assert formatted["id"] == "call_123"
    assert formatted["type"] == "function"
    assert formatted["function"]["name"] == "test_tool"
    assert formatted["function"]["arguments"] == '{"arg": "value"}'


def test_extract_tool_calls(agent):
    """测试提取工具调用"""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.tool_calls = [MagicMock(), MagicMock()]

    tool_calls = agent._extract_tool_calls(mock_response)

    assert len(tool_calls) == 2


def test_extract_tool_calls_empty(agent):
    """测试提取空工具调用"""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.tool_calls = None

    tool_calls = agent._extract_tool_calls(mock_response)

    assert tool_calls == []


# ========== 测试 LLM TreeSearch 支持 ==========


def test_agent_with_llm_tree_search_enabled(mock_tree_structure, mock_openai_client):
    """测试启用 LLM 树搜索时参数正确传递"""
    with patch("deeppdf.agent.core.OpenAI", return_value=mock_openai_client):
        agent = DeepPDFAgent(
            index_id="test_index",
            storage_dir="/tmp/test_storage",
            tree_structure=mock_tree_structure,
            llm_provider="deepseek",
            api_key="test_key",
            enable_llm_tree_search=True,
        )
        # 替换 client 为 mock
        agent.client = mock_openai_client

        # 验证 llm_tree_search 工具已启用
        assert "llm_tree_search" in agent.executor.tools
        assert agent.executor.tools["llm_tree_search"] is not None


def test_agent_with_llm_tree_search_disabled(mock_tree_structure, mock_openai_client):
    """测试禁用 LLM 树搜索时工具不可用"""
    with patch("deeppdf.agent.core.OpenAI", return_value=mock_openai_client):
        agent = DeepPDFAgent(
            index_id="test_index",
            storage_dir="/tmp/test_storage",
            tree_structure=mock_tree_structure,
            llm_provider="deepseek",
            api_key="test_key",
            enable_llm_tree_search=False,
        )
        # 替换 client 为 mock
        agent.client = mock_openai_client

        # 验证 llm_tree_search 工具未启用
        assert "llm_tree_search" not in agent.executor.tools
