"""
智能检索服务 - 多路召回 + 重排序

核心思路：
1. 向量检索 - 语义相似度匹配（召回 RECALL_TOP_K 条）
2. BM25 检索 - 关键词精确匹配（召回 RECALL_TOP_K 条）
3. 多路召回合并 - 去重后合并
4. 重排序 - 使用 BGE Reranker 对合并结果精排序

注意：只返回段落级别的精确匹配。
"""

import hashlib
import logging
from typing import Dict, Any, List, Optional

from .reranker import rerank_results

logger = logging.getLogger(__name__)

# 多路召回配置
RECALL_TOP_K = 20  # 每路召回数量
RERANK_TOP_K = 10  # 重排序后返回数量


def hybrid_search(
    query: str,
    index_metadata: Dict[str, Any],
    vector_results: List[Dict[str, Any]],
    bm25_results: Optional[List[Dict[str, Any]]] = None,
    max_results: int = 10,
    scope_node_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    混合检索：合并向量检索和 BM25 检索结果

    Args:
        query: 查询文本
        index_metadata: 索引元数据（包含 tree_structure 用于范围锁定）
        vector_results: 向量搜索结果（段落级别）
        bm25_results: BM25 独立检索结果（段落级别，已带分数）
        max_results: 最大结果数
        scope_node_ids: 范围锁定的节点 ID 列表

    Returns:
        {"method": "hybrid_bm25_vector" | "vector_only" | "bm25_only", "results": [...]}
    """
    tree_structure = index_metadata.get("tree_structure", {})

    # 范围锁定：构建允许的节点 ID 集合
    allowed_node_ids = None
    if scope_node_ids and len(scope_node_ids) > 0:
        allowed_node_ids = set(scope_node_ids)

        def collect_all_child_ids(nodes, target_ids, collected):
            """递归收集目标节点及其所有子节点的 ID"""
            for node in nodes:
                node_id = node.get("node_id")
                if node_id and node_id in target_ids:
                    collected.add(node_id)
                    def add_all_children(n):
                        for child in n.get("nodes", []):
                            child_id = child.get("node_id")
                            if child_id:
                                collected.add(child_id)
                            add_all_children(child)
                    add_all_children(node)
                collect_all_child_ids(node.get("nodes", []), target_ids, collected)

        all_allowed = set()
        collect_all_child_ids(tree_structure.get("structure", []), allowed_node_ids, all_allowed)
        allowed_node_ids = all_allowed
        logger.info(f"[智能检索] 范围锁定: 允许的节点 ID = {allowed_node_ids}")

    # 1. 处理向量结果
    vector_by_id = {}
    for result in vector_results:
        metadata = result.get("metadata", {})
        parent_node_id = metadata.get("parent_node_id", "")
        node_id = metadata.get("node_id", "")

        # 范围锁定过滤
        if allowed_node_ids is not None:
            if parent_node_id not in allowed_node_ids and node_id not in allowed_node_ids:
                continue

        # 计算向量分数
        distance = metadata.get("distance")
        vector_score = 1.0 / (1.0 + distance) if distance is not None else 0.5

        # 使用 block_id 作为唯一标识
        block_id = metadata.get("block_id", "")
        para_id = block_id if block_id else hashlib.md5(
            result.get("text", "")[:100].encode("utf-8"),
            usedforsecurity=False
        ).hexdigest()

        vector_by_id[para_id] = {
            "text": result.get("text", ""),
            "metadata": metadata,
            "vector_score": vector_score,
            "bm25_score": 0.0,
        }

    logger.info(f"[智能检索] 向量结果: {len(vector_results)} -> 过滤后 {len(vector_by_id)}")

    # 2. 处理 BM25 结果
    bm25_by_id = {}
    if bm25_results:
        for result in bm25_results:
            metadata = result.get("metadata", {})
            parent_node_id = metadata.get("parent_node_id", "")

            # 范围锁定过滤
            if allowed_node_ids is not None:
                if parent_node_id not in allowed_node_ids:
                    continue

            block_id = metadata.get("block_id", "")
            para_id = block_id if block_id else result.get("id", "")

            bm25_by_id[para_id] = {
                "text": result.get("text", ""),
                "metadata": metadata,
                "bm25_score": result.get("bm25_score", 0.0),
            }

        logger.info(f"[智能检索] BM25 结果: {len(bm25_results)} -> 过滤后 {len(bm25_by_id)}")

    # 3. 合并结果
    merged = {}

    # 添加向量结果
    for para_id, item in vector_by_id.items():
        merged[para_id] = {
            "text": item["text"],
            "metadata": item["metadata"],
            "vector_score": item["vector_score"],
            "bm25_score": 0.0,
        }

    # 添加/更新 BM25 结果
    for para_id, item in bm25_by_id.items():
        if para_id in merged:
            # 向量也有这个段落，合并分数
            merged[para_id]["bm25_score"] = item["bm25_score"]
        else:
            # 只有 BM25 有这个段落
            merged[para_id] = {
                "text": item["text"],
                "metadata": item["metadata"],
                "vector_score": 0.0,
                "bm25_score": item["bm25_score"],
            }

    logger.info(f"[智能检索] 合并后: {len(merged)} 个段落")

    if not merged:
        return {"method": "empty", "results": []}

    # 4. 计算混合分数
    for para_id, item in merged.items():
        # 混合分数：向量 60% + BM25 40%
        combined_score = item["vector_score"] * 0.6 + item["bm25_score"] * 0.4
        item["combined_score"] = combined_score

        # 确定匹配类型
        if item["vector_score"] > 0 and item["bm25_score"] > 0:
            match_type = "hybrid"
        elif item["vector_score"] > 0:
            match_type = "vector"
        else:
            match_type = "bm25"

        item["match_type"] = match_type

    # 5. 排序
    sorted_results = sorted(
        merged.items(),
        key=lambda x: x[1]["combined_score"],
        reverse=True
    )

    # 6. 格式化输出
    all_results = []
    for para_id, item in sorted_results:
        all_results.append({
            "text": item["text"],
            "metadata": {
                **item["metadata"],
                "match_type": item["match_type"],
                "vector_score": item["vector_score"],
                "bm25_score": item["bm25_score"],
                "combined_score": item["combined_score"],
            },
            "score": item["combined_score"],
        })

    # 7. 去重（按 parent_node_id + block_id）
    seen = set()
    unique_results = []
    for result in all_results:
        metadata = result.get("metadata", {})
        parent_node_id = metadata.get("parent_node_id", "")
        block_id = metadata.get("block_id", "")
        result_type = metadata.get("type", "paragraph")

        if parent_node_id and block_id:
            key = (parent_node_id, block_id, result_type)
        else:
            key = (hashlib.md5(result["text"][:100].encode("utf-8"), usedforsecurity=False).hexdigest(), result_type)

        if key not in seen:
            seen.add(key)
            unique_results.append(result)

    # 8. 重排序（使用 BGE Reranker）
    # 先取合并分数较高的候选结果进行重排序
    candidate_count = min(len(unique_results), RECALL_TOP_K * 2)  # 取较多候选
    candidates = unique_results[:candidate_count]

    if len(candidates) > 0:
        try:
            # 执行重排序
            reranked = rerank_results(
                query=query,
                results=candidates,
                top_k=max_results
            )

            # 更新分数为重排序分数
            top_results = []
            for item in reranked:
                item["metadata"]["rerank_score"] = item.get("score", 0)
                item["metadata"]["match_type"] = "reranked"
                top_results.append(item)

            logger.info(f"[智能检索] 重排序完成: {len(top_results)} 个结果")

        except Exception as e:
            logger.warning(f"[智能检索] 重排序失败，使用混合分数: {e}")
            top_results = unique_results[:max_results]
    else:
        top_results = []

    # 统计
    paragraph_count = sum(1 for r in top_results if r["metadata"].get("type") == "paragraph")
    section_count = len(top_results) - paragraph_count

    # 统计匹配类型
    hybrid_count = sum(1 for r in top_results if r["metadata"].get("match_type") in ("hybrid", "reranked"))
    vector_only_count = sum(1 for r in top_results if r["metadata"].get("match_type") == "vector")
    bm25_only_count = sum(1 for r in top_results if r["metadata"].get("match_type") == "bm25")

    logger.info(
        f"[智能检索] 最终结果: {len(top_results)} 个 "
        f"({section_count} 章节 + {paragraph_count} 段落) | "
        f"匹配类型: hybrid/reranked={hybrid_count}, vector={vector_only_count}, bm25={bm25_only_count}"
    )

    # 确定方法名
    if bm25_results and len(bm25_results) > 0:
        method = "hybrid_bm25_vector"
    elif len(vector_by_id) > 0:
        method = "vector_only"
    else:
        method = "bm25_only"

    return {"method": method, "results": top_results}