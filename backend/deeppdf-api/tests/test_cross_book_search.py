"""
跨书籍搜索服务测试
"""

import pytest
from unittest.mock import patch, MagicMock
from deeppdf.services.cross_book_search import cross_book_search, get_all_indexes


class TestCrossBookSearch:
    """跨书籍搜索测试"""

    def test_get_all_indexes_empty_dir(self, tmp_path):
        """测试空目录返回空列表"""
        # 创建临时存储目录（无索引文件）
        storage_dir = tmp_path / "data"
        storage_dir.mkdir()

        indexes = get_all_indexes(str(storage_dir))
        assert indexes == []

    def test_get_all_indexes_with_data(self, tmp_path):
        """测试有索引文件时返回正确列表"""
        # 创建临时索引目录
        storage_dir = tmp_path / "data"
        indexes_dir = storage_dir / "indexes"
        indexes_dir.mkdir(parents=True)

        # 创建测试索引文件
        import json

        index_data = {
            "id": "test_idx_1",
            "pdf_name": "测试书籍",
            "doc_type": "pdf",
            "node_count": 10,
        }
        with open(indexes_dir / "test_idx_1.json", "w", encoding="utf-8") as f:
            json.dump(index_data, f)

        indexes = get_all_indexes(str(storage_dir))

        assert len(indexes) == 1
        assert indexes[0]["id"] == "test_idx_1"
        assert indexes[0]["book_name"] == "测试书籍"

    def test_cross_book_search_empty_query(self, tmp_path):
        """测试空查询返回错误"""
        result = cross_book_search(
            query="",
            storage_dir=str(tmp_path),
        )
        assert result["status"] == "error"
        assert "empty" in result["error"].lower()

    def test_cross_book_search_no_indexes(self, tmp_path):
        """测试无索引时返回空结果"""
        storage_dir = tmp_path / "data"
        storage_dir.mkdir()

        result = cross_book_search(
            query="测试查询",
            storage_dir=str(storage_dir),
        )
        assert result["status"] == "success"
        assert result["results"] == []
        assert result["books_searched"] == 0

    @patch("deeppdf.services.cross_book_search.ChromaStore")
    def test_cross_book_search_with_mock_store(self, mock_store_class, tmp_path):
        """测试带模拟存储的搜索"""
        # 准备测试数据
        storage_dir = tmp_path / "data"
        indexes_dir = storage_dir / "indexes"
        indexes_dir.mkdir(parents=True)

        # 创建索引文件
        import json

        index_data = {
            "id": "test_idx_1",
            "pdf_name": "测试书籍",
            "doc_type": "pdf",
            "node_count": 10,
        }
        with open(indexes_dir / "test_idx_1.json", "w", encoding="utf-8") as f:
            json.dump(index_data, f)

        # 模拟 ChromaStore
        mock_store = MagicMock()
        mock_store.query.return_value = {
            "ids": [["doc1", "doc2"]],
            "documents": [["文档1内容", "文档2内容"]],
            "metadatas": [
                [{"section": "第一章", "page": 1}, {"section": "第二章", "page": 10}]
            ],
            "distances": [[0.1, 0.2]],
        }
        mock_store_class.return_value = mock_store

        # 执行搜索
        result = cross_book_search(query="测试", storage_dir=str(storage_dir), top_k=2)

        assert result["status"] == "success"
        assert result["books_searched"] == 1
        assert result["total_results"] == 2
        assert len(result["results"]) == 2
        assert result["results"][0]["book_name"] == "测试书籍"

    def test_cross_book_search_with_index_ids_filter(self, tmp_path):
        """测试指定索引 ID 过滤"""
        storage_dir = tmp_path / "data"
        indexes_dir = storage_dir / "indexes"
        indexes_dir.mkdir(parents=True)

        # 创建两个索引文件
        import json

        for i in range(2):
            index_data = {
                "id": f"test_idx_{i}",
                "pdf_name": f"书籍{i}",
                "doc_type": "pdf",
                "node_count": 10,
            }
            with open(indexes_dir / f"test_idx_{i}.json", "w", encoding="utf-8") as f:
                json.dump(index_data, f)

        with patch(
            "deeppdf.services.cross_book_search.ChromaStore"
        ) as mock_store_class:
            mock_store = MagicMock()
            mock_store.query.return_value = {
                "ids": [["doc1"]],
                "documents": [["文档内容"]],
                "metadatas": [[{"section": "第一章", "page": 1}]],
                "distances": [[0.1]],
            }
            mock_store_class.return_value = mock_store

            # 只搜索第一个索引
            result = cross_book_search(
                query="测试",
                storage_dir=str(storage_dir),
                index_ids=["test_idx_0"],
                top_k=1,
            )

            assert result["status"] == "success"
            assert result["books_searched"] == 1
            # 只调用了一次 query
            assert mock_store.query.call_count == 1
