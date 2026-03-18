"""
智能检索服务 - 多路召回 + 加权 RRF 融合

核心思路：
1. 向量检索 - 语义相似度匹配（召回 RECALL_TOP_K 条）
2. BM25 检索 - 关键词精确匹配（召回 RECALL_TOP_K 条）
3. 加权 RRF 融合 - 根据查询类型动态调整权重

加权 RRF 公式：RRF_Score = w_v * 1/(k + rank_Vector) + w_b * 1/(k + rank_BM25)
- k = 60（业界经验值）
- w_v, w_b 根据查询类型动态调整

查询类型权重策略：
- how_to (如何/怎么): 向量权重高，语义理解更重要
- definition (什么是/定义): BM25 权重高，精确匹配更重要
- fact (作者/书名/章节): BM25 权重高，事实查询
- general (通用): 均衡权重

优点：根据查询意图自适应调整，提升检索精准度。

注意：只返回段落级别的精确匹配。
"""

import hashlib
import logging
import re
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger(__name__)

# 多路召回配置
RECALL_TOP_K = 20  # 每路召回数量

# RRF 融合参数
RRF_K = 40  # 平滑常数（降低以增加排名靠前结果的权重）

# 分数融合权重（RRF vs 原始分数）
SCORE_FUSION_WEIGHTS = {
    "how_to": {"rrf": 0.6, "vector_score": 0.4},  # 方法类查询，结合语义分数
    "definition": {"rrf": 0.8, "vector_score": 0.2},
    "fact": {"rrf": 0.9, "vector_score": 0.1},
    "general": {"rrf": 0.7, "vector_score": 0.3},
}

# 查询类型权重配置
QUERY_TYPE_WEIGHTS = {
    "how_to": {"vector": 0.8, "bm25": 0.2},      # 方法类查询，语义优先（提高向量权重）
    "definition": {"vector": 0.4, "bm25": 0.6},  # 定义类查询，关键词优先
    "fact": {"vector": 0.3, "bm25": 0.7},        # 事实类查询，精确匹配优先
    "general": {"vector": 0.5, "bm25": 0.5},     # 通用查询，均衡权重
}


def detect_query_type(query: str) -> str:
    """
    检测查询类型，用于自适应调整检索权重

    Args:
        query: 查询文本

    Returns:
        查询类型: how_to | definition | fact | general
    """
    query = query.strip()

    # 方法类查询：如何、怎么、怎样、方法、技巧、步骤
    how_to_patterns = [
        r"^如何", r"^怎么", r"^怎样", r"的方法", r"的技巧",
        r"如何.*提高", r"如何.*增强", r"如何.*改善", r"如何.*实现",
        r"怎么.*做", r"怎样.*做", r"有什么.*方法", r"有什么.*技巧",
    ]
    for pattern in how_to_patterns:
        if re.search(pattern, query):
            return "how_to"

    # 定义类查询：什么是、定义、含义、意思
    definition_patterns = [
        r"^什么是", r"^何为", r"的定义", r"的含义", r"是什么意思",
        r"指什么", r"是什么概念",
    ]
    for pattern in definition_patterns:
        if re.search(pattern, query):
            return "definition"

    # 事实类查询：作者、书名、章节、时间、地点
    fact_patterns = [
        r"作者是谁", r"谁写的", r"书名", r"章节", r"第.*章",
        r"什么时候", r"哪里", r"多少", r"几个",
    ]
    for pattern in fact_patterns:
        if re.search(pattern, query):
            return "fact"

    # 默认：通用查询
    return "general"


def get_query_weights(query: str) -> Tuple[float, float]:
    """
    根据查询类型获取向量权重和 BM25 权重

    Args:
        query: 查询文本

    Returns:
        (vector_weight, bm25_weight)
    """
    query_type = detect_query_type(query)
    weights = QUERY_TYPE_WEIGHTS.get(query_type, QUERY_TYPE_WEIGHTS["general"])
    return weights["vector"], weights["bm25"]


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

    # 3. 获取查询类型和权重
    query_type = detect_query_type(query)
    vector_weight, bm25_weight = get_query_weights(query)
    logger.info(
        f"[智能检索] 查询类型: {query_type}, 权重: vector={vector_weight}, bm25={bm25_weight}"
    )

    # 4. 构建 RRF 排名索引（rank 从 1 开始）
    vector_ranks = {}  # para_id -> rank (1, 2, 3...)
    for rank, para_id in enumerate(vector_by_id.keys(), start=1):
        vector_ranks[para_id] = rank

    bm25_ranks = {}
    for rank, para_id in enumerate(bm25_by_id.keys(), start=1):
        bm25_ranks[para_id] = rank

    # 5. 收集所有唯一的 para_id
    all_para_ids = set(vector_by_id.keys()) | set(bm25_by_id.keys())

    # 6. 计算加权 RRF 分数 + 向量距离分数融合
    # 获取分数融合权重
    fusion_weights = SCORE_FUSION_WEIGHTS.get(query_type, SCORE_FUSION_WEIGHTS["general"])
    rrf_weight = fusion_weights["rrf"]
    vector_score_weight = fusion_weights["vector_score"]

    # 归一化向量分数（找到最大值用于归一化）
    max_vector_score = 0.0
    for para_id, data in vector_by_id.items():
        vs = data.get("vector_score", 0)
        if vs > max_vector_score:
            max_vector_score = vs

    rrf_scores = {}
    for para_id in all_para_ids:
        # 加权 RRF 公式：w_v * 1/(k + rank_vector) + w_b * 1/(k + rank_bm25)
        vector_rank = vector_ranks.get(para_id)
        bm25_rank = bm25_ranks.get(para_id)

        rrf_score = 0.0
        if vector_rank is not None:
            rrf_score += vector_weight * 1.0 / (RRF_K + vector_rank)
        if bm25_rank is not None:
            rrf_score += bm25_weight * 1.0 / (RRF_K + bm25_rank)

        # 获取向量距离分数（归一化）
        normalized_vector_score = 0.0
        if para_id in vector_by_id:
            raw_vector_score = vector_by_id[para_id].get("vector_score", 0)
            normalized_vector_score = raw_vector_score / max_vector_score if max_vector_score > 0 else 0

        # 最终分数 = RRF权重 * RRF分数 + 向量分数权重 * 归一化向量分数
        final_score = rrf_weight * rrf_score + vector_score_weight * normalized_vector_score

        rrf_scores[para_id] = final_score

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
            "final_score": final_score,
            "vector_score": normalized_vector_score,
            "match_type": match_type,
            "vector_rank": vector_rank,
            "bm25_rank": bm25_rank,
            "text": source["text"],
            "metadata": source["metadata"],
        }

    logger.info(
        f"[智能检索] 分数融合: RRF(w={rrf_weight}) + VectorScore(w={vector_score_weight}) | "
        f"向量 {len(vector_ranks)} + BM25 {len(bm25_ranks)} = 合并 {len(all_para_ids)} 个段落"
    )

    if not rrf_scores:
        return {"method": "empty", "results": []}

    # 7. 按最终分数排序
    sorted_para_ids = sorted(
        rrf_scores.keys(),
        key=lambda pid: rrf_scores[pid]["final_score"],
        reverse=True
    )

    # 8. 格式化输出并去重
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
                "final_score": item["final_score"],
                "vector_score": item["vector_score"],
                "vector_rank": item["vector_rank"],
                "bm25_rank": item["bm25_rank"],
            },
            "score": item["final_score"],
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
        method = "weighted_hybrid"
    elif len(vector_by_id) > 0:
        method = "vector_only"
    else:
        method = "bm25_only"

    return {
        "method": method,
        "results": top_results,
        "query_type": query_type,
        "weights": {"vector": vector_weight, "bm25": bm25_weight},
    }