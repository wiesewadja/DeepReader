"""
智能检索服务 - 多路召回 + RRF 融合

核心思路：
1. 向量检索 - 语义相似度匹配（召回 RECALL_TOP_K 条）
2. BM25 检索 - 关键词精确匹配（召回 RECALL_TOP_K 条）
3. RRF 融合 - 使用 Reciprocal Rank Fusion 合并排名

RRF 公式：RRF_Score = 1/(k + rank_BM25) + 1/(k + rank_Vector)
- k = 60（业界经验值）
- rank = 各自检索结果中的名次（1, 2, 3...）

优点：无需分数归一化，即插即用，极其稳定。

注意：只返回段落级别的精确匹配。
"""

import hashlib
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# 多路召回配置
RECALL_TOP_K = 20  # 每路召回数量

# RRF 融合参数
RRF_K = 60  # 平滑常数（业界经验值）


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

    # 3. 构建 RRF 排名索引（rank 从 1 开始）
    vector_ranks = {}  # para_id -> rank (1, 2, 3...)
    for rank, para_id in enumerate(vector_by_id.keys(), start=1):
        vector_ranks[para_id] = rank

    bm25_ranks = {}
    for rank, para_id in enumerate(bm25_by_id.keys(), start=1):
        bm25_ranks[para_id] = rank

    # 4. 收集所有唯一的 para_id
    all_para_ids = set(vector_by_id.keys()) | set(bm25_by_id.keys())

    # 5. 计算 RRF 分数
    rrf_scores = {}
    for para_id in all_para_ids:
        # RRF 公式：1/(k + rank_bm25) + 1/(k + rank_vector)
        # 如果某个列表中没有该段落，则该项为 0
        vector_rank = vector_ranks.get(para_id)
        bm25_rank = bm25_ranks.get(para_id)

        rrf_score = 0.0
        if vector_rank is not None:
            rrf_score += 1.0 / (RRF_K + vector_rank)
        if bm25_rank is not None:
            rrf_score += 1.0 / (RRF_K + bm25_rank)

        rrf_scores[para_id] = rrf_score

        # 确定匹配类型
        if vector_rank is not None and bm25_rank is not None:
            match_type = "hybrid"
        elif vector_rank is not None:
            match_type = "vector"
        else:
            match_type = "bm25"

        # 获取文本和元数据（优先使用向量结果，其次 BM25）
        if para_id in vector_by_id:
            source = vector_by_id[para_id]
        else:
            source = bm25_by_id[para_id]

        rrf_scores[para_id] = {
            "rrf_score": rrf_score,
            "match_type": match_type,
            "vector_rank": vector_rank,
            "bm25_rank": bm25_rank,
            "text": source["text"],
            "metadata": source["metadata"],
        }

    logger.info(
        f"[智能检索] RRF 融合: 向量 {len(vector_ranks)} + BM25 {len(bm25_ranks)} = "
        f"合并 {len(all_para_ids)} 个段落"
    )

    if not rrf_scores:
        return {"method": "empty", "results": []}

    # 6. 按 RRF 分数排序
    sorted_para_ids = sorted(
        rrf_scores.keys(),
        key=lambda pid: rrf_scores[pid]["rrf_score"],
        reverse=True
    )

    # 7. 格式化输出并去重
    seen = set()
    top_results = []

    for para_id in sorted_para_ids:
        item = rrf_scores[para_id]
        metadata = item["metadata"]
        parent_node_id = metadata.get("parent_node_id", "")
        block_id = metadata.get("block_id", "")
        result_type = metadata.get("type", "paragraph")

        # 去重 key
        if parent_node_id and block_id:
            key = (parent_node_id, block_id, result_type)
        else:
            key = (hashlib.md5(item["text"][:100].encode("utf-8"), usedforsecurity=False).hexdigest(), result_type)

        if key in seen:
            continue
        seen.add(key)

        top_results.append({
            "text": item["text"],
            "metadata": {
                **metadata,
                "match_type": item["match_type"],
                "rrf_score": item["rrf_score"],
                "vector_rank": item["vector_rank"],
                "bm25_rank": item["bm25_rank"],
            },
            "score": item["rrf_score"],
        })

        if len(top_results) >= max_results:
            break

    # 统计
    paragraph_count = sum(1 for r in top_results if r["metadata"].get("type") == "paragraph")
    section_count = len(top_results) - paragraph_count

    # 统计匹配类型
    hybrid_count = sum(1 for r in top_results if r["metadata"].get("match_type") == "hybrid")
    vector_only_count = sum(1 for r in top_results if r["metadata"].get("match_type") == "vector")
    bm25_only_count = sum(1 for r in top_results if r["metadata"].get("match_type") == "bm25")

    logger.info(
        f"[智能检索] RRF 最终结果: {len(top_results)} 个 "
        f"({section_count} 章节 + {paragraph_count} 段落) | "
        f"匹配类型: hybrid={hybrid_count}, vector={vector_only_count}, bm25={bm25_only_count}"
    )

    # 确定方法名
    if bm25_results and len(bm25_results) > 0:
        method = "hybrid_bm25_vector"
    elif len(vector_by_id) > 0:
        method = "vector_only"
    else:
        method = "bm25_only"

    return {"method": method, "results": top_results}