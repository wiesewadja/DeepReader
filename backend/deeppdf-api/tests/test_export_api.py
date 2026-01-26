"""
导出 API 集成测试
通过 FastAPI TestClient 测试完整的导出端点
"""

import pytest
import json
from unittest.mock import patch
from fastapi.testclient import TestClient


@pytest.fixture
def mock_metadata():
    """模拟索引元数据"""
    return {
        "id": "idx_test123",
        "pdf_name": "sample.pdf",
        "pdf_path": "/path/to/sample.pdf",
        "created_at": "2026-01-21 10:00:00",
        "tree_structure": {
            "structure": [
                {"node_id": "node_1", "nodes": [{"node_id": "node_2", "nodes": []}]}
            ]
        },
        "sections": [
            {
                "id": "node_1",
                "text": "Root content",
                "metadata": {
                    "node_name": "Introduction",
                    "section": "1 Introduction",
                    "start_index": 1,
                    "end_index": 5,
                    "level": 1,
                },
            },
            {
                "id": "node_2",
                "text": "Child content",
                "metadata": {
                    "node_name": "1.1 Background",
                    "section": "1.1 Background",
                    "start_index": 6,
                    "end_index": 10,
                    "level": 2,
                },
            },
        ],
    }


@pytest.fixture
def setup_test_env(tmp_path, mock_metadata, monkeypatch):
    """设置测试环境"""
    # 设置环境变量
    monkeypatch.setenv("BASE_DIR", str(tmp_path))

    indexes_dir = tmp_path / "indexes"
    indexes_dir.mkdir()
    metadata_file = indexes_dir / "idx_test123.json"
    with open(metadata_file, "w") as f:
        json.dump(mock_metadata, f)
    return tmp_path


class TestExportApiEndpoint:
    """测试 /export/{index_id} 端点"""

    def test_export_endpoint_exists(self, setup_test_env, monkeypatch):
        """测试导出端点存在并可访问"""
        # 在导入前设置环境变量

        with patch("deeppdf.api.export_handlers.get_pdf_page_count", return_value=100):
            from deeppdf.main import app

            client = TestClient(app)
            response = client.get("/api/export/idx_test123")

            # 端点应该存在
            assert (
                response.status_code == 200
            ), f"Expected 200, got {response.status_code}: {response.text}"

    def test_export_endpoint_returns_all_fields(self, setup_test_env, monkeypatch):
        """测试导出端点返回所有必需字段"""

        with patch("deeppdf.api.export_handlers.get_pdf_page_count", return_value=150):
            from deeppdf.main import app

            client = TestClient(app)
            response = client.get("/api/export/idx_test123")

            assert (
                response.status_code == 200
            ), f"Expected 200, got {response.status_code}: {response.text}"
            data = response.json()

            # 验证所有字段存在
            assert data["status"] == "success"
            assert data["index_id"] == "idx_test123"
            assert data["pdf_name"] == "sample.pdf"
            assert data["total_pages"] == 150
            assert data["created_at"] == "2026-01-21T10:00:00Z"
            assert len(data["nodes"]) == 2

    def test_export_endpoint_404_for_nonexistent(self, tmp_path, monkeypatch):
        """测试导出不存在的索引返回 404"""
        monkeypatch.setenv("BASE_DIR", str(tmp_path))

        from deeppdf.main import app

        client = TestClient(app)
        response = client.get("/api/export/nonexistent")

        assert response.status_code == 404
