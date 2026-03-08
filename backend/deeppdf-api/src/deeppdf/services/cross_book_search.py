"""
跨书籍搜索服务

在所有已索引的书籍中搜索相关内容
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from deeppdf.storage.chroma_store import get_chroma_store

logger = logging.getLogger(__name__)


def get_all_indexes(storage_dir: str) -> List[Dict[str, Any]]:
    """
    获取所有已索引的书籍列表

    Args:
        storage_dir: 存储目录路径

    Returns:
        索引列表，每个元素包含 id, book_name, doc_type, markdown_files 等
    """
    storage_path = Path(storage_dir)
    indexes_dir = storage_path / "indexes"

    if not indexes_dir.exists():
        return []

    indexes = []
    for index_file in indexes_dir.glob("*.json"):
        try:
            with open(index_file, "r", encoding="utf-8") as f:
                metadata = json.load(f)
                indexes.append(
                    {
                        "id": metadata.get("id"),
                        "book_name": metadata.get("pdf_name", "Unknown"),
                        "doc_type": metadata.get("doc_type", "pdf"),
                        "node_count": metadata.get("node_count", 0),
                        "markdown_files": metadata.get(
                            "markdown_files", {}
                        ),  # 添加 markdown_files 映射
                    }
                )
        except Exception as e:
            logger.warning(f"读取索引文件失败: {index_file}, 错误: {e}")

    return indexes


def cross_book_search(
    query: str, storage_dir: str, index_ids: Optional[List[str]] = None, top_k: int = 5
) -> Dict[str, Any]:
    """
    在多本书籍中搜索相关内容

    Args:
        query: 搜索关键词
        storage_dir: 存储目录路径
        index_ids: 可选，指定要搜索的索引 ID 列表。不传则搜索全部
        top_k: 每本书返回的结果数量

    Returns:
        {
            "status": "success" | "error",
            "results": [
                {
                    "text": "...",
                    "book_name": "书名",
                    "index_id": "idx_xxx",
                    "section": "章节名",
                    "page": 页码,
                    "obsidian_link": "DeepPDF/书名/章节.md#^page-N"
                }
            ],
            "books_searched": 搜索的书籍数量,
            "total_results": 总结果数量,
            "errors": [{"index_id": "...", "book_name": "...", "error": "..."}] | None
        }
    """
    if not query or query.strip() == "":
        return {"status": "error", "error": "Query cannot be empty"}

    storage_path = Path(storage_dir)
    chroma_dir = storage_path / "chroma"

    # 获取所有索引
    all_indexes = get_all_indexes(storage_dir)

    # 过滤要搜索的索引
    if index_ids:
        target_indexes = [idx for idx in all_indexes if idx["id"] in index_ids]
    else:
        target_indexes = all_indexes

    if not target_indexes:
        return {
            "status": "success",
            "results": [],
            "books_searched": 0,
            "total_results": 0,
        }

    # 初始化 ChromaStore（使用缓存）
    store = get_chroma_store(persist_directory=str(chroma_dir))

    all_results = []
    books_searched = 0
    search_errors = []  # 累积搜索错误

    for idx_info in target_indexes:
        index_id = idx_info["id"]
        book_name = idx_info["book_name"]
        markdown_files = idx_info.get(
            "markdown_files", {}
        )  # 获取 node_id -> 文件路径映射

        try:
            # 在该索引中搜索
            results = store.query(
                collection_name=index_id, query_texts=[query], n_results=top_k
            )

            if results["ids"] and results["ids"][0]:
                books_searched += 1
                for i, doc_id in enumerate(results["ids"][0]):
                    text = results["documents"][0][i] if results["documents"] else ""
                    metadata = (
                        results["metadatas"][0][i] if results["metadatas"] else {}
                    )

                    section = metadata.get("section", "Unknown")
                    page = metadata.get("page", metadata.get("start_index", 0))

                    # 构建 Obsidian 链接
                    # 优先使用 markdown_files 映射获取正确的文件名（带序号前缀）
                    # doc_id 就是 node_id
                    md_file = markdown_files.get(doc_id)

                    if md_file:
                        # 从完整路径中提取文件名（不含扩展名）
                        # 例如: "书名/01-章节名.md" -> "01-章节名"
                        md_basename = Path(md_file).stem  # 去掉 .md
                        # 构建链接: DeepPDF/书名/01-章节名.md#^page-N
                        # 移除常见的文件后缀
                        clean_book_name = (
                            book_name.removesuffix(".pdf")
                            .removesuffix(".PDF")
                            .removesuffix(".epub")
                            .removesuffix(".EPUB")
                        )
                        safe_book_name = clean_book_name.replace("/", "-")
                        obsidian_link = (
                            f"DeepPDF/{safe_book_name}/{md_basename}.md#^page-{page}"
                        )
                    else:
                        # 回退：使用 section 构建链接（可能不带序号）
                        clean_book_name = (
                            book_name.removesuffix(".pdf")
                            .removesuffix(".PDF")
                            .removesuffix(".epub")
                            .removesuffix(".EPUB")
                        )
                        safe_book_name = clean_book_name.replace("/", "-")
                        safe_section = (
                            section.replace("/", "-").replace(">", "-").strip()
                        )
                        obsidian_link = (
                            f"DeepPDF/{safe_book_name}/{safe_section}.md#^page-{page}"
                        )

                    all_results.append(
                        {
                            "text": text,
                            "book_name": book_name,
                            "index_id": index_id,
                            "section": section,
                            "page": page,
                            "obsidian_link": obsidian_link,
                            "distance": (
                                results.get("distances", [[]])[0][i]
                                if results.get("distances")
                                else None
                            ),
                        }
                    )
        except Exception as e:
            logger.warning(f"搜索索引 {index_id} 失败: {e}")
            search_errors.append(
                {"index_id": index_id, "book_name": book_name, "error": str(e)}
            )
            continue

    # 按距离排序，取前 top_k * len(target_indexes) 个结果
    all_results.sort(key=lambda x: x.get("distance", 1) or 1)
    max_results = top_k * len(target_indexes)
    all_results = all_results[:max_results]

    response = {
        "status": "success",
        "results": all_results,
        "books_searched": books_searched,
        "total_results": len(all_results),
    }

    # 如果有错误，添加到响应中
    if search_errors:
        response["errors"] = search_errors

    return response
