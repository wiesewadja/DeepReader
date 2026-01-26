"""
导出 API 模型测试
测试 ExportNodeData 和 ExportIndexResponse 模型
"""

from deeppdf.api.export_models import ExportNodeData, ExportIndexResponse


class TestExportNodeData:
    """测试 ExportNodeData 模型"""

    def test_valid_node_without_parent(self):
        """测试不带父节点的有效节点（根节点）"""
        node = ExportNodeData(
            node_id="node_1",
            node_name="Introduction",
            section="1 Introduction",
            page_range="1-5",
            start_index=1,
            end_index=5,
            level=1,
            text="Sample content",
        )
        assert node.node_id == "node_1"
        assert node.parent_id is None  # 根节点默认为 None

    def test_valid_node_with_parent(self):
        """测试带父节点的有效节点（子节点）"""
        node = ExportNodeData(
            node_id="node_2",
            node_name="1.1 Background",
            section="1.1 Background",
            page_range="6-10",
            start_index=6,
            end_index=10,
            level=2,
            text="Child content",
            parent_id="node_1",
        )
        assert node.node_id == "node_2"
        assert node.parent_id == "node_1"

    def test_node_with_string_indexes(self):
        """测试页码为字符串的情况"""
        node = ExportNodeData(
            node_id="node_3",
            node_name="Unknown",
            section="?",
            page_range="?",
            start_index="?",
            end_index="?",
            level=0,
            text="",
        )
        assert node.start_index == "?"
        assert node.end_index == "?"


class TestExportIndexResponse:
    """测试 ExportIndexResponse 模型"""

    def test_valid_response_with_all_fields(self):
        """测试包含所有字段的响应"""
        node = ExportNodeData(
            node_id="node_1",
            node_name="Test",
            section="1 Test",
            page_range="1-5",
            start_index=1,
            end_index=5,
            level=1,
            text="Content",
        )

        resp = ExportIndexResponse(
            status="success",
            index_id="idx_test123",
            pdf_name="sample.pdf",
            total_pages=150,
            created_at="2026-01-21T10:00:00Z",
            nodes=[node],
        )

        assert resp.status == "success"
        assert resp.index_id == "idx_test123"
        assert resp.pdf_name == "sample.pdf"
        assert resp.total_pages == 150
        assert resp.created_at == "2026-01-21T10:00:00Z"
        assert len(resp.nodes) == 1

    def test_response_with_empty_nodes(self):
        """测试空节点列表的响应"""
        resp = ExportIndexResponse(
            status="success",
            index_id="idx_empty",
            pdf_name="empty.pdf",
            total_pages=0,
            created_at="2026-01-21T10:00:00Z",
            nodes=[],
        )
        assert len(resp.nodes) == 0
        assert resp.total_pages == 0

    def test_response_with_multiple_nodes(self):
        """测试多个节点的响应"""
        nodes = [
            ExportNodeData(
                node_id=f"node_{i}",
                node_name=f"Node {i}",
                section=f"{i} Section",
                page_range=f"{i}-{i+2}",
                start_index=i,
                end_index=i + 2,
                level=1,
                text=f"Content {i}",
            )
            for i in range(1, 4)
        ]

        resp = ExportIndexResponse(
            status="success",
            index_id="idx_multi",
            pdf_name="multi.pdf",
            total_pages=10,
            created_at="2026-01-21T10:00:00Z",
            nodes=nodes,
        )

        assert len(resp.nodes) == 3
        assert resp.nodes[0].node_id == "node_1"
        assert resp.nodes[2].node_id == "node_3"
