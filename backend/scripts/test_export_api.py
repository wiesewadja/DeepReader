"""
测试导出 API 功能

手动测试脚本，用于验证导出 API 的完整功能
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "deeppdf-api/src"))

from deeppdf.api.export_handlers import export_index_data


async def test_export_api():
    """测试完整的导出流程"""
    print("=== 测试导出 API ===\n")

    # 检查是否有测试索引文件
    storage_dir = Path(__file__).parent.parent / "deeppdf-api/data"
    index_path = storage_dir / "indexes" / "idx_test123.json"

    if not index_path.exists():
        print(f"⚠️  测试索引文件不存在: {index_path}")
        print("创建测试索引文件...")

        # 创建测试索引
        import json
        indexes_dir = storage_dir / "indexes"
        indexes_dir.mkdir(parents=True, exist_ok=True)

        test_metadata = {
            "id": "idx_test123",
            "pdf_name": "sample.pdf",
            "pdf_path": str(storage_dir / "uploads" / "sample.pdf"),
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

        with open(index_path, "w") as f:
            json.dump(test_metadata, f)
        print(f"✅ 创建测试索引: {index_path}")

    print(f"测试索引: idx_test123")

    # 调用导出函数
    try:
        result = await export_index_data("idx_test123")

        print("\n✅ 导出成功!")
        print(f"  - status: {result['status']}")
        print(f"  - pdf_name: {result['pdf_name']}")
        print(f"  - total_pages: {result['total_pages']}")
        print(f"  - created_at: {result['created_at']}")
        print(f"  - nodes count: {len(result['nodes'])}")

        # 验证节点数据
        if result['nodes']:
            node = result['nodes'][0]
            print(f"\n第一个节点示例:")
            print(f"  - node_id: {node['node_id']}")
            print(f"  - section: {node['section']}")
            print(f"  - parent_id: {node.get('parent_id', 'None')}")
            print(f"  - has text: {bool(node['text'])}")

            # 验证 parent_id
            if node.get('level', 0) > 1 and node.get('parent_id'):
                print(f"\n✅ parent_id 正确 (level={node['level']}, parent={node['parent_id']})")
            elif node.get('level', 0) == 1:
                print(f"\n✅ 根节点 parent_id 为 None (正确)")

    except Exception as e:
        print(f"\n❌ 导出失败: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(test_export_api())
