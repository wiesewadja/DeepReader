"""
智能检索服务 - 利用 PageIndex 树状结构和 LLM 推理结果

核心思路：
1. 章节标题匹配 - 在树状结构的标题中精确匹配
2. 父子节点扩展 - 找到子节点后返回父节点和兄弟节点
3. 关键点提取 - 利用 LLM 生成的摘要要点
4. 混合评分 - 结合标题匹配、关键点匹配和向量相似度
"""
import json
import logging
import re
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)


class TreeSearchEngine:
    """树状结构搜索引擎"""

    def __init__(self, tree_structure: Dict[str, Any]):
        """
        初始化搜索引擎

        Args:
            tree_structure: PageIndex 生成的树状结构
        """
        self.tree = tree_structure
        self.structure = tree_structure.get("structure", [])
        # 构建标题索引
        self._build_title_index()
        # 构建关键点索引
        self._build_key_points_index()

    def _build_title_index(self):
        """构建章节标题索引，用于快速查找"""
        self.title_index = {}  # {标题: [节点列表]}

        def traverse(nodes, parent_path=""):
            for node in nodes:
                title = node.get("title", "")
                if title:
                    full_path = f"{parent_path} > {title}" if parent_path else title
                    if title not in self.title_index:
                        self.title_index[title] = []
                    self.title_index[title].append({
                        "node": node,
                        "path": full_path
                    })

                # 递归处理子节点
                children = node.get("nodes", [])
                if children:
                    traverse(children, full_path)

        traverse(self.structure)

    def _build_key_points_index(self):
        """构建关键点索引，从 LLM 摘要中提取"""
        self.key_points_index = []  # [(关键点, 节点), ...]

        def extract_key_points(summary: str) -> List[str]:
            """从摘要中提取关键点"""
            points = []
            # 匹配 "1. **Title**: content" 或 "1. Title: content" 格式
            patterns = [
                r'\d+\.\s*\*\*([^*]+)\*\*:\s*([^\n]+)',  # **Title**: content
                r'\d+\.\s*([^:\n]+):\s*([^\n]+)',          # Title: content
                r'^[\-\*]\s+\*\*([^*]+)\*\*:\s*([^\n]+)', # - **Title**: content
            ]

            for pattern in patterns:
                matches = re.findall(pattern, summary, re.MULTILINE)
                for match in matches:
                    if isinstance(match, tuple):
                        title = match[0].strip()
                        content = match[1].strip() if len(match) > 1 else ""
                        points.append(f"{title}: {content}")
                    else:
                        points.append(match.strip())

            return points

        def traverse(nodes):
            for node in nodes:
                summary = node.get("summary", "")
                if summary:
                    points = extract_key_points(summary)
                    for point in points:
                        self.key_points_index.append({
                            "point": point,
                            "node": node
                        })

                children = node.get("nodes", [])
                if children:
                    traverse(children)

        traverse(self.structure)

    def search_by_title(self, query: str, threshold: float = 0.6) -> List[Dict[str, Any]]:
        """
        在章节标题中搜索

        Args:
            query: 查询文本
            threshold: 相似度阈值 (0-1)

        Returns:
            匹配的节点列表，按相似度排序
        """
        results = []

        for title, nodes in self.title_index.items():
            # 计算标题与查询的相似度
            similarity = SequenceMatcher(None, title.lower(), query.lower()).ratio()

            # 检查是否包含查询词
            contains = query.lower() in title.lower()

            if contains or similarity >= threshold:
                for item in nodes:
                    results.append({
                        "node": item["node"],
                        "path": item["path"],
                        "score": 1.0 if contains else similarity,
                        "match_type": "title_exact" if contains else "title_fuzzy"
                    })

        # 按分数排序
        results.sort(key=lambda x: x["score"], reverse=True)
        return results

    def search_by_key_points(self, query: str, threshold: float = 0.5) -> List[Dict[str, Any]]:
        """
        在 LLM 生成的关键点中搜索

        Args:
            query: 查询文本
            threshold: 相似度阈值

        Returns:
            匹配的节点列表
        """
        results = []
        query_lower = query.lower()

        for item in self.key_points_index:
            point = item["point"]
            node = item["node"]

            # 检查是否包含查询词
            if query_lower in point.lower():
                # 计算相似度
                similarity = SequenceMatcher(None, point.lower(), query_lower).ratio()
                results.append({
                    "node": node,
                    "matched_point": point,
                    "score": similarity,
                    "match_type": "key_point"
                })

        # 按分数排序
        results.sort(key=lambda x: x["score"], reverse=True)
        return results

    def get_node_context(self, node: Dict[str, Any], context_type: str = "parent_siblings") -> List[Dict[str, Any]]:
        """
        获取节点的上下文（父节点和兄弟节点）

        Args:
            node: 目标节点
            context_type: 上下文类型
                - "parent": 只返回父节点
                - "siblings": 只返回兄弟节点
                - "parent_siblings": 返回父节点和兄弟节点（默认）
                - "children": 返回子节点

        Returns:
            上下文节点列表
        """
        context = []

        def find_and_collect(nodes, target_node_id, parent=None, siblings=None):
            """递归查找节点并收集上下文"""
            if siblings is None:
                siblings = []

            for i, current_node in enumerate(nodes):
                current_id = current_node.get("node_id", "")

                # 找到目标节点
                if current_id == target_node.get("node_id"):
                    # 添加父节点
                    if context_type in ["parent", "parent_siblings"] and parent:
                        context.append({
                            "node": parent,
                            "relation": "parent"
                        })

                    # 添加兄弟节点
                    if context_type in ["siblings", "parent_siblings"]:
                        for sibling in siblings:
                            if sibling.get("node_id") != current_id:
                                context.append({
                                    "node": sibling,
                                    "relation": "sibling"
                                })

                    # 添加子节点
                    if context_type == "children":
                        children = current_node.get("nodes", [])
                        for child in children:
                            context.append({
                                "node": child,
                                "relation": "child"
                            })

                    return True

                # 递归搜索
                children = current_node.get("nodes", [])
                if children:
                    if find_and_collect(children, target_node, current_node, nodes):
                        return True

            return False

        # 从根节点开始搜索
        find_and_collect(self.structure, node)
        return context


def hybrid_search(
    query: str,
    index_metadata: Dict[str, Any],
    vector_results: List[Dict[str, Any]],
    max_results: int = 5
) -> Dict[str, Any]:
    """
    混合检索：结合树状结构搜索和向量搜索

    Args:
        query: 用户查询
        index_metadata: 索引元数据（包含 tree_structure）
        vector_results: 向量搜索结果
        max_results: 最大返回结果数

    Returns:
        混合检索结果
    """
    tree_structure = index_metadata.get("tree_structure", {})
    if not tree_structure:
        # 如果没有树状结构，直接返回向量结果
        return {
            "method": "vector_only",
            "results": vector_results
        }

    # 初始化树状搜索引擎
    engine = TreeSearchEngine(tree_structure)

    # 1. 标题匹配（最高优先级）
    title_matches = engine.search_by_title(query, threshold=0.6)

    # 2. 关键点匹配（次优先级）
    key_point_matches = engine.search_by_key_points(query, threshold=0.5)

    # 3. 向量搜索（兜底）
    vector_with_scores = []
    for result in vector_results:
        metadata = result.get("metadata", {})
        distance = metadata.get("distance")
        # 将距离转换为分数（距离越小，分数越高）
        vector_score = 1.0 / (1.0 + distance) if distance is not None else 0
        vector_with_scores.append({
            "text": result.get("text", ""),
            "metadata": metadata,
            "score": vector_score,
            "match_type": "vector"
        })

    # 4. 混合评分
    all_results = []

    # 添加标题匹配结果（权重 3.0）
    for match in title_matches:
        node = match["node"]
        all_results.append({
            "text": f"【{match['path']}】\n{node.get('summary', '')[:500]}",
            "metadata": {
                "section": match["path"],
                "node_name": node.get("title", ""),
                "node_id": node.get("node_id", ""),
                "page": node.get("start_index"),
                "match_type": match["match_type"],
                "score": match["score"] * 3.0,  # 标题匹配权重高
                "raw_score": match["score"]
            },
            "score": match["score"] * 3.0
        })

    # 添加关键点匹配结果（权重 2.0）
    for match in key_point_matches:
        node = match["node"]
        all_results.append({
            "text": f"【关键点匹配】\n{match['matched_point']}\n\n{node.get('summary', '')[:500]}",
            "metadata": {
                "section": node.get("title", ""),
                "node_name": node.get("title", ""),
                "node_id": node.get("node_id", ""),
                "page": node.get("start_index"),
                "match_type": "key_point",
                "matched_point": match["matched_point"],
                "score": match["score"] * 2.0,  # 关键点匹配权重中等
                "raw_score": match["score"]
            },
            "score": match["score"] * 2.0
        })

    # 添加向量搜索结果（权重 1.0）
    for result in vector_with_scores:
        all_results.append({
            "text": result["text"],
            "metadata": result["metadata"],
            "score": result["score"]
        })

    # 5. 去重（按 node_id）
    seen_ids = set()
    unique_results = []
    for result in all_results:
        node_id = result["metadata"].get("node_id")
        if node_id and node_id not in seen_ids:
            seen_ids.add(node_id)
            unique_results.append(result)
        elif not node_id:
            # 没有 node_id 的结果也保留（向量搜索可能没有）
            unique_results.append(result)

    # 6. 排序并返回 Top-K
    unique_results.sort(key=lambda x: x["score"], reverse=True)
    top_results = unique_results[:max_results]

    # 确定使用的检索方法
    if title_matches:
        method = "hybrid_with_title"
    elif key_point_matches:
        method = "hybrid_with_keypoints"
    else:
        method = "vector_fallback"

    logger.info(f"[智能检索] 方法: {method}, 结果数: {len(top_results)}")
    for i, result in enumerate(top_results):
        match_type = result["metadata"].get("match_type", "unknown")
        score = result["score"]
        logger.info(f"  结果 {i+1}: type={match_type}, score={score:.4f}")

    return {
        "method": method,
        "results": top_results
    }
