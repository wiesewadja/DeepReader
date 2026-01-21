"""
导出处理器测试
测试 export_index_data 函数
"""
import pytest
import json
from pathlib import Path
from unittest.mock import patch, MagicMock
from deeppdf.api.export_handlers import export_index_data


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
                {
                    "node_id": "node_1",
                    "nodes": [
                        {"node_id": "node_2", "nodes": []}
                    ]
                }
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
                    "level": 1
                }
            },
            {
                "id": "node_2",
                "text": "Child content",
                "metadata": {
                    "node_name": "1.1 Background",
                    "section": "1.1 Background",
                    "start_index": 6,
                    "end_index": 10,
                    "level": 2
                }
            }
        ]
    }


@pytest.fixture
def mock_metadata_path(tmp_path, mock_metadata):
    """创建临时元数据文件"""
    indexes_dir = tmp_path / "indexes"
    indexes_dir.mkdir()
    metadata_file = indexes_dir / "idx_test123.json"
    with open(metadata_file, "w") as f:
        json.dump(mock_metadata, f)
    return metadata_file


class TestExportIndexData:
    """测试 export_index_data 函数"""

    @pytest.mark.asyncio
    async def test_export_success_returns_all_fields(self, mock_metadata_path, mock_metadata):
        """测试成功导出返回所有字段"""
        with patch('deeppdf.api.export_handlers.settings') as mock_settings:
            mock_settings.base_dir = str(mock_metadata_path.parent.parent)

            with patch('deeppdf.api.export_handlers.get_pdf_page_count', return_value=100):
                result = await export_index_data("idx_test123")

                assert result["status"] == "success"
                assert result["index_id"] == "idx_test123"
                assert result["pdf_name"] == "sample.pdf"
                assert result["total_pages"] == 100
                assert result["created_at"] == "2026-01-21T10:00:00Z"
                assert len(result["nodes"]) == 2

    @pytest.mark.asyncio
    async def test_export_nodes_have_parent_id(self, mock_metadata_path, mock_metadata):
        """测试导出的节点包含正确的 parent_id"""
        with patch('deeppdf.api.export_handlers.settings') as mock_settings:
            mock_settings.base_dir = str(mock_metadata_path.parent.parent)

            with patch('deeppdf.api.export_handlers.get_pdf_page_count', return_value=100):
                result = await export_index_data("idx_test123")

                nodes = result["nodes"]
                # 根节点 parent_id 为 None
                root_node = next(n for n in nodes if n["node_id"] == "node_1")
                assert root_node["parent_id"] is None

                # 子节点 parent_id 为根节点
                child_node = next(n for n in nodes if n["node_id"] == "node_2")
                assert child_node["parent_id"] == "node_1"

    @pytest.mark.asyncio
    async def test_export_page_range_formatting(self, mock_metadata_path, mock_metadata):
        """测试页码范围格式化"""
        with patch('deeppdf.api.export_handlers.settings') as mock_settings:
            mock_settings.base_dir = str(mock_metadata_path.parent.parent)

            with patch('deeppdf.api.export_handlers.get_pdf_page_count', return_value=100):
                result = await export_index_data("idx_test123")

                nodes = result["nodes"]
                # 不同页码
                node_1 = next(n for n in nodes if n["node_id"] == "node_1")
                assert node_1["page_range"] == "1-5"

                node_2 = next(n for n in nodes if n["node_id"] == "node_2")
                assert node_2["page_range"] == "6-10"

    @pytest.mark.asyncio
    async def test_export_same_page_range(self, tmp_path):
        """测试相同页码的格式化"""
        metadata = {
            "id": "idx_same_page",
            "pdf_name": "single.pdf",
            "pdf_path": "/path/to/single.pdf",
            "created_at": "2026-01-21 10:00:00",
            "tree_structure": {"structure": []},
            "sections": [
                {
                    "id": "node_1",
                    "text": "Single page",
                    "metadata": {
                        "node_name": "Single",
                        "section": "1 Single",
                        "start_index": 5,
                        "end_index": 5,
                        "level": 1
                    }
                }
            ]
        }

        indexes_dir = tmp_path / "indexes"
        indexes_dir.mkdir()
        metadata_file = indexes_dir / "idx_same_page.json"
        with open(metadata_file, "w") as f:
            json.dump(metadata, f)

        with patch('deeppdf.api.export_handlers.settings') as mock_settings:
            mock_settings.base_dir = str(tmp_path)

            with patch('deeppdf.api.export_handlers.get_pdf_page_count', return_value=10):
                result = await export_index_data("idx_same_page")

                assert result["nodes"][0]["page_range"] == "5"

    @pytest.mark.asyncio
    async def test_export_index_not_found(self, tmp_path):
        """测试索引不存在"""
        with patch('deeppdf.api.export_handlers.settings') as mock_settings:
            mock_settings.base_dir = str(tmp_path)

            from fastapi import HTTPException
            with pytest.raises(HTTPException) as exc_info:
                await export_index_data("nonexistent")

            assert exc_info.value.status_code == 404
            assert "not found" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_export_empty_sections(self, tmp_path):
        """测试空 sections 列表"""
        metadata = {
            "id": "idx_empty",
            "pdf_name": "empty.pdf",
            "pdf_path": "/path/to/empty.pdf",
            "created_at": "2026-01-21 10:00:00",
            "tree_structure": {"structure": []},
            "sections": []
        }

        indexes_dir = tmp_path / "indexes"
        indexes_dir.mkdir()
        metadata_file = indexes_dir / "idx_empty.json"
        with open(metadata_file, "w") as f:
            json.dump(metadata, f)

        with patch('deeppdf.api.export_handlers.settings') as mock_settings:
            mock_settings.base_dir = str(tmp_path)

            with patch('deeppdf.api.export_handlers.get_pdf_page_count', return_value=0):
                result = await export_index_data("idx_empty")

                assert result["status"] == "success"
                assert len(result["nodes"]) == 0
                assert result["total_pages"] == 0
