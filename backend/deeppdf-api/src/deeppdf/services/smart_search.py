"""
智能检索服务 - 利用 PageIndex 树状结构、BM25 关键词匹配和 LLM 推理结果

核心思路：
1. 章节标题匹配 - 在树状结构的标题中精确匹配
2. BM25 关键词检索 - 全文关键词加权检索 (新增)
3. 关键点提取 - 利用 LLM 生成的摘要要点
4. 混合评分 - 结合标题、BM25、关键点和向量相似度
"""
import json
import logging
import re
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from difflib import SequenceMatcher

# 新增依赖
try:
    import jieba
    from rank_bm25 import BM25Okapi
except ImportError:
    import logging
    logging.warning("Missing dependencies: jieba or rank_bm25. BM25 search will be disabled.")
    jieba = None
    BM25Okapi = None

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
        # 构建 BM25 索引
        self._build_bm25_index()

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

    def _build_bm25_index(self):
        """构建 BM25 索引"""
        self.bm25_corpus = []
        self.bm25_nodes = []

        if not jieba or not BM25Okapi:
            logger.warning("[BM25] 依赖缺失 (jieba 或 rank_bm25)，BM25 搜索已禁用")
            self.bm25 = None
            return

        def traverse(nodes):
            for node in nodes:
                # 组合标题、摘要和正文作为检索语料
                # 限制文本长度，防止内存问题
                text_content = node.get("text", "")[:1000]
                summary = node.get('summary', "")[:500]
                content = f"{node.get('title', '')} {summary} {text_content}"

                if content.strip():
                    # 中文分词
                    tokens = list(jieba.cut_for_search(content))
                    self.bm25_corpus.append(tokens)
                    self.bm25_nodes.append(node)

                # 递归
                children = node.get("nodes")
                if children:
                    traverse(children)

        traverse(self.structure)

        if self.bm25_corpus:
            try:
                self.bm25 = BM25Okapi(self.bm25_corpus)
                logger.info(f"[BM25] 索引构建成功，文档数: {len(self.bm25_corpus)}")
            except Exception as e:
                logger.error(f"Failed to initialize BM25: {e}")
                self.bm25 = None
        else:
            self.bm25 = None

    def search_by_title(self, query: str, threshold: float = 0.6) -> List[Dict[str, Any]]:
        """在章节标题中搜索"""
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
        """在 LLM 生成的关键点中搜索"""
        results = []
        query_lower = query.lower()

        for item in self.key_points_index:
            point = item["point"]
            node = item["node"]

            if query_lower in point.lower():
                similarity = SequenceMatcher(None, point.lower(), query_lower).ratio()
                results.append({
                    "node": node,
                    "matched_point": point,
                    "score": similarity,
                    "match_type": "key_point"
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results

    def search_by_bm25(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """BM25 检索"""
        if not self.bm25 or not jieba:
            return []
            
        tokenized_query = list(jieba.cut_for_search(query))
        scores = self.bm25.get_scores(tokenized_query)
        
        # 获取 Top-K 索引
        scored_indices = [(i, score) for i, score in enumerate(scores)]
        scored_indices.sort(key=lambda x: x[1], reverse=True)
        top_k_indices = scored_indices[:top_k]
        
        results = []
        for i, score in top_k_indices:
            if score > 0:
                results.append({
                    "node": self.bm25_nodes[i],
                    "score": score,
                    "match_type": "bm25"
                })
        return results

def hybrid_search(
    query: str,
    index_metadata: Dict[str, Any],
    vector_results: List[Dict[str, Any]],
    max_results: int = 5
) -> Dict[str, Any]:
    """
    混合检索：结合树状结构搜索、BM25 和向量搜索
    """
    tree_structure = index_metadata.get("tree_structure", {})
    if not tree_structure:
        return {
            "method": "vector_only",
            "results": vector_results
        }

    engine = TreeSearchEngine(tree_structure)

    # 1. 标题匹配（最高优先级）
    title_matches = engine.search_by_title(query, threshold=0.6)
    logger.info(f"[智能检索] 标题匹配: {len(title_matches)} 个结果")

    # 2. 关键点匹配
    key_point_matches = engine.search_by_key_points(query, threshold=0.5)
    logger.info(f"[智能检索] 关键点匹配: {len(key_point_matches)} 个结果")

    # 3. BM25 搜索
    bm25_matches = engine.search_by_bm25(query, top_k=max_results)
    logger.info(f"[智能检索] BM25 匹配: {len(bm25_matches)} 个结果")

    # 4. 向量搜索（兜底）
    vector_with_scores = []
    for result in vector_results:
        metadata = result.get("metadata", {})
        distance = metadata.get("distance")
        vector_score = 1.0 / (1.0 + distance) if distance is not None else 0
        vector_with_scores.append({
            "text": result.get("text", ""),
            "metadata": metadata,
            "score": vector_score,
            "match_type": "vector"
        })

    # 5. 混合评分
    all_results = []

    # 添加标题匹配结果（权重 2.5）
    for match in title_matches:
        node = match["node"]
        # 修复：返回节点的 text，而不是 summary
        text_content = node.get("text", "")
        all_results.append({
            "text": f"【章节标题匹配: {match['path']}】\n{text_content[:500]}",
            "metadata": {
                "section": match["path"],
                "node_name": node.get("title", ""),
                "node_id": node.get("node_id", ""),
                "page": node.get("start_index"),
                "markdown_path": node.get("markdown_path"),
                "match_type": match["match_type"],
                "score": match["score"] * 2.5,  # 降低权重到 2.5
                "raw_score": match["score"]
            },
            "score": match["score"] * 2.5
        })

    # 添加关键点匹配结果（权重 2.0）
    for match in key_point_matches:
        node = match["node"]
        # 修复：返回节点的 text，而不是 summary
        text_content = node.get("text", "")
        all_results.append({
            "text": f"【关键点匹配】\n{match['matched_point']}\n\n{text_content[:500]}",
            "metadata": {
                "section": node.get("title", ""),
                "node_name": node.get("title", ""),
                "node_id": node.get("node_id", ""),
                "page": node.get("start_index"),
                "match_type": "key_point",
                "matched_point": match["matched_point"],
                "score": match["score"] * 2.0,
                "raw_score": match["score"]
            },
            "score": match["score"] * 2.0
        })

    # 添加 BM25 匹配结果（权重 1.5）
    # 修复：移除魔法值，只在有 BM25 匹配时处理
    if bm25_matches:
        max_bm25_score = max([m["score"] for m in bm25_matches])

        for match in bm25_matches:
            node = match["node"]
            norm_score = match["score"] / max_bm25_score if max_bm25_score > 0 else 0

            all_results.append({
                "text": f"【关键词匹配 (BM25)】\n{node.get('text', '')[:500]}...",
                "metadata": {
                    "section": node.get("title", ""),
                    "node_name": node.get("title", ""),
                    "node_id": node.get("node_id", ""),
                    "page": node.get("start_index"),
                    "match_type": "bm25",
                    "score": norm_score * 1.5,
                    "raw_score": match["score"]
                },
                "score": norm_score * 1.5
            })

    # 添加向量搜索结果（权重 1.0）
    for result in vector_with_scores:
        all_results.append({
            "text": result["text"],
            "metadata": {**result["metadata"], "match_type": "vector"},
            "score": result["score"]
        })

    # 6. 去重（按 node_id，若无则使用文本 hash）
    seen = set()
    unique_results = []
    for result in all_results:
        node_id = result["metadata"].get("node_id")
        # 使用 node_id 或文本 hash 作为去重依据
        key = node_id if node_id else hash(result["text"][:100])
        if key not in seen:
            seen.add(key)
            unique_results.append(result)

    # 7. 排序并返回 Top-K
    unique_results.sort(key=lambda x: x["score"], reverse=True)
    top_results = unique_results[:max_results]

    # 确定使用的检索方法日志
    method_str = []
    if title_matches: method_str.append("title")
    if key_point_matches: method_str.append("keypoint")
    if bm25_matches: method_str.append("bm25")
    if vector_with_scores: method_str.append("vector")
    
    method = f"hybrid_{'_'.join(method_str)}"

    logger.info(f"[智能检索] 方法: {method}, 结果数: {len(top_results)}")
    for i, result in enumerate(top_results):
        match_type = result["metadata"].get("match_type", "unknown")
        score = result["score"]
        logger.info(f"  结果 {i+1}: type={match_type}, score={score:.4f}")

    return {
        "method": method,
        "results": top_results
    }
