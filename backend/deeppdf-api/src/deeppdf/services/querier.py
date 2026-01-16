"""
PDF 查询服务 - 异步封装
"""
import asyncio
import json
import logging
from pathlib import Path
from typing import Dict, Any

# 导入存储模块
from deeppdf.storage.chroma_store import ChromaStore

# 导入智能检索
from .smart_search import hybrid_search

logger = logging.getLogger(__name__)


def _query_pdf_sync(
    query: str,
    index_id: str,
    storage_dir: str,
    max_results: int = 5
) -> Dict[str, Any]:
    """
    同步 PDF 查询函数（在线程池中执行）
    """
    if not query or query.strip() == "":
        return {
            "status": "error",
            "error": "Query cannot be empty"
        }

    logger.info(f"[查询] query='{query}', index_id='{index_id}', max_results={max_results}")

    try:
        # 初始化存储
        storage_dir_path = Path(storage_dir)
        chroma_dir = storage_dir_path / "chroma"

        store = ChromaStore(persist_directory=str(chroma_dir))

        # 检查集合是否存在
        collections = store.list_collections()
        collection_names = [c.name for c in collections]

        if index_id not in collection_names:
            logger.error(f"[查询] 索引不存在: {index_id}")
            return {
                "status": "error",
                "error": f"Index {index_id} not found"
            }

        logger.info(f"[查询] 集合已找到，执行向量检索...")

        # 执行查询
        results = store.query(
            collection_name=index_id,
            query_texts=[query],
            n_results=max_results
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

                logger.debug(f"  结果 {i+1}: distance={distance:.4f}, section={metadata.get('section', 'N/A')}")
                logger.debug(f"    文本预览: {text[:100]}...")

                formatted_results.append({
                    "text": text,
                    "metadata": metadata
                })

        logger.info(f"[查询] 返回 {len(formatted_results)} 个结果")

        # 加载索引元数据（包含 tree_structure）
        index_metadata = _load_index_metadata(storage_dir_path, index_id)

        # 使用智能检索
        logger.info(f"[智能检索] 启动混合检索...")
        hybrid_result = hybrid_search(
            query=query,
            index_metadata=index_metadata,
            vector_results=formatted_results,
            max_results=max_results
        )

        # 格式化最终结果
        final_results = []
        for item in hybrid_result["results"]:
            final_results.append({
                "text": item["text"],
                "metadata": item["metadata"]
            })

        return {
            "status": "success",
            "results": final_results,
            "index_info": {
                "pdf_name": index_metadata.get("pdf_name", ""),
                "pdf_path": index_metadata.get("pdf_path", ""),
                "node_count": index_metadata.get("node_count", 0),
                "created_at": index_metadata.get("created_at", "")
            },
            "search_method": hybrid_result["method"]
        }

    except ValueError as e:
        logger.error(f"[查询] ValueError: {e}")
        return {
            "status": "error",
            "error": str(e)
        }
    except Exception as e:
        logger.error(f"[查询] Exception: {e}")
        return {
            "status": "error",
            "error": f"Query failed: {str(e)}"
        }


def _load_index_metadata(storage_dir: Path, index_id: str) -> Dict[str, Any]:
    """
    加载索引元数据（包含完整的 tree_structure）
    """
    metadata_path = storage_dir / "indexes" / f"{index_id}.json"

    if metadata_path.exists():
        with open(metadata_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            # 返回完整的元数据，包括 tree_structure
            return {
                "pdf_name": data.get("pdf_name", ""),
                "pdf_path": data.get("pdf_path", ""),
                "node_count": data.get("node_count", 0),
                "created_at": data.get("created_at", ""),
                "indexing_method": data.get("indexing_method", ""),
                "llm_enabled": data.get("llm_enabled", False),
                "tree_structure": data.get("tree_structure", {}),
                "sections": data.get("sections", [])
            }

    return {}


async def query_pdf(
    query: str,
    index_id: str,
    storage_dir: str,
    max_results: int = 5
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
        max_results=max_results
    )
    return result
