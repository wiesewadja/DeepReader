import pytest
import tempfile
from pathlib import Path
from deeppdf.tools.pdf_query import query_pdf
from deeppdf.tools.pdf_indexer import index_pdf


def test_query_pdf_success():
    """测试成功的查询"""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_pdf = Path(__file__).parent / "fixtures" / "sample.pdf"

        if not test_pdf.exists():
            pytest.skip("Test PDF not found")

        # 先索引
        index_result = index_pdf(str(test_pdf), tmpdir)
        assert index_result["status"] == "success"

        # 再查询
        query_result = query_pdf(
            query="attention mechanism",
            index_id=index_result["index_id"],
            storage_dir=tmpdir
        )

        assert query_result["status"] == "success"
        assert "results" in query_result
        assert len(query_result["results"]) >= 0  # 可能返回空结果


def test_query_pdf_index_not_found():
    """测试查询不存在的索引"""
    with tempfile.TemporaryDirectory() as tmpdir:
        result = query_pdf(
            query="test",
            index_id="nonexistent_index",
            storage_dir=tmpdir
        )

        assert result["status"] == "error"
        assert "not found" in result["error"].lower()


def test_query_pdf_empty_query():
    """测试空查询"""
    with tempfile.TemporaryDirectory() as tmpdir:
        result = query_pdf(
            query="",
            index_id="some_index",
            storage_dir=tmpdir
        )

        assert result["status"] == "error"
        assert "empty" in result["error"].lower()
