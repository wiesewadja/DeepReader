"""
EPUB 支持测试
测试 API 对 EPUB 文件的支持
"""

import pytest
from fastapi.testclient import TestClient
from deeppdf.main import app


@pytest.fixture
def client():
    """创建测试客户端"""
    return TestClient(app)


@pytest.fixture
def sample_epub_content():
    """创建示例 EPUB 内容（最小的有效 EPUB 文件）"""
    # 返回一个最小的有效 EPUB 文件内容
    # EPUB 文件实际上是 ZIP 格式，包含特定结构
    import zipfile
    import io

    # 创建 EPUB 文件内容（简化版，仅用于测试扩展名验证）
    # 实际的 EPUB 验证需要更复杂的结构
    return b"PK\x03\x04"  # ZIP 文件头（EPUB 是 ZIP 格式）


class TestEpubFileUpload:
    """测试 EPUB 文件上传功能"""

    def test_upload_epub_success(self, client, sample_epub_content):
        """测试成功上传 EPUB 文件"""
        response = client.post(
            "/api/files",
            files={"file": ("test.epub", sample_epub_content, "application/epub+zip")},
        )
        assert response.status_code == 201
        data = response.json()
        assert "file_id" in data
        assert data["file_name"] == "test.epub"
        assert data["file_size"] == len(sample_epub_content)
        assert data["status"] == "uploaded"
        assert data["indexed"] is False
        assert "uploaded_at" in data

    def test_upload_epub_with_pdf_extension_still_works(
        self, client, sample_pdf_content
    ):
        """测试 PDF 文件上传仍然正常工作"""
        # 确保向后兼容
        pdf_content = b"%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Count 0\n/Kids []\n>>\nendobj\nxref\n0 3\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\ntrailer\n<<\n/Size 3\n/Root 1 0 R\n>>\nstartxref\n110\n%%EOF"
        response = client.post(
            "/api/files",
            files={"file": ("test.pdf", pdf_content, "application/pdf")},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["file_name"] == "test.pdf"


class TestEpubIndexRequest:
    """测试 EPUB 索引请求"""

    def test_index_request_with_epub_path(self, client):
        """测试使用 EPUB 路径创建索引请求"""
        # 测试请求验证允许 .epub 路径
        response = client.post("/api/index", json={"path": "/path/to/document.epub"})
        # 应该返回 400（文件不存在）而不是 422（验证错误）
        # 这证明路径验证通过了
        assert response.status_code == 400
        data = response.json()
        # 错误应该是文件不存在，而不是路径格式错误
        assert "detail" in data
        assert (
            "not found" in data["detail"].lower()
            or "不存在" in data["detail"]
            or "pdf" in data["detail"].lower()
            or "epub" in data["detail"].lower()
        )

    def test_index_request_rejects_invalid_extensions(self, client):
        """测试索引请求拒绝无效的文件扩展名"""
        response = client.post("/api/index", json={"path": "/path/to/document.txt"})
        # 应该返回 422（验证错误）
        assert response.status_code == 422
        data = response.json()
        assert "detail" in data


class TestEpubFileStorage:
    """测试文件存储对 EPUB 的支持"""

    def test_file_storage_accepts_epub(self):
        """测试 FileStorage 类接受 EPUB 文件"""
        from deeppdf.services.file_storage import FileStorage
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            storage = FileStorage(storage_dir=tmpdir)

            # 验证 EPUB 文件
            is_valid, error = storage.validate_file("test.epub", 1024)
            assert is_valid, f"EPUB file should be valid, but got error: {error}"
            assert error is None

    def test_file_storage_accepts_pdf(self):
        """测试 FileStorage 类仍然接受 PDF 文件（向后兼容）"""
        from deeppdf.services.file_storage import FileStorage
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            storage = FileStorage(storage_dir=tmpdir)

            # 验证 PDF 文件
            is_valid, error = storage.validate_file("test.pdf", 1024)
            assert is_valid, f"PDF file should be valid, but got error: {error}"
            assert error is None

    def test_file_storage_rejects_other_extensions(self):
        """测试 FileStorage 类拒绝其他文件类型"""
        from deeppdf.services.file_storage import FileStorage
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            storage = FileStorage(storage_dir=tmpdir)

            # 验证其他文件类型应该失败
            is_valid, error = storage.validate_file("test.txt", 1024)
            assert not is_valid
            assert error is not None
            assert (
                "pdf" in error.lower()
                or "epub" in error.lower()
                or "不支持" in error
                or "invalid" in error.lower()
            )


@pytest.fixture
def sample_pdf_content():
    """创建示例 PDF 内容"""
    return b"%PDF-1.4\n1 0 obj\n<<\n/Type /Catalog\n/Pages 2 0 R\n>>\nendobj\n2 0 obj\n<<\n/Type /Pages\n/Count 0\n/Kids []\n>>\nendobj\nxref\n0 3\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\ntrailer\n<<\n/Size 3\n/Root 1 0 R\n>>\nstartxref\n110\n%%EOF"
