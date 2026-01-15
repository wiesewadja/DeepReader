"""
FastAPI 端点测试
测试所有 API 路由的功能
"""
import pytest
import sys
from pathlib import Path

# 添加 src 目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

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
        """测试缺少 path 字段的请求"""
        response = client.post("/api/index", json={})
        assert response.status_code == 422  # Validation error


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
