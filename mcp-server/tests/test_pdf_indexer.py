"""
PDF 索引模块测试

测试策略：
1. 测试有 LLM API 时的正常索引流程
2. 测试无 LLM API 时的错误处理
3. 测试各种边界情况
"""
import pytest
import tempfile
import os
from pathlib import Path
from deeppdf.tools.pdf_indexer import index_pdf, LLMRequiredError


def test_index_pdf_with_llm():
    """测试使用 LLM API 的 PDF 索引（正常流程）"""
    # 模拟 LLM API key
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("CHATGPT_API_KEY")
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


def test_index_pdf_without_llm_raises_error():
    """测试无 LLM API 时抛出异常"""
    # 临时移除 API key
    original_key = os.environ.get("OPENAI_API_KEY")
    original_chatgpt_key = os.environ.get("CHATGPT_API_KEY")

    os.environ.pop("OPENAI_API_KEY", None)
    os.environ.pop("CHATGPT_API_KEY", None)

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

            assert "LLM API key is required" in str(exc_info.value)
    finally:
        # 恢复原始 API key
        if original_key:
            os.environ["OPENAI_API_KEY"] = original_key
        if original_chatgpt_key:
            os.environ["CHATGPT_API_KEY"] = original_chatgpt_key


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
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("CHATGPT_API_KEY")
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
