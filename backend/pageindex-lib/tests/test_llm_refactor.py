"""
测试 LLM 重构功能

这个测试模块验证 page_index.py 中所有异步函数使用 UnifiedLLM 客户端的正确性。
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import sys
import os

# 添加 src 目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from pageindex.page_index import (
    toc_detector_single_page,
    check_title_appearance,
    check_title_appearance_in_start,
    check_if_toc_extraction_is_complete,
    check_if_toc_transformation_is_complete,
    extract_toc_content,
    detect_page_index,
    toc_extractor,
    toc_index_extractor,
    toc_transformer,
    check_title_appearance_in_start_concurrent,
    add_page_number_to_toc,
    generate_toc_continue,
    generate_toc_init,
    process_no_toc,
    process_toc_no_page_numbers,
    process_toc_with_page_numbers,
    process_none_page_numbers,
    single_toc_item_index_fixer,
)
from pageindex.llm import UnifiedLLM
from pageindex.llm.providers import LLMProviderFactory


@pytest.fixture
def mock_llm_client():
    """创建一个模拟的 LLM 客户端"""
    client = AsyncMock()
    client.model = "gpt-4"
    client.chat_async = AsyncMock(return_value='{"thinking": "test", "toc_detected": "yes"}')
    client.chat_with_finish_reason_async = AsyncMock(
        return_value=('{"thinking": "test", "toc_detected": "yes"}', "finished")
    )
    return client


@pytest.mark.asyncio
async def test_toc_detector_single_page_with_mock(mock_llm_client):
    """测试 toc_detector_single_page 使用 mock LLM 客户端"""
    # 调用函数
    result = await toc_detector_single_page("test content", llm_client=mock_llm_client)

    # 验证结果
    assert result == "yes"
    mock_llm_client.chat_async.assert_called_once()


@pytest.mark.asyncio
async def test_toc_detector_single_page_raises_error_when_client_is_none():
    """测试当 llm_client 为 None 时抛出 ValueError"""
    with pytest.raises(ValueError, match="llm_client is required"):
        await toc_detector_single_page("test content", llm_client=None)


@pytest.mark.asyncio
async def test_toc_detector_single_page_with_no_response(mock_llm_client):
    """测试 toc_detector_single_page 返回 no 的情况"""
    mock_llm_client.chat_async.return_value = '{"thinking": "test", "toc_detected": "no"}'

    result = await toc_detector_single_page("test content", llm_client=mock_llm_client)

    assert result == "no"


@pytest.mark.asyncio
async def test_check_title_appearance_with_mock(mock_llm_client):
    """测试 check_title_appearance 使用 mock LLM 客户端"""
    item = {
        "title": "Test Section",
        "physical_index": 2,  # 改为有效索引
        "list_index": 0,
    }
    page_list = [("page 1 content", 100), ("page 2 content", 100), ("page 3 content", 100), ("page 4 content", 100), ("page 5 content", 100)]

    mock_llm_client.chat_async.return_value = '{"thinking": "test", "answer": "yes"}'

    result = await check_title_appearance(item, page_list, start_index=1, llm_client=mock_llm_client)

    assert result["answer"] == "yes"
    assert result["title"] == "Test Section"
    assert result["page_number"] == 2


@pytest.mark.asyncio
async def test_check_title_appearance_when_client_is_none():
    """测试 check_title_appearance 当 llm_client 为 None 时抛出 ValueError"""
    item = {"title": "Test", "physical_index": 1}
    page_list = [("content", 100)]

    with pytest.raises(ValueError, match="llm_client is required"):
        await check_title_appearance(item, page_list, llm_client=None)


@pytest.mark.asyncio
async def test_check_title_appearance_in_start_with_mock(mock_llm_client):
    """测试 check_title_appearance_in_start 使用 mock LLM 客户端"""
    mock_llm_client.chat_async.return_value = '{"thinking": "test", "start_begin": "yes"}'

    result = await check_title_appearance_in_start(
        "Test Title", "page content", llm_client=mock_llm_client
    )

    assert result == "yes"


@pytest.mark.asyncio
async def test_check_title_appearance_in_start_when_client_is_none():
    """测试 check_title_appearance_in_start 当 llm_client 为 None 时抛出 ValueError"""
    with pytest.raises(ValueError, match="llm_client is required"):
        await check_title_appearance_in_start("Test Title", "content", llm_client=None)


@pytest.mark.asyncio
async def test_check_if_toc_extraction_is_complete_with_mock(mock_llm_client):
    """测试 check_if_toc_extraction_is_complete 使用 mock LLM 客户端"""
    mock_llm_client.chat_async.return_value = '{"thinking": "test", "completed": "yes"}'

    result = await check_if_toc_extraction_is_complete(
        "document content", "toc content", llm_client=mock_llm_client
    )

    assert result == "yes"


@pytest.mark.asyncio
async def test_check_if_toc_extraction_is_complete_when_client_is_none():
    """测试 check_if_toc_extraction_is_complete 当 llm_client 为 None 时抛出 ValueError"""
    with pytest.raises(ValueError, match="llm_client is required"):
        await check_if_toc_extraction_is_complete("doc", "toc", llm_client=None)


@pytest.mark.asyncio
async def test_check_if_toc_transformation_is_complete_with_mock(mock_llm_client):
    """测试 check_if_toc_transformation_is_complete 使用 mock LLM 客户端"""
    mock_llm_client.chat_async.return_value = '{"thinking": "test", "completed": "yes"}'

    result = await check_if_toc_transformation_is_complete(
        "raw toc", "cleaned toc", llm_client=mock_llm_client
    )

    assert result == "yes"


@pytest.mark.asyncio
async def test_check_if_toc_transformation_is_complete_when_client_is_none():
    """测试 check_if_toc_transformation_is_complete 当 llm_client 为 None 时抛出 ValueError"""
    with pytest.raises(ValueError, match="llm_client is required"):
        await check_if_toc_transformation_is_complete("raw", "cleaned", llm_client=None)


@pytest.mark.asyncio
async def test_detect_page_index_with_mock(mock_llm_client):
    """测试 detect_page_index 使用 mock LLM 客户端"""
    mock_llm_client.chat_async.return_value = (
        '{"thinking": "test", "page_index_given_in_toc": "yes"}'
    )

    result = await detect_page_index("toc content", llm_client=mock_llm_client)

    assert result == "yes"


@pytest.mark.asyncio
async def test_detect_page_index_when_client_is_none():
    """测试 detect_page_index 当 llm_client 为 None 时抛出 ValueError"""
    with pytest.raises(ValueError, match="llm_client is required"):
        await detect_page_index("toc", llm_client=None)


@pytest.mark.asyncio
async def test_toc_extractor_with_mock(mock_llm_client):
    """测试 toc_extractor 使用 mock LLM 客户端"""
    page_list = [("page 1 content", 100), ("page 2 content", 100)]
    toc_page_list = [0, 1]

    mock_llm_client.chat_async.return_value = (
        '{"thinking": "test", "page_index_given_in_toc": "yes"}'
    )

    result = await toc_extractor(page_list, toc_page_list, llm_client=mock_llm_client)

    assert "toc_content" in result
    assert result["page_index_given_in_toc"] == "yes"


@pytest.mark.asyncio
async def test_toc_extractor_when_client_is_none():
    """测试 toc_extractor 当 llm_client 为 None 时抛出 ValueError"""
    with pytest.raises(ValueError, match="llm_client is required"):
        await toc_extractor([("page", 100)], [0], llm_client=None)


@pytest.mark.asyncio
async def test_toc_index_extractor_with_mock(mock_llm_client):
    """测试 toc_index_extractor 使用 mock LLM 客户端"""
    toc = [{"structure": "1", "title": "Chapter 1", "page": 1}]
    content = "document content"

    mock_llm_client.chat_async.return_value = (
        '[{"structure": "1", "title": "Chapter 1", "physical_index": "<physical_index_1>"}]'
    )

    result = await toc_index_extractor(toc, content, llm_client=mock_llm_client)

    assert isinstance(result, list)
    assert len(result) > 0


@pytest.mark.asyncio
async def test_toc_index_extractor_when_client_is_none():
    """测试 toc_index_extractor 当 llm_client 为 None 时抛出 ValueError"""
    with pytest.raises(ValueError, match="llm_client is required"):
        await toc_index_extractor([], "content", llm_client=None)


@pytest.mark.asyncio
async def test_toc_transformer_with_mock(mock_llm_client):
    """测试 toc_transformer 使用 mock LLM 客户端"""
    toc_content = "Table of contents content"

    mock_llm_client.chat_with_finish_reason_async.return_value = (
        '{"table_of_contents": [{"structure": "1", "title": "Chapter 1", "page": 1}]}',
        "finished",
    )
    mock_llm_client.chat_async.return_value = '{"thinking": "test", "completed": "yes"}'

    result = await toc_transformer(toc_content, llm_client=mock_llm_client)

    assert isinstance(result, list)


@pytest.mark.asyncio
async def test_toc_transformer_when_client_is_none():
    """测试 toc_transformer 当 llm_client 为 None 时抛出 ValueError"""
    with pytest.raises(ValueError, match="llm_client is required"):
        await toc_transformer("toc", llm_client=None)


@pytest.mark.asyncio
async def test_add_page_number_to_toc_with_mock(mock_llm_client):
    """测试 add_page_number_to_toc 使用 mock LLM 客户端"""
    part = "document part content"
    structure = [{"structure": "1", "title": "Chapter 1", "page": 1}]

    mock_llm_client.chat_async.return_value = (
        '[{"structure": "1", "title": "Chapter 1", "start": "yes", "physical_index": "<physical_index_1>"}]'
    )

    result = await add_page_number_to_toc(part, structure, llm_client=mock_llm_client)

    assert isinstance(result, list)


@pytest.mark.asyncio
async def test_add_page_number_to_toc_when_client_is_none():
    """测试 add_page_number_to_toc 当 llm_client 为 None 时抛出 ValueError"""
    with pytest.raises(ValueError, match="llm_client is required"):
        await add_page_number_to_toc("part", [], llm_client=None)


@pytest.mark.asyncio
async def test_generate_toc_continue_with_mock(mock_llm_client):
    """测试 generate_toc_continue 使用 mock LLM 客户端"""
    toc_content = [{"structure": "1", "title": "Chapter 1"}]
    part = "document part"

    mock_llm_client.chat_with_finish_reason_async.return_value = (
        '[{"structure": "1.1", "title": "Section 1.1", "physical_index": "<physical_index_2>"}]',
        "finished",
    )

    result = await generate_toc_continue(toc_content, part, llm_client=mock_llm_client)

    assert isinstance(result, list)


@pytest.mark.asyncio
async def test_generate_toc_continue_when_client_is_none():
    """测试 generate_toc_continue 当 llm_client 为 None 时抛出 ValueError"""
    with pytest.raises(ValueError, match="llm_client is required"):
        await generate_toc_continue([], "part", llm_client=None)


@pytest.mark.asyncio
async def test_generate_toc_init_with_mock(mock_llm_client):
    """测试 generate_toc_init 使用 mock LLM 客户端"""
    part = "document content"

    mock_llm_client.chat_with_finish_reason_async.return_value = (
        '[{"structure": "1", "title": "Chapter 1", "physical_index": "<physical_index_1>"}]',
        "finished",
    )

    result = await generate_toc_init(part, llm_client=mock_llm_client)

    assert isinstance(result, list)


@pytest.mark.asyncio
async def test_generate_toc_init_when_client_is_none():
    """测试 generate_toc_init 当 llm_client 为 None 时抛出 ValueError"""
    with pytest.raises(ValueError, match="llm_client is required"):
        await generate_toc_init("part", llm_client=None)


@pytest.mark.asyncio
async def test_single_toc_item_index_fixer_with_mock(mock_llm_client):
    """测试 single_toc_item_index_fixer 使用 mock LLM 客户端"""
    section_title = "Chapter 1"
    content = "document content"

    mock_llm_client.chat_async.return_value = (
        '{"thinking": "test", "physical_index": "<physical_index_5>"}'
    )

    result = await single_toc_item_index_fixer(
        section_title, content, llm_client=mock_llm_client
    )

    assert result == 5


@pytest.mark.asyncio
async def test_single_toc_item_index_fixer_when_client_is_none():
    """测试 single_toc_item_index_fixer 当 llm_client 为 None 时抛出 ValueError"""
    with pytest.raises(ValueError, match="llm_client is required"):
        await single_toc_item_index_fixer("title", "content", llm_client=None)


@pytest.mark.asyncio
async def test_process_none_page_numbers_with_mock(mock_llm_client):
    """测试 process_none_page_numbers 使用 mock LLM 客户端"""
    toc_items = [{"structure": "1", "title": "Chapter 1", "page": 1}]
    page_list = [("page content", 100)]

    mock_llm_client.chat_async.return_value = (
        '[{"structure": "1", "title": "Chapter 1", "start": "yes", "physical_index": "<physical_index_1>"}]'
    )

    result = await process_none_page_numbers(
        toc_items, page_list, start_index=1, llm_client=mock_llm_client
    )

    assert isinstance(result, list)


@pytest.mark.asyncio
async def test_process_none_page_numbers_when_client_is_none():
    """测试 process_none_page_numbers 当 llm_client 为 None 时抛出 ValueError"""
    with pytest.raises(ValueError, match="llm_client is required"):
        await process_none_page_numbers([], [("page", 100)], llm_client=None)


class TestUnifiedLLMIntegration:
    """测试 UnifiedLLM 与实际 LLM 提供者的集成"""

    def test_create_unified_llm_with_openai_provider(self):
        """测试使用 OpenAI provider 创建 UnifiedLLM"""
        provider = LLMProviderFactory.create("openai", api_key="test_key")
        llm_client = UnifiedLLM(provider=provider, model="gpt-4")

        assert llm_client.model == "gpt-4"
        assert llm_client.provider == provider

    def test_create_unified_llm_with_deepseek_provider(self):
        """测试使用 DeepSeek provider 创建 UnifiedLLM"""
        provider = LLMProviderFactory.create(
            "deepseek", api_key="test_key", base_url="https://api.deepseek.com"
        )
        llm_client = UnifiedLLM(provider=provider, model="deepseek-chat")

        assert llm_client.model == "deepseek-chat"
        assert llm_client.provider == provider

    def test_create_unified_llm_with_custom_provider(self):
        """测试使用 Custom provider 创建 UnifiedLLM"""
        provider = LLMProviderFactory.create(
            "custom", base_url="https://custom.api", api_key="test_key"
        )
        llm_client = UnifiedLLM(provider=provider, model="custom-model")

        assert llm_client.model == "custom-model"
        assert llm_client.provider == provider

    def test_unified_llm_chat_async_method_exists(self):
        """测试 UnifiedLLM 具有 chat_async 方法"""
        provider = LLMProviderFactory.create("openai", api_key="test_key")
        llm_client = UnifiedLLM(provider=provider, model="gpt-4")

        assert hasattr(llm_client, "chat_async")
        assert callable(llm_client.chat_async)

    def test_unified_llm_chat_with_finish_reason_async_method_exists(self):
        """测试 UnifiedLLM 具有 chat_with_finish_reason_async 方法"""
        provider = LLMProviderFactory.create("openai", api_key="test_key")
        llm_client = UnifiedLLM(provider=provider, model="gpt-4")

        assert hasattr(llm_client, "chat_with_finish_reason_async")
        assert callable(llm_client.chat_with_finish_reason_async)


class TestAsyncFunctionCorrectness:
    """测试异步函数的正确性"""

    @pytest.mark.asyncio
    async def test_toc_detector_single_page_is_async(self, mock_llm_client):
        """验证 toc_detector_single_page 是异步函数"""
        import asyncio

        result = await toc_detector_single_page("content", llm_client=mock_llm_client)
        assert result == "yes"

    @pytest.mark.asyncio
    async def test_multiple_async_calls_concurrently(self, mock_llm_client):
        """测试可以并发调用多个异步函数"""
        import asyncio

        mock_llm_client.chat_async.return_value = (
            '{"thinking": "test", "toc_detected": "yes"}'
        )

        tasks = [
            toc_detector_single_page(f"content {i}", llm_client=mock_llm_client)
            for i in range(3)
        ]
        results = await asyncio.gather(*tasks)

        assert len(results) == 3
        assert all(r == "yes" for r in results)

    @pytest.mark.asyncio
    async def test_llm_client_reused_across_calls(self, mock_llm_client):
        """测试 LLM 客户端在多次调用中被正确重用"""
        await toc_detector_single_page("content1", llm_client=mock_llm_client)
        await toc_detector_single_page("content2", llm_client=mock_llm_client)

        assert mock_llm_client.chat_async.call_count == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
