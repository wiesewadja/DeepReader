"""
PageIndex Mock 测试
测试 PageIndex 核心功能，使用 mock 避免 LLM API 调用
"""
import os
import sys
import pytest
from unittest.mock import Mock, patch, MagicMock
from io import BytesIO
from PyPDF2 import PdfWriter, PdfReader

# 添加 src 到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from pageindex.utils import (
    get_page_tokens,
    count_tokens,
    extract_json,
    list_to_tree,
    convert_physical_index_to_int,
    convert_page_to_int,
    post_processing,
    add_preface_if_needed,
    get_pdf_name,
    ConfigLoader,
)


# ============ Fixtures ============

@pytest.fixture
def mock_pdf_bytes():
    """创建一个简单的测试 PDF"""
    # 这里需要使用 PyPDF2 创建一个真实的 PDF 用于测试
    # 由于创建真实 PDF 比较复杂，我们先返回 None，稍后实现
    return None


@pytest.fixture
def mock_page_list():
    """模拟 PDF 页面列表"""
    return [
        ("Table of Contents\nChapter 1: Introduction\nChapter 2: Methods\n", 100),
        ("Chapter 1: Introduction\nThis is the introduction content.\n", 200),
        ("Chapter 2: Methods\nThis describes the methods.\n", 150),
        ("Conclusion\nThis is the conclusion.\n", 100),
    ]


@pytest.fixture
def mock_toc_structure():
    """模拟目录结构"""
    return [
        {"structure": "1", "title": "Chapter 1: Introduction", "physical_index": 2},
        {"structure": "2", "title": "Chapter 2: Methods", "physical_index": 3},
        {"structure": "3", "title": "Conclusion", "physical_index": 4},
    ]


# ============ 工具函数测试 ============

def test_count_tokens():
    """测试 token 计数"""
    text = "This is a test text."
    count = count_tokens(text, model="gpt-4o")
    assert count > 0
    assert isinstance(count, int)


def test_count_tokens_empty():
    """测试空文本 token 计数"""
    count = count_tokens("", model="gpt-4o")
    assert count == 0


def test_count_tokens_none():
    """测试 None 文本 token 计数"""
    count = count_tokens(None, model="gpt-4o")
    assert count == 0


def test_extract_json_simple():
    """测试简单 JSON 提取"""
    content = '{"key": "value"}'
    result = extract_json(content)
    assert result == {"key": "value"}


def test_extract_json_with_code_block():
    """测试带代码块的 JSON 提取"""
    content = '```json\n{"key": "value"}\n```'
    result = extract_json(content)
    assert result == {"key": "value"}


def test_extract_json_with_none():
    """测试包含 None 的 JSON"""
    content = '{"key": None, "key2": "value2"}'
    result = extract_json(content)
    assert result == {"key": None, "key2": "value2"}


def test_convert_physical_index_to_int_simple():
    """测试 physical_index 转整数"""
    data = [{"physical_index": "<physical_index_5>"}]
    result = convert_physical_index_to_int(data)
    assert result[0]["physical_index"] == 5


def test_convert_physical_index_to_int_nested():
    """测试嵌套数据中的 physical_index 转换"""
    data = [
        {"physical_index": "<physical_index_1>", "title": "Chapter 1"},
        {"physical_index": "physical_index_2", "title": "Chapter 2"},
    ]
    result = convert_physical_index_to_int(data)
    assert result[0]["physical_index"] == 1
    assert result[1]["physical_index"] == 2


def test_convert_page_to_int():
    """测试 page 字符串转整数"""
    data = [
        {"page": "1", "title": "Chapter 1"},
        {"page": "2", "title": "Chapter 2"},
    ]
    result = convert_page_to_int(data)
    assert result[0]["page"] == 1
    assert result[1]["page"] == 2


def test_add_preface_if_needed():
    """测试添加前言节点"""
    data = [
        {"structure": "1", "title": "Chapter 1", "physical_index": 5},
    ]
    result = add_preface_if_needed(data)
    assert len(result) == 2
    assert result[0]["structure"] == "0"
    assert result[0]["title"] == "Preface"


def test_add_preface_not_needed():
    """测试不需要添加前言"""
    data = [
        {"structure": "1", "title": "Chapter 1", "physical_index": 1},
    ]
    result = add_preface_if_needed(data)
    assert len(result) == 1
    assert result[0]["title"] == "Chapter 1"


def test_list_to_tree():
    """测试列表转树结构"""
    data = [
        {
            "structure": "1",
            "title": "Chapter 1",
            "start_index": 1,
            "end_index": 5,
        },
        {
            "structure": "1.1",
            "title": "Section 1.1",
            "start_index": 2,
            "end_index": 4,
        },
        {
            "structure": "2",
            "title": "Chapter 2",
            "start_index": 6,
            "end_index": 10,
        },
    ]
    tree = list_to_tree(data)
    assert len(tree) == 2
    assert tree[0]["title"] == "Chapter 1"
    assert tree[0]["nodes"][0]["title"] == "Section 1.1"
    assert tree[1]["title"] == "Chapter 2"


# ============ 配置加载测试 ============

def test_config_loader_default():
    """测试默认配置加载"""
    loader = ConfigLoader()
    config = loader.load()
    assert hasattr(config, 'model')
    assert hasattr(config, 'toc_check_page_num')
    assert hasattr(config, 'max_page_num_each_node')
    assert hasattr(config, 'max_token_num_each_node')


def test_config_loader_with_user_options():
    """测试用户选项覆盖"""
    loader = ConfigLoader()
    config = loader.load({'model': 'gpt-3.5-turbo', 'max_page_num_each_node': 20})
    assert config.model == 'gpt-3.5-turbo'
    assert config.max_page_num_each_node == 20


# ============ Mock OpenAI API 测试 ============

@patch('pageindex.utils.ChatGPT_API')
def test_chatgpt_api_mock(mock_chatgpt):
    """测试 ChatGPT API mock"""
    mock_chatgpt.return_value = '{"answer": "yes"}'
    from pageindex.utils import ChatGPT_API

    result = ChatGPT_API(model="gpt-4o", prompt="test")
    assert result == '{"answer": "yes"}'
    mock_chatgpt.assert_called_once()


# ============ PDF 处理测试 ============

@patch('pageindex.utils.PyPDF2.PdfReader')
def test_get_page_tokens_mock(mock_pdf_reader):
    """测试获取页面 token（mock 版本）"""
    # 创建 mock 页面对象
    mock_page1 = Mock()
    mock_page1.extract_text.return_value = "Page 1 content"
    mock_page2 = Mock()
    mock_page2.extract_text.return_value = "Page 2 content"

    # 创建 mock reader
    mock_reader_instance = Mock()
    mock_reader_instance.pages = [mock_page1, mock_page2]
    mock_pdf_reader.return_value = mock_reader_instance

    # 调用函数
    result = get_page_tokens("test.pdf", model="gpt-4o", pdf_parser="PyPDF2")

    # 验证结果
    assert len(result) == 2
    assert result[0][0] == "Page 1 content"
    assert result[1][0] == "Page 2 content"
    assert result[0][1] > 0
    assert result[1][1] > 0


# ============ 树处理测试 ============

def test_post_processing():
    """测试后处理功能"""
    structure = [
        {
            "structure": "1",
            "title": "Chapter 1",
            "physical_index": 1,
            "appear_start": "yes",
        },
        {
            "structure": "2",
            "title": "Chapter 2",
            "physical_index": 3,
            "appear_start": "yes",
        },
    ]
    result = post_processing(structure, 5)
    assert isinstance(result, list)
    # 验证 start_index 和 end_index 被正确设置


# ============ 集成测试 ============

@pytest.mark.asyncio
@patch('pageindex.ChatGPT_API_async')
@patch('pageindex.ChatGPT_API_with_finish_reason')
@patch('pageindex.utils.get_page_tokens')
async def test_page_index_flow_mock(mock_get_tokens, mock_chat_with_finish, mock_chat_async):
    """测试完整的 PageIndex 流程（全 mock）"""
    # Mock get_page_tokens
    mock_get_tokens.return_value = [
        ("Table of Contents\nChapter 1\nChapter 2\n", 100),
        ("Chapter 1\nContent here.\n", 200),
        ("Chapter 2\nMore content.\n", 150),
    ]

    # Mock ChatGPT API responses
    mock_chat_with_finish.return_value = ('{"table_of_contents": [{"structure": "1", "title": "Chapter 1", "page": 1}, {"structure": "2", "title": "Chapter 2", "page": 2}]}', "finished")
    mock_chat_async.return_value = '{"answer": "yes"}'

    # 这个测试需要完整的流程 mock，暂时跳过实际调用
    # 因为 page_index 函数需要真实的 PDF 文件或 BytesIO
    # 我们可以在后续完善这个测试


# ============ 运行测试 ============

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
