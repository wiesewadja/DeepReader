import json
from pathlib import Path
from typing import Dict, Any, List
from ..storage.chroma_store import ChromaStore


def list_indexes(storage_dir: str) -> Dict[str, Any]:
    """
    列出所有索引

    Args:
        storage_dir: 存储目录

    Returns:
        索引列表
    """
    try:
        storage_dir_path = Path(storage_dir)
        index_dir = storage_dir_path / "indexes"

        if not index_dir.exists():
            return {
                "status": "success",
                "indexes": []
            }

        indexes = []
        for metadata_file in index_dir.glob("*.json"):
            try:
                with open(metadata_file, "r", encoding="utf-8") as f:
                    metadata = json.load(f)
                    # 只返回基本元数据，不返回完整的 sections
                    indexes.append({
                        "id": metadata.get("id", ""),
                        "pdf_name": metadata.get("pdf_name", ""),
                        "node_count": metadata.get("node_count", 0),
                        "created_at": metadata.get("created_at", "")
                    })
            except Exception:
                # 跳过损坏的元数据文件
                continue

        return {
            "status": "success",
            "indexes": indexes
        }

    except Exception as e:
        return {
            "status": "error",
            "error": f"Failed to list indexes: {str(e)}"
        }


def delete_index(index_id: str, storage_dir: str) -> Dict[str, Any]:
    """
    删除指定索引

    Args:
        index_id: 索引 ID
        storage_dir: 存储目录

    Returns:
        删除结果
    """
    try:
        storage_dir_path = Path(storage_dir)

        # 1. 删除元数据文件
        metadata_file = storage_dir_path / "indexes" / f"{index_id}.json"
        if metadata_file.exists():
            metadata_file.unlink()

        # 2. 删除 ChromaDB 集合
        chroma_dir = storage_dir_path / "chroma"
        if chroma_dir.exists():
            try:
                store = ChromaStore(persist_directory=str(chroma_dir))
                store.delete_collection(index_id)
            except Exception:
                # 如果集合不存在，继续执行（幂等操作）
                pass

        return {
            "status": "success",
            "message": f"Index {index_id} deleted"
        }

    except Exception as e:
        return {
            "status": "error",
            "error": f"Failed to delete index: {str(e)}"
        }
