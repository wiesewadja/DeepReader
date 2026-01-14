"""
PDF 索引模块测试

测试策略：
1. 测试有 LLM API 时的正常索引流程
2. 测试无 LLM API 时的错误处理
3. 测试各种边界情况
4. 测试环境变量配置
5. 测试新参数（model, llm_provider 等）
"""
import pytest
import tempfile
import os
from pathlib import Path
from unittest.mock import patch, MagicMock
from deeppdf.tools.pdf_indexer import (
    index_pdf,
    LLMRequiredError,
    PDFIndexError,
    _get_env_default,
    _extract_nodes_from_tree
)


# ============================================================================
# 辅助函数测试
# ============================================================================

def test_get_env_default_string():
    """测试环境变量读取（字符串）"""
    assert _get_env_default("NON_EXIST_VAR", "default") == "default"

    with patch.dict(os.environ, {"TEST_VAR": "value"}):
        assert _get_env_default("TEST_VAR", "default") == "value"


def test_get_env_default_bool():
    """测试环境变量读取（布尔）"""
    with patch.dict(os.environ, {"TEST_VAR": "yes"}):
        assert _get_env_default("TEST_VAR", False, bool) is True

    with patch.dict(os.environ, {"TEST_VAR": "no"}):
        assert _get_env_default("TEST_VAR", True, bool) is False

    with patch.dict(os.environ, {"TEST_VAR": "true"}):
        assert _get_env_default("TEST_VAR", False, bool) is True


def test_get_env_default_int():
    """测试环境变量读取（整数）"""
    with patch.dict(os.environ, {"TEST_VAR": "42"}):
        assert _get_env_default("TEST_VAR", 10, int) == 42

    with patch.dict(os.environ, {"TEST_VAR": "invalid"}):
        assert _get_env_default("TEST_VAR", 10, int) == 10


def test_extract_nodes_from_tree():
    """测试从树结构提取节点"""
    # 模拟 PageIndex 返回的树结构
    tree = {
        "title": "第一章",
        "start_index": 1,
        "end_index": 5,
        "node_id": "node_1",
        "summary": "第一章摘要",
        "text": "原始文本",
        "nodes": [
            {
                "title": "1.1 小节",
                "start_index": 2,
                "end_index": 3,
                "node_id": "node_1_1",
                "summary": "小节摘要",
                "nodes": []
            }
        ]
    }

    nodes = _extract_nodes_from_tree(tree)

    assert len(nodes) == 2
    # 优先使用 summary
    assert nodes[0]["text"] == "第一章摘要"
    assert nodes[0]["metadata"]["node_name"] == "第一章"
    assert nodes[0]["metadata"]["start_index"] == 1
    assert nodes[0]["metadata"]["end_index"] == 5
    assert nodes[0]["metadata"]["level"] == 0

    # 第二个节点（子节点）
    assert nodes[1]["text"] == "小节摘要"
    assert nodes[1]["metadata"]["node_name"] == "1.1 小节"
    assert nodes[1]["metadata"]["level"] == 1
    assert "第一章 > 1.1 小节" in nodes[1]["metadata"]["section"]


def test_extract_nodes_without_summary():
    """测试没有 summary 时使用 text"""
    tree = {
        "title": "第一章",
        "start_index": 1,
        "end_index": 5,
        "node_id": "node_1",
        "text": "原始文本内容",
        "nodes": []
    }

    nodes = _extract_nodes_from_tree(tree)

    assert len(nodes) == 1
    # 没有 summary 时应该使用 text
    assert nodes[0]["text"] == "原始文本内容"


def test_extract_nodes_empty_tree():
    """测试空树"""
    nodes = _extract_nodes_from_tree({})
    assert nodes == []

    nodes = _extract_nodes_from_tree(None)
    assert nodes == []


# ============================================================================
# 主函数测试
# ============================================================================

def test_index_pdf_with_llm():
    """测试使用 LLM API 的 PDF 索引（正常流程）"""
    # 支持 DEEPSEEK_API_KEY
    api_key = (
        os.getenv("DEEPSEEK_API_KEY") or
        os.getenv("OPENAI_API_KEY") or
        os.getenv("CHATGPT_API_KEY")
    )
    if not api_key:
        pytest.skip("LLM API key not set")

    with tempfile.TemporaryDirectory() as tmpdir:
        test_pdf = Path(__file__).parent / "fixtures" / "sample.pdf"

        if not test_pdf.exists():
            pytest.skip("Test PDF not found")

        result = index_pdf(
            pdf_path=str(test_pdf),
            storage_dir=tmpdir,
            require_llm=True
        )

        assert result["status"] == "success"
        assert result["indexing_method"] == "pageindex_tree"
        assert result["node_count"] > 0
        assert "index_id" in result
        assert "pdf_name" in result


def test_index_pdf_without_llm_raises_error():
    """测试无 LLM API 时抛出异常"""
    # 临时移除所有 API keys
    original_keys = {
        "DEEPSEEK_API_KEY": os.environ.get("DEEPSEEK_API_KEY"),
        "OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY"),
        "CHATGPT_API_KEY": os.environ.get("CHATGPT_API_KEY"),
    }

    for key in original_keys:
        os.environ.pop(key, None)

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            test_pdf = Path(__file__).parent / "fixtures" / "sample.pdf"

            if not test_pdf.exists():
                pytest.skip("Test PDF not found")

            # 应该抛出 LLMRequiredError
            with pytest.raises(LLMRequiredError) as exc_info:
                index_pdf(
                    pdf_path=str(test_pdf),
                    storage_dir=tmpdir,
                    require_llm=True
                )

            # 验证错误消息
            assert "DEEPSEEK_API_KEY" in str(exc_info.value) or "OPENAI_API_KEY" in str(exc_info.value)
    finally:
        # 恢复原始 API keys
        for key, value in original_keys.items():
            if value:
                os.environ[key] = value


def test_index_pdf_not_found():
    """测试文件不存在的情况"""
    with pytest.raises(FileNotFoundError):
        index_pdf(
            pdf_path="nonexistent.pdf",
            storage_dir="/tmp/test"
        )


def test_index_pdf_too_small():
    """测试文件太小的情况"""
    with tempfile.TemporaryDirectory() as tmpdir:
        # 创建一个小文件
        small_file = Path(tmpdir) / "small.pdf"
        small_file.write_text("x" * 100)  # < 1KB

        result = index_pdf(
            pdf_path=str(small_file),
            storage_dir=tmpdir
        )

        assert result["status"] == "error"
        assert "too small" in result["error"]


def test_index_duplicate_creates_new_id():
    """测试重复索引创建不同的 ID"""
    api_key = (
        os.getenv("DEEPSEEK_API_KEY") or
        os.getenv("OPENAI_API_KEY") or
        os.getenv("CHATGPT_API_KEY")
    )
    if not api_key:
        pytest.skip("LLM API key not set")

    with tempfile.TemporaryDirectory() as tmpdir:
        test_pdf = Path(__file__).parent / "fixtures" / "sample.pdf"

        if not test_pdf.exists():
            pytest.skip("Test PDF not found")

        # 第一次索引
        result1 = index_pdf(
            pdf_path=str(test_pdf),
            storage_dir=tmpdir
        )

        # 第二次索引（基于时间戳，应该创建新的 ID）
        result2 = index_pdf(
            pdf_path=str(test_pdf),
            storage_dir=tmpdir
        )

        assert result1["status"] == "success"
        assert result2["status"] == "success"
        assert result1["index_id"] != result2["index_id"]


def test_index_pdf_with_custom_params():
    """测试自定义参数"""
    api_key = (
        os.getenv("DEEPSEEK_API_KEY") or
        os.getenv("OPENAI_API_KEY") or
        os.getenv("CHATGPT_API_KEY")
    )
    if not api_key:
        pytest.skip("LLM API key not set")

    with tempfile.TemporaryDirectory() as tmpdir:
        test_pdf = Path(__file__).parent / "fixtures" / "sample.pdf"

        if not test_pdf.exists():
            pytest.skip("Test PDF not found")

        # 使用自定义参数
        result = index_pdf(
            pdf_path=str(test_pdf),
            storage_dir=tmpdir,
            require_llm=True,
            model="gpt-4o",
            llm_provider="openai",
            if_add_node_summary="yes",
            if_add_node_text="no",
            toc_check_pages=10
        )

        assert result["status"] == "success"


def test_index_pdf_with_env_vars():
    """测试从环境变量读取配置"""
    api_key = (
        os.getenv("DEEPSEEK_API_KEY") or
        os.getenv("OPENAI_API_KEY") or
        os.getenv("CHATGPT_API_KEY")
    )
    if not api_key:
        pytest.skip("LLM API key not set")

    with tempfile.TemporaryDirectory() as tmpdir:
        test_pdf = Path(__file__).parent / "fixtures" / "sample.pdf"

        if not test_pdf.exists():
            pytest.skip("Test PDF not found")

        # 设置环境变量
        env_vars = {
            "PDF_INDEX_MODEL": "gpt-4o",
            "PDF_INDEX_LLM_PROVIDER": "openai",
            "PDF_INDEX_TOC_CHECK_PAGES": "15",
            "PDF_INDEX_IF_ADD_NODE_SUMMARY": "no",
        }

        with patch.dict(os.environ, env_vars):
            result = index_pdf(
                pdf_path=str(test_pdf),
                storage_dir=tmpdir,
                require_llm=True
            )

        assert result["status"] == "success"


def test_index_pdf_params_override_env_vars():
    """测试参数覆盖环境变量"""
    api_key = (
        os.getenv("DEEPSEEK_API_KEY") or
        os.getenv("OPENAI_API_KEY") or
        os.getenv("CHATGPT_API_KEY")
    )
    if not api_key:
        pytest.skip("LLM API key not set")

    with tempfile.TemporaryDirectory() as tmpdir:
        test_pdf = Path(__file__).parent / "fixtures" / "sample.pdf"

        if not test_pdf.exists():
            pytest.skip("Test PDF not found")

        # 设置环境变量
        env_vars = {
            "PDF_INDEX_MODEL": "gpt-4o",
            "PDF_INDEX_LLM_PROVIDER": "openai",
        }

        with patch.dict(os.environ, env_vars):
            # 使用参数覆盖环境变量
            result = index_pdf(
                pdf_path=str(test_pdf),
                storage_dir=tmpdir,
                require_llm=True,
                model="deepseek-chat",  # 覆盖环境变量
                llm_provider="deepseek"   # 覆盖环境变量
            )

        assert result["status"] == "success"
