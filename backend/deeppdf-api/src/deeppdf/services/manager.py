"""
索引管理服务 - 异步封装
"""
import asyncio
import json
from pathlib import Path
from typing import Dict, Any

# 导入旧的存储模块（暂时使用旧位置）
import sys
sys.path.insert(0, 'deeppdf-api/deeppdf/src')
from deeppdf.storage.chroma_store import ChromaStore


def _list_indexes_sync(storage_dir: str) -> Dict[str, Any]:
    """
    同步列出所有索引函数
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


def _delete_index_sync(index_id: str, storage_dir: str) -> Dict[str, Any]:
    """
    同步删除索引函数
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


async def list_indexes(storage_dir: str) -> Dict[str, Any]:
    """异步列出所有索引"""
    result = await asyncio.to_thread(_list_indexes_sync, storage_dir)
    return result


async def delete_index(index_id: str, storage_dir: str) -> Dict[str, Any]:
    """异步删除索引"""
    result = await asyncio.to_thread(_delete_index_sync, index_id, storage_dir)
    return result
