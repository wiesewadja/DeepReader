"""
PageIndex 集成测试
测试现有 PageIndex 源码的集成和使用
"""
import pytest
from pathlib import Path
from unittest.mock import patch, Mock
from deeppdf.pageindex.integration import PageIndexWrapper


def test_pageindex_wrapper_init():
    """测试 PageIndex 包装器初始化"""
    wrapper = PageIndexWrapper()
    assert wrapper is not None
    assert hasattr(wrapper, 'config')


def test_pageindex_wrapper_parse_pdf():
    """测试使用 PageIndex 解析 PDF（mock 版本）"""
    wrapper = PageIndexWrapper()
    pdf_path = Path(__file__).parent / "fixtures" / "sample.pdf"

    if not pdf_path.exists():
        pytest.skip("Test PDF not found")

    # Mock the page_index function since it requires LLM API
    with patch('deeppdf.pageindex.integration.page_index') as mock_page_index:
        # Mock 返回值
        mock_page_index.return_value = {
            "doc_name": "sample.pdf",
            "structure": [
                {
                    "title": "Test Document",
                    "start_index": 1,
                    "end_index": 5,
                    "nodes": []
                }
            ]
        }

        result = wrapper.parse_pdf(str(pdf_path))

        assert result is not None
        assert "structure" in result
        assert isinstance(result["structure"], list)


def test_pageindex_wrapper_config():
    """测试配置加载"""
    wrapper = PageIndexWrapper(
        model="gpt-4o",
        max_page_num_each_node=20
    )

    assert wrapper.config.model == "gpt-4o"
    assert wrapper.config.max_page_num_each_node == 20


def test_pageindex_import():
    """测试 PageIndex 模块导入"""
    # 测试可以导入 PageIndex 核心功能
    from pageindex import page_index
    from pageindex.utils import get_page_tokens, get_pdf_name
    from pageindex.page_index_md import md_to_tree

    assert callable(page_index)
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
