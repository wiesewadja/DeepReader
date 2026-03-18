"""
PDF 查询服务 - 异步封装
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

# 导入存储模块
from deeppdf.storage.chroma_store import get_chroma_store

# 导入智能检索
from .smart_search import hybrid_search, RECALL_TOP_K

# 导入 LLM 树搜索
from .llm_tree_search import llm_tree_search, extract_nodes_by_ids, LLMTreeSearchError

# 导入 LLM 客户端
from deeppdf.utils.llm_client import get_llm_client

# 导入缓存工具
from deeppdf.utils.cache import TTLCache

# 导入 BM25 索引
from .bm25_indexer import bm25_search

logger = logging.getLogger(__name__)


# ============================================================
# 相邻段落获取
# ============================================================
def _get_adjacent_paragraphs(
    collection,
    parent_node_id: str,
    current_paragraph_index: int,
) -> Dict[str, Optional[str]]:
    """
    获取相邻段落的文本

    Args:
        collection: ChromaDB collection 对象
        parent_node_id: 父节点 ID（章节）
        current_paragraph_index: 当前段落索引

    Returns:
        {
            "prev_paragraph": "上一段文本或 None",
            "next_paragraph": "下一段文本或 None",
        }
    """
    result = {"prev_paragraph": None, "next_paragraph": None}

    try:
        # 查找前一段：paragraph_index = current - 1
        if current_paragraph_index > 0:
            prev_results = collection.get(
                where={
                    "$and": [
                        {"type": "paragraph"},
                        {"parent_node_id": parent_node_id},
                        {"paragraph_index": current_paragraph_index - 1},
                    ]
                },
                include=["documents"],
                limit=1,
            )
            if prev_results["documents"]:
                result["prev_paragraph"] = prev_results["documents"][0]

        # 查找后一段：paragraph_index = current + 1
        next_results = collection.get(
            where={
                "$and": [
                    {"type": "paragraph"},
                    {"parent_node_id": parent_node_id},
                    {"paragraph_index": current_paragraph_index + 1},
                ]
            },
            include=["documents"],
            limit=1,
        )
        if next_results["documents"]:
            result["next_paragraph"] = next_results["documents"][0]

    except Exception as e:
        logger.warning(f"[相邻段落] 获取失败: {e}")

    return result


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
    query: str,
    index_id: str,
    storage_dir: str,
    max_results: int = 10,
    scope_node_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    同步 PDF 查询函数（在线程池中执行）

    Args:
        query: 查询文本
        index_id: 索引 ID
        storage_dir: 存储目录
        max_results: 最大结果数
        scope_node_ids: 范围锁定的节点 ID 列表（只在这些节点范围内搜索）
    """
    if not query or query.strip() == "":
        return {"status": "error", "error": "Query cannot be empty"}

    logger.info(
        f"[查询] query='{query}', index_id='{index_id}', max_results={max_results}, "
        f"scope_node_ids={scope_node_ids}"
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

        # 获取 collection 对象（用于后续查询相邻段落）
        collection = store.client.get_collection(name=index_id)

        # 构建查询参数 - 多路召回策略
        query_params = {
            "collection_name": index_id,
            "query_texts": [query],
            "n_results": RECALL_TOP_K,  # 多路召回：固定召回 20 条
        }

        # 如果有范围锁定，添加 where 过滤条件
        if scope_node_ids and len(scope_node_ids) > 0:
            # 构建 where 条件：匹配 parent_node_id 在 scope_node_ids 中的段落
            if len(scope_node_ids) == 1:
                query_params["where"] = {"parent_node_id": scope_node_ids[0]}
            else:
                # 多个节点时使用 $or 组合
                query_params["where"] = {
                    "$or": [{"parent_node_id": nid} for nid in scope_node_ids]
                }
            logger.info(f"[查询] 范围锁定: {scope_node_ids}")

        # 执行查询
        results = store.query(**query_params)

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

                formatted_results.append({
                    "text": text,
                    "metadata": {
                        **metadata,
                        # 确保段落相关字段被透传
                        "type": metadata.get("type", "section"),
                        "block_id": metadata.get("block_id"),
                        "full_paragraph": metadata.get("full_paragraph"),
                        "parent_section": metadata.get("parent_section"),
                    },
                })

        logger.info(f"[查询] 向量检索返回 {len(formatted_results)} 个结果")

        # 加载索引元数据（包含 tree_structure）- 使用带缓存的版本
        index_metadata = get_index_metadata(storage_dir_path, index_id)

        # BM25 独立检索 - 多路召回策略
        bm25_results = []
        try:
            bm25_results = bm25_search(
                query=query,
                storage_dir=storage_dir,
                index_id=index_id,
                top_k=RECALL_TOP_K,  # 多路召回：固定召回 20 条
            )
            logger.info(f"[查询] BM25 检索返回 {len(bm25_results)} 个结果")
        except Exception as e:
            logger.warning(f"[查询] BM25 检索失败: {e}")

        # 使用智能检索（合并向量 + BM25 结果）
        logger.info("[智能检索] 启动混合检索...")
        hybrid_result = hybrid_search(
            query=query,
            index_metadata=index_metadata,
            vector_results=formatted_results,
            bm25_results=bm25_results,
            max_results=max_results,
            scope_node_ids=scope_node_ids,
        )

        # 格式化最终结果
        final_results = []
        logger.info("[查询结果] 开始格式化结果，添加 markdown_path")

        for i, item in enumerate(hybrid_result["results"]):
            # 获取 node_id：对于段落使用 parent_node_id，对于章节使用 node_id
            result_type = item["metadata"].get("type", "section")
            if result_type == "paragraph":
                node_id = item["metadata"].get("parent_node_id", "")
            else:
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

            # 构建基础结果
            result_item = {
                "text": item["text"],
                "metadata": {
                    **item["metadata"],
                    # 确保段落相关字段被透传
                    "type": result_type,
                    "node_id": node_id,  # 确保 node_id 被正确返回
                    "block_id": item["metadata"].get("block_id"),
                    "full_paragraph": item["metadata"].get("full_paragraph"),
                    "parent_section": item["metadata"].get("parent_section"),
                    "markdown_path": markdown_path,  # 添加 Markdown 路径
                },
            }

            # 如果是段落类型，获取相邻段落并合并成带上下文的完整文本
            if item["metadata"].get("type") == "paragraph":
                parent_node_id = item["metadata"].get("parent_node_id")
                paragraph_index = item["metadata"].get("paragraph_index")

                if parent_node_id is not None and paragraph_index is not None:
                    adjacent = _get_adjacent_paragraphs(
                        collection=collection,
                        parent_node_id=parent_node_id,
                        current_paragraph_index=paragraph_index,
                    )

                    # 合并上下文：上一段 + 当前段 + 下一段
                    context_parts = []
                    prev_text = adjacent.get("prev_paragraph")
                    next_text = adjacent.get("next_paragraph")
                    current_text = item["text"]

                    if prev_text:
                        context_parts.append(prev_text.strip())
                    context_parts.append(current_text.strip())
                    if next_text:
                        context_parts.append(next_text.strip())

                    # 替换 text 为带上下文的完整文本（用换行分隔）
                    result_item["text"] = "\n\n".join(context_parts)

                    logger.debug(
                        f"[查询结果] 段落上下文合并: prev={bool(prev_text)}, "
                        f"next={bool(next_text)}, 总长度={len(result_item['text'])}"
                    )

            final_results.append(result_item)

        logger.info(f"[查询结果] 格式化完成，返回 {len(final_results)} 个结果")

        return {
            "status": "success",
            "results": final_results,
            "index_info": {
                "pdf_name": index_metadata.get("pdf_name", ""),
                "pdf_path": index_metadata.get("pdf_path", ""),
                "node_count": index_metadata.get("node_count", 0),
                "created_at": index_metadata.get("created_at", ""),
                "doc_description": index_metadata.get("doc_description", ""),  # 全书摘要
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
                "doc_description": data.get("doc_description", ""),  # 全书摘要
            }

    return {}


# 保留旧函数名作为别名（向后兼容）
_load_index_metadata = _load_index_metadata_from_disk


async def query_pdf(
    query: str,
    index_id: str,
    storage_dir: str,
    max_results: int = 10,
    use_llm_tree_search: bool = False,
    scope_node_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    异步 PDF 查询

    支持两种检索模式:
    1. 混合检索（默认）: 向量 + BM25 + 标题匹配
    2. LLM 树搜索: 使用 LLM 推理定位章节

    Args:
        query: 查询文本
        index_id: 索引 ID
        storage_dir: 存储目录
        max_results: 最大结果数
        use_llm_tree_search: 是否使用 LLM 树搜索
        scope_node_ids: 范围锁定的节点 ID 列表（只在这些节点范围内搜索）

    Returns:
        查询结果字典
    """
    storage_dir_path = Path(storage_dir)
    index_metadata = get_index_metadata(storage_dir_path, index_id)
    tree_structure = index_metadata.get("tree_structure", {})

    # LLM 树搜索模式
    if use_llm_tree_search and tree_structure:
        try:
            result = await _query_with_llm_tree_search(
                query=query,
                tree_structure=tree_structure,
                index_metadata=index_metadata,
                max_results=max_results,
                scope_node_ids=scope_node_ids,
            )
            return result
        except LLMTreeSearchError as e:
            # 静默降级到混合检索
            logger.warning(f"[LLM树搜索] 失败，降级到混合检索: {e}")
            fallback_result = await asyncio.to_thread(
                _query_pdf_sync,
                query=query,
                index_id=index_id,
                storage_dir=storage_dir,
                max_results=max_results,
                scope_node_ids=scope_node_ids,
            )
            fallback_result["fallback"] = True
            fallback_result["fallback_reason"] = str(e)
            return fallback_result

    # 默认：混合检索
    return await asyncio.to_thread(
        _query_pdf_sync,
        query=query,
        index_id=index_id,
        storage_dir=storage_dir,
        max_results=max_results,
        scope_node_ids=scope_node_ids,
    )


async def _query_with_llm_tree_search(
    query: str,
    tree_structure: Dict[str, Any],
    index_metadata: Dict[str, Any],
    max_results: int,
    scope_node_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    LLM 树搜索实现

    Args:
        query: 查询文本
        tree_structure: 树结构
        index_metadata: 索引元数据
        max_results: 最大结果数
        scope_node_ids: 范围锁定的节点 ID 列表
    """

    # 1. 获取 LLM 客户端
    try:
        client, model = get_llm_client()
        # 获取客户端配置信息用于日志
        client_base_url = getattr(client, 'base_url', 'unknown')
        logger.info(f"[LLM树搜索] 客户端配置 - 模型: {model}, Base URL: {client_base_url}")
    except ValueError as e:
        logger.error(f"[LLM树搜索] 获取客户端失败: {e}")
        raise LLMTreeSearchError(str(e), "no_api_key")

    # 2. 执行 LLM 树搜索（增加超时到 30s，适应 DeepSeek API 较慢的响应速度）
    search_result = await llm_tree_search(
        query=query,
        tree_structure=tree_structure,
        llm_client=client,
        model=model,
        doc_name=index_metadata.get("pdf_name", ""),
        max_results=max_results,
        timeout=30,  # 从 15s 增加到 30s
        max_retries=2,
    )

    if not search_result.success:
        raise LLMTreeSearchError(search_result.error or "Unknown error", "llm_error")

    # 3. 提取节点内容
    nodes = extract_nodes_by_ids(tree_structure, search_result.node_ids)

    # 4. 格式化返回结果
    results = []
    for node in nodes:
        content = node.get("text") or node.get("summary", "")
        node_id = node.get("node_id")

        # 从索引元数据中查找对应的 Markdown 文件路径
        markdown_path = None
        if "markdown_files" in index_metadata:
            markdown_path = index_metadata["markdown_files"].get(node_id)

        results.append(
            {
                "text": content,
                "metadata": {
                    "section": node.get("path", ""),
                    "node_id": node_id,
                    "node_name": node.get("title"),
                    "page": node.get("start_index"),
                    "start_index": node.get("start_index"),
                    "end_index": node.get("end_index"),
                    "markdown_path": markdown_path,
                },
            }
        )

    return {
        "status": "success",
        "results": results,
        "search_method": "llm_tree_search",
        "thinking": search_result.thinking,
        "index_info": {
            "pdf_name": index_metadata.get("pdf_name", ""),
            "pdf_path": index_metadata.get("pdf_path", ""),
            "node_count": index_metadata.get("node_count", 0),
            "created_at": index_metadata.get("created_at", ""),
            "doc_description": index_metadata.get("doc_description", ""),  # 全书摘要
        },
    }
