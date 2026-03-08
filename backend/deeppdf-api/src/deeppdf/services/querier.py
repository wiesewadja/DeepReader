"""
PDF 查询服务 - 异步封装
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Dict, Any

# 导入存储模块
from deeppdf.storage.chroma_store import get_chroma_store

# 导入智能检索
from .smart_search import hybrid_search

# 导入缓存工具
from deeppdf.utils.cache import TTLCache

logger = logging.getLogger(__name__)


# ============================================================
# 索引元数据缓存（TTL 5分钟，最多缓存 50 个索引）
# ============================================================
_index_metadata_cache: TTLCache[str, Dict[str, Any]] = TTLCache(
    ttl_seconds=300.0,  # 5 分钟 TTL
    max_size=50,
)


def get_index_metadata(storage_dir: Path, index_id: str) -> Dict[str, Any]:
    """
    获取索引元数据（带缓存）

    使用 TTLCache 缓存索引元数据，避免每次查询都从磁盘读取。

    Args:
        storage_dir: 存储目录
        index_id: 索引 ID

    Returns:
        索引元数据字典
    """
    # 生成缓存键
    cache_key = f"{storage_dir}:{index_id}"

    # 检查缓存
    cached = _index_metadata_cache.get(cache_key)
    if cached is not None:
        logger.debug(f"[元数据缓存] 命中: {index_id}")
        return cached

    # 缓存未命中，从磁盘加载
    logger.debug(f"[元数据缓存] 未命中，从磁盘加载: {index_id}")
    metadata = _load_index_metadata_from_disk(storage_dir, index_id)

    # 存入缓存
    if metadata:
        _index_metadata_cache.set(cache_key, metadata)

    return metadata


def invalidate_index_metadata(storage_dir: Path, index_id: str) -> bool:
    """
    使索引元数据缓存失效

    当索引更新或删除时调用此函数。

    Args:
        storage_dir: 存储目录
        index_id: 索引 ID

    Returns:
        是否成功删除缓存
    """
    cache_key = f"{storage_dir}:{index_id}"
    return _index_metadata_cache.delete(cache_key)


def clear_metadata_cache() -> None:
    """清空所有元数据缓存"""
    _index_metadata_cache.clear()
    logger.info("[元数据缓存] 已清空")


def _query_pdf_sync(
    query: str, index_id: str, storage_dir: str, max_results: int = 10
) -> Dict[str, Any]:
    """
    同步 PDF 查询函数（在线程池中执行）
    """
    if not query or query.strip() == "":
        return {"status": "error", "error": "Query cannot be empty"}

    logger.info(
        f"[查询] query='{query}', index_id='{index_id}', max_results={max_results}"
    )

    try:
        # 初始化存储（使用缓存）
        storage_dir_path = Path(storage_dir)
        chroma_dir = storage_dir_path / "chroma"

        # 使用带缓存的 ChromaStore 获取方法
        store = get_chroma_store(persist_directory=str(chroma_dir))

        # 检查集合是否存在
        collections = store.list_collections()
        collection_names = [c.name for c in collections]

        if index_id not in collection_names:
            logger.error(f"[查询] 索引不存在: {index_id}")
            return {"status": "error", "error": f"Index {index_id} not found"}

        logger.info("[查询] 集合已找到，执行向量检索...")

        # 执行查询
        results = store.query(
            collection_name=index_id, query_texts=[query], n_results=max_results
        )

        # 格式化结果
        formatted_results = []
        if results["ids"] and results["ids"][0]:
            for i, doc_id in enumerate(results["ids"][0]):
                # 获取距离信息
                distances = results.get("distances", [])
                distance = distances[0][i] if distances and distances[0] else None

                metadata = results["metadatas"][0][i] if results["metadatas"] else {}
                # 添加距离到 metadata
                if distance is not None:
                    metadata["distance"] = distance

                text = results["documents"][0][i] if results["documents"] else ""

                logger.debug(
                    f"  结果 {i+1}: distance={distance:.4f}, section={metadata.get('section', 'N/A')}"
                )
                logger.debug(f"    文本预览: {text[:100]}...")

                formatted_results.append({"text": text, "metadata": metadata})

        logger.info(f"[查询] 返回 {len(formatted_results)} 个结果")

        # 加载索引元数据（包含 tree_structure）- 使用带缓存的版本
        index_metadata = get_index_metadata(storage_dir_path, index_id)

        # 使用智能检索
        logger.info("[智能检索] 启动混合检索...")
        hybrid_result = hybrid_search(
            query=query,
            index_metadata=index_metadata,
            vector_results=formatted_results,
            max_results=max_results,
        )

        # 格式化最终结果
        final_results = []
        logger.info("[查询结果] 开始格式化结果，添加 markdown_path")

        for i, item in enumerate(hybrid_result["results"]):
            node_id = item["metadata"].get("node_id", "")
            markdown_path = None

            # 从索引元数据中查找对应的 Markdown 文件路径
            if "markdown_files" in index_metadata:
                markdown_path = index_metadata["markdown_files"].get(node_id)
                # 【关键日志】记录 markdown_path 查找过程
                if markdown_path:
                    logger.info(
                        f"[查询结果] 结果 {i+1}: node_id={node_id} → markdown_path={markdown_path}"
                    )
                else:
                    logger.warning(
                        f"[查询结果] 结果 {i+1}: node_id={node_id} → 未找到 markdown_path 映射"
                    )

            final_results.append(
                {
                    "text": item["text"],
                    "metadata": {
                        **item["metadata"],
                        "markdown_path": markdown_path,  # 添加 Markdown 路径
                    },
                }
            )

        logger.info(f"[查询结果] 格式化完成，返回 {len(final_results)} 个结果")

        return {
            "status": "success",
            "results": final_results,
            "index_info": {
                "pdf_name": index_metadata.get("pdf_name", ""),
                "pdf_path": index_metadata.get("pdf_path", ""),
                "node_count": index_metadata.get("node_count", 0),
                "created_at": index_metadata.get("created_at", ""),
            },
            "search_method": hybrid_result["method"],
        }

    except ValueError as e:
        logger.error(f"[查询] ValueError: {e}")
        return {"status": "error", "error": str(e)}
    except Exception as e:
        logger.error(f"[查询] Exception: {e}")
        return {"status": "error", "error": f"Query failed: {str(e)}"}


def _load_index_metadata_from_disk(storage_dir: Path, index_id: str) -> Dict[str, Any]:
    """
    从磁盘加载索引元数据（包含完整的 tree_structure 和 markdown_files）

    注意：这是内部函数，请使用 get_index_metadata() 获取带缓存的元数据。
    """
    metadata_path = storage_dir / "indexes" / f"{index_id}.json"

    if metadata_path.exists():
        with open(metadata_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            # 返回完整的元数据，包括 tree_structure 和 markdown_files
            return {
                "pdf_name": data.get("pdf_name", ""),
                "pdf_path": data.get("pdf_path", ""),
                "node_count": data.get("node_count", 0),
                "created_at": data.get("created_at", ""),
                "indexing_method": data.get("indexing_method", ""),
                "llm_enabled": data.get("llm_enabled", False),
                "tree_structure": data.get("tree_structure", {}),
                "sections": data.get("sections", []),
                "markdown_files": data.get(
                    "markdown_files", {}
                ),  # 添加 markdown_files 字段
            }

    return {}


# 保留旧函数名作为别名（向后兼容）
_load_index_metadata = _load_index_metadata_from_disk


async def query_pdf(
    query: str, index_id: str, storage_dir: str, max_results: int = 10
) -> Dict[str, Any]:
    """
    异步 PDF 查询

    使用 asyncio.to_thread 处理 I/O 密集型任务
    """
    result = await asyncio.to_thread(
        _query_pdf_sync,
        query=query,
        index_id=index_id,
        storage_dir=storage_dir,
        max_results=max_results,
    )
    return result
