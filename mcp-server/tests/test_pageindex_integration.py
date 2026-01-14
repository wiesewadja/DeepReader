"""
PageIndex 直接测试
测试 pageindex 包的核心功能
"""
import pytest
from pathlib import Path


def test_pageindex_import():
    """测试 PageIndex 模块导入"""
    from pageindex import page_index_main
    from pageindex.utils import get_page_tokens, get_pdf_name
    from pageindex.page_index_md import md_to_tree

    assert callable(page_index_main)
    assert callable(get_page_tokens)
    assert callable(get_pdf_name)
    assert callable(md_to_tree)


def test_get_page_tokens():
    """测试获取页面 token"""
    from pageindex.utils import get_page_tokens
    pdf_path = Path(__file__).parent / "fixtures" / "sample.pdf"

    if not pdf_path.exists():
        pytest.skip("Test PDF not found")

    page_tokens = get_page_tokens(str(pdf_path), model="gpt-4o")

    assert isinstance(page_tokens, list)
    assert len(page_tokens) > 0
    # 每个元素是 (text, token_count) 元组
    assert isinstance(page_tokens[0], tuple)
    assert len(page_tokens[0]) == 2


def test_get_pdf_name():
    """测试获取 PDF 名称"""
    from pageindex.utils import get_pdf_name
    pdf_path = Path(__file__).parent / "fixtures" / "sample.pdf"

    if not pdf_path.exists():
        pytest.skip("Test PDF not found")

    name = get_pdf_name(str(pdf_path))
    assert "sample" in name.lower()


def test_config_loader():
    """测试配置加载"""
    from pageindex.utils import ConfigLoader

    loader = ConfigLoader()
    config = loader.load()

    assert hasattr(config, 'model')
    assert hasattr(config, 'max_page_num_each_node')
    assert hasattr(config, 'llm_provider')


def test_llm_provider_factory():
    """测试 LLM Provider 工厂"""
    from pageindex.llm_provider import LLMProviderFactory

    # 测试创建 OpenAI provider
    provider = LLMProviderFactory.create("openai", api_key="test_key")
    assert provider is not None

    # 测试创建 DeepSeek provider
    provider = LLMProviderFactory.create("deepseek", api_key="test_key")
    assert provider is not None


def test_unified_llm():
    """测试 UnifiedLLM"""
    from pageindex.llm_provider import UnifiedLLM, LLMProviderFactory

    provider = LLMProviderFactory.create("openai", api_key="test_key")
    llm = UnifiedLLM(provider=provider, model="gpt-4o", max_retries=1)

    assert hasattr(llm, 'chat')
    assert hasattr(llm, 'chat_async')
