import pytest
import tempfile
from pathlib import Path
from deeppdf.tools.pdf_indexer import index_pdf


def test_index_pdf_success():
    """测试成功的 PDF 索引"""
    with tempfile.TemporaryDirectory() as tmpdir:
        # 假设有测试 PDF
        test_pdf = Path(__file__).parent / "fixtures" / "sample.pdf"

        if not test_pdf.exists():
            pytest.skip("Test PDF not found")

        result = index_pdf(
            pdf_path=str(test_pdf),
            storage_dir=tmpdir
        )

        assert result["status"] == "success"
        assert "index_id" in result
        assert "node_count" in result
        assert result["node_count"] > 0


def test_index_pdf_not_found():
    """测试文件不存在的情况"""
    with pytest.raises(FileNotFoundError):
        index_pdf(
            pdf_path="nonexistent.pdf",
            storage_dir="/tmp/test"
        )


def test_index_duplicate():
    """测试重复索引"""
    with tempfile.TemporaryDirectory() as tmpdir:
        test_pdf = Path(__file__).parent / "fixtures" / "sample.pdf"

        if not test_pdf.exists():
            pytest.skip("Test PDF not found")

        # 第一次索引
        result1 = index_pdf(
            pdf_path=str(test_pdf),
            storage_dir=tmpdir
        )

        # 第二次索引（每次创建新的索引 ID，基于时间戳）
        result2 = index_pdf(
            pdf_path=str(test_pdf),
            storage_dir=tmpdir
        )

        # 验证行为：两次索引都成功，但生成不同的 ID
        assert result1["status"] == "success"
        assert result2["status"] == "success"
        # 由于基于时间戳，两次索引的 ID 应该不同
        assert result1["index_id"] != result2["index_id"]
        # 但 PDF 名称应该相同
        assert result1["pdf_name"] == result2["pdf_name"]
