from pathlib import Path
from typing import Dict, Any, List
from ..storage.chroma_store import ChromaStore


def query_pdf(
    query: str,
    index_id: str,
    storage_dir: str,
    max_results: int = 5
) -> Dict[str, Any]:
    """
    查询已索引的 PDF

    Args:
        query: 查询文本
        index_id: 索引 ID
        storage_dir: 存储目录
        max_results: 最大返回结果数

    Returns:
        查询结果
    """
    if not query or query.strip() == "":
        return {
            "status": "error",
            "error": "Query cannot be empty"
        }

    try:
        # 初始化存储
        storage_dir_path = Path(storage_dir)
        chroma_dir = storage_dir_path / "chroma"

        store = ChromaStore(persist_directory=str(chroma_dir))

        # 检查集合是否存在
        collections = store.list_collections()
        collection_names = [c.name for c in collections]

        if index_id not in collection_names:
            return {
                "status": "error",
                "error": f"Index {index_id} not found"
            }

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
                formatted_results.append({
                    "id": doc_id,
                    "text": results["documents"][0][i] if results["documents"] else "",
                    "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                    "distance": results["distances"][0][i] if "distances" in results and results["distances"] else None
                })

        # 加载索引元数据
        index_metadata = _load_index_metadata(storage_dir_path, index_id)

        return {
            "status": "success",
            "query": query,
            "results": formatted_results,
            "index_info": index_metadata
        }

    except ValueError as e:
        return {
            "status": "error",
            "error": str(e)
        }
    except Exception as e:
        return {
            "status": "error",
            "error": f"Query failed: {str(e)}"
        }


def _load_index_metadata(storage_dir: Path, index_id: str) -> Dict[str, Any]:
    """加载索引元数据"""
    metadata_path = storage_dir / "indexes" / f"{index_id}.json"

    if metadata_path.exists():
        import json
        with open(metadata_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            # 返回基本元数据（包含 pdf_path 用于跳转功能）
            return {
                "pdf_name": data.get("pdf_name", ""),
                "pdf_path": data.get("pdf_path", ""),
                "node_count": data.get("node_count", 0),
                "created_at": data.get("created_at", "")
            }

    return {}
