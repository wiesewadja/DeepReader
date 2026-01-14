import pytest
import tempfile
from deeppdf.tools.index_manager import list_indexes, delete_index


def test_list_indexes_empty():
    """测试列出空索引列表"""
    with tempfile.TemporaryDirectory() as tmpdir:
        result = list_indexes(tmpdir)
        assert result["status"] == "success"
        assert result["indexes"] == []


def test_list_indexes_with_data():
    """测试列出包含索引的列表"""
    with tempfile.TemporaryDirectory() as tmpdir:
        # 创建模拟索引元数据
        from pathlib import Path
        import json

        index_dir = Path(tmpdir) / "indexes"
        index_dir.mkdir(parents=True)

        with open(index_dir / "idx_test1.json", "w") as f:
            json.dump({"id": "idx_test1", "pdf_name": "test1.pdf", "node_count": 10, "created_at": "2026-01-14"}, f)

        result = list_indexes(tmpdir)
        assert result["status"] == "success"
        assert len(result["indexes"]) == 1
        assert result["indexes"][0]["id"] == "idx_test1"


def test_delete_index():
    """测试删除索引"""
    with tempfile.TemporaryDirectory() as tmpdir:
        from pathlib import Path
        import json

        # 创建模拟索引
        index_dir = Path(tmpdir) / "indexes"
        index_dir.mkdir(parents=True)
        chroma_dir = Path(tmpdir) / "chroma"
        chroma_dir.mkdir(parents=True)

        with open(index_dir / "idx_test1.json", "w") as f:
            json.dump({"id": "idx_test1", "pdf_name": "test1.pdf"}, f)

        # 删除索引
        result = delete_index("idx_test1", tmpdir)
        assert result["status"] == "success"

        # 验证文件已删除
        assert not (index_dir / "idx_test1.json").exists()


def test_delete_index_not_found():
    """测试删除不存在的索引"""
    with tempfile.TemporaryDirectory() as tmpdir:
        result = delete_index("nonexistent_index", tmpdir)
        # 删除不存在的索引应该成功（幂等操作）
        assert result["status"] == "success"
