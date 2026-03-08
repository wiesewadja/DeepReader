"""
索引管理服务 - 异步封装
"""

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Dict, Any, List

# 导入存储模块
from deeppdf.storage.chroma_store import get_chroma_store

logger = logging.getLogger(__name__)


def _list_indexes_sync(storage_dir: str) -> Dict[str, Any]:
    """
    同步列出所有索引函数
    """
    try:
        storage_dir_path = Path(storage_dir)
        index_dir = storage_dir_path / "indexes"

        if not index_dir.exists():
            return {"status": "success", "indexes": []}

        indexes = []
        for metadata_file in index_dir.glob("*.json"):
            try:
                with open(metadata_file, "r", encoding="utf-8") as f:
                    metadata = json.load(f)
                    indexes.append(
                        {
                            "id": metadata.get("id", ""),
                            "pdf_name": metadata.get("pdf_name", ""),
                            "node_count": metadata.get("node_count", 0),
                            "created_at": metadata.get("created_at", ""),
                        }
                    )
            except Exception:
                # 跳过损坏的元数据文件
                continue

        return {"status": "success", "indexes": indexes}

    except Exception as e:
        return {"status": "error", "error": f"Failed to list indexes: {str(e)}"}


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
                store = get_chroma_store(persist_directory=str(chroma_dir))
                store.delete_collection(index_id)
            except Exception:
                # 如果集合不存在，继续执行（幂等操作）
                pass

        return {"status": "success", "message": f"Index {index_id} deleted"}

    except Exception as e:
        return {"status": "error", "error": f"Failed to delete index: {str(e)}"}


async def list_indexes(storage_dir: str) -> Dict[str, Any]:
    """异步列出所有索引"""
    result = await asyncio.to_thread(_list_indexes_sync, storage_dir)
    return result


async def delete_index(index_id: str, storage_dir: str) -> Dict[str, Any]:
    """异步删除索引"""
    result = await asyncio.to_thread(_delete_index_sync, index_id, storage_dir)
    return result


def _update_index_metadata_sync(
    index_id: str, storage_dir: str, updates: Dict[str, Any]
) -> Dict[str, Any]:
    """
    同步更新索引元数据
    """
    try:
        storage_dir_path = Path(storage_dir)
        metadata_path = storage_dir_path / "indexes" / f"{index_id}.json"

        if not metadata_path.exists():
            return {"status": "error", "error": f"Index {index_id} not found"}

        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        # 更新字段 (支持字典深度合并)
        for key, value in updates.items():
            if key == "markdown_files" and "markdown_files" in metadata:
                metadata["markdown_files"].update(value)
            else:
                metadata[key] = value

        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

        return {"status": "success"}

    except Exception as e:
        return {"status": "error", "error": str(e)}


async def update_index_metadata(
    index_id: str, storage_dir: str, updates: Dict[str, Any]
) -> Dict[str, Any]:
    """异步更新索引元数据"""
    result = await asyncio.to_thread(
        _update_index_metadata_sync, index_id, storage_dir, updates
    )
    return result


def _load_index_metadata_sync(index_id: str, storage_dir: str) -> Dict[str, Any]:
    """
    同步加载索引元数据

    Args:
        index_id: 索引 ID
        storage_dir: 存储目录

    Returns:
        索引元数据字典
    """
    try:
        storage_dir_path = Path(storage_dir)
        metadata_path = storage_dir_path / "indexes" / f"{index_id}.json"

        if not metadata_path.exists():
            return {"status": "error", "error": f"Index {index_id} not found"}

        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        return {"status": "success", "metadata": metadata}

    except Exception as e:
        return {"status": "error", "error": f"Failed to load metadata: {str(e)}"}


async def load_index_metadata(index_id: str, storage_dir: str) -> Dict[str, Any]:
    """异步加载索引元数据"""
    result = await asyncio.to_thread(_load_index_metadata_sync, index_id, storage_dir)
    return result


def _update_reading_progress_sync(
    index_id: str,
    storage_dir: str,
    pages: List[int],
) -> Dict[str, Any]:
    """
    同步更新阅读进度

    Args:
        index_id: 索引 ID
        storage_dir: 存储目录
        pages: 新增的已阅读页码列表

    Returns:
        包含状态和进度信息的字典
    """
    try:
        storage_dir_path = Path(storage_dir)
        metadata_path = storage_dir_path / "indexes" / f"{index_id}.json"

        if not metadata_path.exists():
            return {"status": "error", "error": f"Index {index_id} not found"}

        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        # 合并已阅读页码（去重并过滤无效值）
        valid_pages = [p for p in pages if p > 0]
        existing_pages = set(metadata.get("read_pages", []))
        existing_pages.update(valid_pages)
        metadata["read_pages"] = sorted(list(existing_pages))

        # 更新最后阅读时间
        metadata["last_read_at"] = time.strftime("%Y-%m-%d %H:%M:%S")

        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

        # 计算进度百分比
        total_pages = metadata.get("total_pages", 0)
        if total_pages > 0:
            progress = round(len(metadata["read_pages"]) / total_pages * 100, 1)
        else:
            progress = 0.0

        logger.info(
            f"[阅读进度] 更新索引 {index_id}: 新增 {len(valid_pages)} 页, "
            f"累计 {len(metadata['read_pages'])} 页, 进度 {progress}%"
        )

        return {
            "status": "success",
            "read_pages": metadata["read_pages"],
            "progress": progress,
        }

    except Exception as e:
        logger.error(f"[阅读进度] 更新失败: {e}")
        return {"status": "error", "error": str(e)}


async def update_reading_progress(
    index_id: str,
    storage_dir: str,
    pages: List[int],
) -> Dict[str, Any]:
    """异步更新阅读进度"""
    result = await asyncio.to_thread(
        _update_reading_progress_sync, index_id, storage_dir, pages
    )
    return result
