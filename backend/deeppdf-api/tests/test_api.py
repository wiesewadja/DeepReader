"""
FastAPI 端点测试
测试所有 API 路由的功能
"""
import pytest
from fastapi.testclient import TestClient
from deeppdf.main import app


@pytest.fixture
def client():
    """创建测试客户端"""
    return TestClient(app)


class TestRootEndpoints:
    """测试根路径端点"""

    def test_root(self, client):
        """测试根路径返回正确的信息"""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "DeepPDF API"
        assert data["version"] == "1.0.0"
        assert data["docs"] == "/docs"
        assert data["health"] == "/health"

    def test_health_check(self, client):
        """测试健康检查端点"""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["version"] == "1.0.0"


class TestIndexEndpoint:
    """测试 /api/index 端点"""

    def test_index_invalid_path(self, client):
        """测试无效的 PDF 路径"""
        response = client.post("/api/index", json={"path": "/nonexistent/file.pdf"})
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data

    def test_index_missing_path_field(self, client):
        """测试缺少 path 和 file_id 字段的请求"""
        response = client.post("/api/index", json={})
        # 现在返回 400 因为两个都是可选的，但业务逻辑要求至少提供一个
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "file_id" in data["detail"] or "path" in data["detail"]

    def test_index_with_invalid_file_id(self, client):
        """测试使用不存在的 file_id"""
        response = client.post("/api/index", json={"file_id": "nonexistent_file_id"})
        assert response.status_code == 404
        data = response.json()
        assert "detail" in data


class TestQueryEndpoint:
    """测试 /api/query 端点"""

    def test_query_missing_index_id(self, client):
        """测试缺少 index_id 的查询请求"""
        response = client.post("/api/query", json={
            "query": "test query"
        })
        assert response.status_code == 422  # Validation error

    def test_query_missing_query_field(self, client):
        """测试缺少 query 字段的请求"""
        response = client.post("/api/query", json={
            "index_id": "test-id"
        })
        assert response.status_code == 422  # Validation error


class TestListIndexesEndpoint:
    """测试 /api/indexes 端点"""

    def test_list_indexes(self, client):
        """测试列出所有索引"""
        response = client.get("/api/indexes")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "indexes" in data
        assert isinstance(data["indexes"], list)


class TestDeleteIndexEndpoint:
    """测试 /api/indexes/{id} 端点"""

    def test_delete_index(self, client):
        """测试删除索引（使用无效 ID）"""
        response = client.delete("/api/indexes/nonexistent-id")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data


class TestGetIndexStatusEndpoint:
    """测试 GET /api/indexes/{index_id} 端点"""

    def test_get_index_status_not_found(self, client):
        """测试获取不存在的索引状态"""
        response = client.get("/api/indexes/nonexistent-index")
        assert response.status_code == 404
        data = response.json()
        assert "不存在" in data["detail"]


class TestTaskProgressEndpoint:
    """测试 GET /api/tasks/{task_id}/progress 端点"""

    def test_get_task_progress_not_found(self, client):
        """测试获取不存在的任务进度"""
        response = client.get("/api/tasks/nonexistent-task/progress")
        assert response.status_code == 404
        data = response.json()
        assert "不存在" in data["detail"]


class TestCancelTaskEndpoint:
    """测试 DELETE /api/tasks/{task_id} 端点"""

    def test_cancel_task_not_found(self, client):
        """测试取消不存在的任务"""
        response = client.delete("/api/tasks/nonexistent-task")
        assert response.status_code == 404
        data = response.json()
        assert "不存在" in data["detail"]


class TestCors:
    """测试 CORS 配置"""

    def test_cors_headers(self, client):
        """测试 CORS 头是否正确设置"""
        response = client.options("/", headers={
            "Origin": "http://example.com",
            "Access-Control-Request-Method": "GET"
        })
        # 检查 CORS 头是否存在
        assert "access-control-allow-origin" in response.headers


@pytest.mark.asyncio
class TestAPIDocumentation:
    """测试 API 文档端点"""

    def test_swagger_docs(self, client):
        """测试 Swagger UI 文档"""
        response = client.get("/docs")
        assert response.status_code == 200

    def test_redoc_docs(self, client):
        """测试 ReDoc 文档"""
        response = client.get("/redoc")
        assert response.status_code == 200

    def test_openapi_schema(self, client):
        """测试 OpenAPI schema"""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        schema = response.json()
        assert "openapi" in schema
        assert "info" in schema
        assert schema["info"]["title"] == "DeepPDF API"
