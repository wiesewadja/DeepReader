"""
Pydantic 模型测试
测试请求/响应模型的数据验证
"""
import pytest
from deeppdf.api.models import (
    IndexRequest, IndexResponse,
    QueryRequest, QueryResponse,
    QueryResultItem,
    ListIndexesResponse, IndexListItem,
    DeleteIndexResponse
)


class TestIndexRequest:
    """测试 IndexRequest 模型"""

    def test_valid_index_request(self):
        """测试有效的索引请求"""
        req = IndexRequest(path="/path/to/file.pdf")
        assert req.path == "/path/to/file.pdf"

    def test_valid_index_request_with_file_id(self):
        """测试使用 file_id 的索引请求"""
        req = IndexRequest(file_id="f_abc123")
        assert req.file_id == "f_abc123"
        assert req.path is None

    def test_index_request_missing_path_and_file_id(self):
        """测试同时缺少 path 和 file_id 字段的请求"""
        # 现在两个都是可选的，所以不会抛出 ValueError
        req = IndexRequest()
        assert req.path is None
        assert req.file_id is None


class TestQueryRequest:
    """测试 QueryRequest 模型"""

    def test_valid_query_request(self):
        """测试有效的查询请求"""
        req = QueryRequest(query="test query", index_id="test-id")
        assert req.query == "test query"
        assert req.index_id == "test-id"

    def test_query_request_missing_fields(self):
        """测试缺少必需字段的请求"""
        with pytest.raises(ValueError):
            QueryRequest(query="test")

        with pytest.raises(ValueError):
            QueryRequest(index_id="test-id")


class TestIndexResponse:
    """测试 IndexResponse 模型"""

    def test_success_response(self):
        """测试成功的响应"""
        resp = IndexResponse(
            status="success",
            index_id="test-id",
            node_count=10,
            pdf_name="test.pdf"
        )
        assert resp.status == "success"
        assert resp.index_id == "test-id"
        assert resp.node_count == 10
        assert resp.pdf_name == "test.pdf"

    def test_error_response(self):
        """测试错误的响应"""
        resp = IndexResponse(
            status="error",
            error="File not found"
        )
        assert resp.status == "error"
        assert resp.error == "File not found"


class TestQueryResponse:
    """测试 QueryResponse 模型"""

    def test_query_response_with_results(self):
        """测试带结果的查询响应"""
        item = QueryResultItem(
            text="Sample text",
            metadata={"page": 1, "section": "Introduction", "start_index": 0}
        )
        resp = QueryResponse(
            status="success",
            results=[item]
        )
        assert resp.status == "success"
        assert len(resp.results) == 1
        assert resp.results[0].text == "Sample text"

    def test_query_response_empty_results(self):
        """测试空结果的查询响应"""
        resp = QueryResponse(
            status="success",
            results=[]
        )
        assert resp.status == "success"
        assert len(resp.results) == 0


class TestListIndexesResponse:
    """测试 ListIndexesResponse 模型"""

    def test_list_indexes_response(self):
        """测试列出索引响应"""
        item = IndexListItem(
            id="test-id",
            pdf_name="test.pdf",
            created_at="2026-01-15T00:00:00",
            node_count=10
        )
        resp = ListIndexesResponse(
            status="success",
            indexes=[item]
        )
        assert resp.status == "success"
        assert len(resp.indexes) == 1
        assert resp.indexes[0].pdf_name == "test.pdf"


class TestDeleteIndexResponse:
    """测试 DeleteIndexResponse 模型"""

    def test_delete_success_response(self):
        """测试成功删除响应"""
        resp = DeleteIndexResponse(
            status="success",
            message="Index deleted"
        )
        assert resp.status == "success"
        assert resp.message == "Index deleted"

    def test_delete_error_response(self):
        """测试删除失败响应"""
        resp = DeleteIndexResponse(
            status="error",
            message="Index not found"
        )
        assert resp.status == "error"
        assert resp.message == "Index not found"
