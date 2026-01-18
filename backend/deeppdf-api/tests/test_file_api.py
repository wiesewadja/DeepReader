"""
文件管理 API 测试
"""
import os
import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from deeppdf.main import app


@pytest.fixture
def client():
    """创建测试客户端"""
    return TestClient(app)


@pytest.fixture
def sample_pdf_content():
    """创建示例 PDF 内容（简单的 PDF 文件）"""
    # 返回一个最小的有效 PDF 文件内容
    return b"%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Count 0\n/Kids []\n>>\nendobj\nxref\n0 3\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\ntrailer\n<<\n/Size 3\n/Root 1 0 R\n>>\nstartxref\n110\n%%EOF"


class TestFileUpload:
    """测试文件上传功能"""

    def test_upload_pdf_success(self, client, sample_pdf_content):
        """测试成功上传 PDF 文件"""
        response = client.post(
            "/api/files",
            files={"file": ("test.pdf", sample_pdf_content, "application/pdf")}
        )
        assert response.status_code == 201
        data = response.json()
        assert "file_id" in data
        assert data["file_name"] == "test.pdf"
        assert data["file_size"] == len(sample_pdf_content)
        assert data["status"] == "uploaded"
        assert data["indexed"] is False
        assert "uploaded_at" in data

    def test_upload_invalid_file_type(self, client, sample_pdf_content):
        """测试上传非 PDF 文件"""
        response = client.post(
            "/api/files",
            files={"file": ("test.txt", b"not a pdf", "text/plain")}
        )
        assert response.status_code == 400
        assert "pdf" in response.json()["detail"].lower() or "invalid" in response.json()["detail"].lower()

    def test_upload_file_no_pdf_extension(self, client, sample_pdf_content):
        """测试上传没有 .pdf 扩展名的文件"""
        response = client.post(
            "/api/files",
            files={"file": ("document", sample_pdf_content, "application/pdf")}
        )
        assert response.status_code == 400
        assert "PDF" in response.json()["detail"]

    def test_upload_empty_file(self, client):
        """测试上传空文件"""
        response = client.post(
            "/api/files",
            files={"file": ("empty.pdf", b"", "application/pdf")}
        )
        assert response.status_code == 400
        detail = response.json()["detail"]
        # 错误消息可能包含"空"、"empty"等
        assert "empty" in detail.lower() or "空" in detail or "文件" in detail


class TestListFiles:
    """测试文件列表功能"""

    def test_list_files_empty(self, client):
        """测试列出文件（空列表）"""
        # 注意：这个测试可能依赖实际文件系统状态
        response = client.get("/api/files")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "files" in data
        assert isinstance(data["files"], list)

    def test_list_files_with_files(self, client, sample_pdf_content):
        """测试列出文件（有文件）"""
        # 先上传一个文件
        upload_response = client.post(
            "/api/files",
            files={"file": ("test.pdf", sample_pdf_content, "application/pdf")}
        )
        assert upload_response.status_code == 201
        file_id = upload_response.json()["file_id"]

        # 列出文件
        response = client.get("/api/files")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert len(data["files"]) >= 1
        # 检查上传的文件在列表中
        file_ids = [f["file_id"] for f in data["files"]]
        assert file_id in file_ids


class TestGetFileInfo:
    """测试获取文件详情功能"""

    def test_get_file_info_success(self, client, sample_pdf_content):
        """测试成功获取文件详情"""
        # 先上传文件
        upload_response = client.post(
            "/api/files",
            files={"file": ("test.pdf", sample_pdf_content, "application/pdf")}
        )
        file_id = upload_response.json()["file_id"]

        # 获取文件详情
        response = client.get(f"/api/files/{file_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["file"]["file_id"] == file_id
        assert data["file"]["file_name"] == "test.pdf"

    def test_get_file_info_not_found(self, client):
        """测试获取不存在的文件"""
        response = client.get("/api/files/nonexistent_file_id")
        assert response.status_code == 404
        assert "not found" in response.json()["detail"].lower()


class TestDeleteFile:
    """测试删除文件功能"""

    def test_delete_file_success(self, client, sample_pdf_content):
        """测试成功删除文件"""
        # 先上传文件
        upload_response = client.post(
            "/api/files",
            files={"file": ("test.pdf", sample_pdf_content, "application/pdf")}
        )
        file_id = upload_response.json()["file_id"]

        # 删除文件
        response = client.delete(f"/api/files/{file_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert file_id in data["message"]

        # 验证文件已删除
        get_response = client.get(f"/api/files/{file_id}")
        assert get_response.status_code == 404

    def test_delete_file_not_found(self, client):
        """测试删除不存在的文件"""
        response = client.delete("/api/files/nonexistent_file_id")
        assert response.status_code == 404
        detail = response.json()["detail"]
        # 支持中文和英文错误消息
        assert "not found" in detail.lower() or "不存在" in detail


class TestFileModelIndexing:
    """测试文件与索引的关联"""

    def test_file_indexed_field(self, client, sample_pdf_content):
        """测试文件的 indexed 字段"""
        # 上传文件
        upload_response = client.post(
            "/api/files",
            files={"file": ("test.pdf", sample_pdf_content, "application/pdf")}
        )
        assert upload_response.status_code == 201
        data = upload_response.json()
        assert data["indexed"] is False
        # indexes 字段可能不存在或为空列表
        if "indexes" in data:
            assert data["indexes"] == [] or isinstance(data["indexes"], list)
