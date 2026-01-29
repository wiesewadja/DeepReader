"""
智能检索服务 - 利用 PageIndex 树状结构、BM25 关键词匹配和向量检索

核心思路：
1. 章节标题匹配 - 在树状结构的标题中精确匹配，支持层级传播
2. BM25 关键词检索 - 全文关键词加权检索
3. 向量检索 - 语义相似度匹配
4. 混合评分 - 结合标题、BM25 和向量相似度

层级传播机制：
- 父节点标题匹配时，子节点继承匹配权重（衰减系数 0.7^n）
- 例如：查询"财富"匹配"第一章"，其子节点内容也获得加权
"""

import logging
from typing import Dict, Any, List
from difflib import SequenceMatcher

# 中文 NLP 依赖
try:
    import jieba3
    from rank_bm25 import BM25Okapi

    # 创建 jieba3 兼容层（模拟原版 jieba API）
    class _JiebaCompat:
        """jieba3 兼容层，模拟原版 jieba API"""

        def cut(self, sentence, cut_all=False):
            """兼容 jieba.cut()"""
            # jieba3 只需要基础的分词功能，使用 base 模型
            return jieba3._cut_text(sentence, model='base', use_hmm=True)

        def cut_for_search(self, sentence):
            """兼容 jieba.cut_for_search() - 用于搜索引擎的分词"""
            # 搜索引擎模式使用同样的分词，jieba3 会自动处理
            return jieba3._cut_text(sentence, model='base', use_hmm=True)

    jieba = _JiebaCompat()

except ImportError:
    logging.warning(
        "Missing dependencies: jieba3 or rank_bm25. BM25 search will be disabled."
    )
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
                    self.title_index[title].append({"node": node, "path": full_path})

                # 递归处理子节点
                children = node.get("nodes", [])
                if children:
                    traverse(children, full_path)

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
                summary = node.get("summary", "")[:500]
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

    def _collect_descendant_nodes(
        self, node: Dict[str, Any], path: str, depth: int = 0
    ) -> List[Dict[str, Any]]:
        """
        递归收集所有子孙节点

        Args:
            node: 当前节点
            path: 节点路径
            depth: 当前深度（用于计算衰减权重）

        Returns:
            子节点列表，包含路径和深度信息
        """
        descendants = []
        children = node.get("nodes", [])

        for child in children:
            child_title = child.get("title", "")
            child_path = f"{path} > {child_title}" if path else child_title
            descendants.append({"node": child, "path": child_path, "depth": depth + 1})

            # 递归收集更深层的子节点
            descendants.extend(
                self._collect_descendant_nodes(child, child_path, depth + 1)
            )

        return descendants

    def _extract_keywords(self, query: str) -> List[str]:
        """
        从查询中提取关键词

        Args:
            query: 用户查询

        Returns:
            关键词列表（按长度降序）
        """
        if not jieba:
            return [query]

        # 使用 jieba 分词并提取关键词
        words = list(jieba.cut_for_search(query))

        # 过滤停用词和单字符词
        stop_words = {
            "的",
            "了",
            "是",
            "在",
            "和",
            "与",
            "或",
            "对于",
            "关于",
            "这类",
            "那种",
            "书中",
            "内容",
            "是否",
            "如何",
            "什么",
            "哪些",
            "怎样",
            "怎么",
            "这个",
            "那个",
            "这些",
            "那些",
            "有",
            "没有",
            "可以",
            "能够",
            "应该",
            "需要",
            "要",
            "会",
            "等",
            "吗",
            "呢",
            "啊",
            "吧",
            "哈",
            "嗯",
        }

        # 过滤停用词、标点、单字符
        keywords = []
        for word in words:
            word = word.strip()
            if (
                len(word) > 1
                and word not in stop_words
                and not word.isspace()
                and any(c.isalnum() or "\u4e00" <= c <= "\u9fff" for c in word)
            ):
                keywords.append(word)

        # 去重并按长度降序（长词优先）
        unique_keywords = list(set(keywords))
        unique_keywords.sort(key=len, reverse=True)

        return unique_keywords if unique_keywords else [query]

    def search_by_title(
        self, query: str, threshold: float = 0.6, decay_factor: float = 0.7
    ) -> List[Dict[str, Any]]:
        """
        在章节标题中搜索，支持层级传播

        Args:
            query: 查询词
            threshold: 相似度阈值
            decay_factor: 权重衰减系数（默认 0.7）

        Returns:
            匹配结果列表，包括匹配节点及其子孙节点
        """
        results = []

        # 提取关键词用于匹配
        keywords = self._extract_keywords(query)

        for title, nodes in self.title_index.items():
            title_lower = title.lower()
            match_found = False
            match_score = 0.0
            match_type = "title_fuzzy"

            # 1. 首先检查完整 query 是否包含在标题中（优先级最高）
            if query.lower() in title_lower:
                match_found = True
                match_score = 1.0
                match_type = "title_exact"

            # 2. 检查关键词是否在标题中
            for keyword in keywords:
                if keyword.lower() in title_lower:
                    match_found = True
                    # 关键词匹配分数 = 0.9（略低于完全匹配）
                    match_score = max(match_score, 0.9)
                    match_type = "title_keyword"
                    break

            # 3. 如果没有直接匹配，计算模糊相似度
            if not match_found:
                # 使用关键词拼接计算相似度
                keyword_text = " ".join(keywords[:5])  # 取前5个关键词
                similarity = SequenceMatcher(
                    None, title_lower, keyword_text.lower()
                ).ratio()
                if similarity >= threshold:
                    match_found = True
                    match_score = similarity
                    match_type = "title_fuzzy"

            if match_found:
                for item in nodes:
                    matched_node = item["node"]
                    matched_path = item["path"]

                    # 添加匹配的父节点本身（depth=0）
                    results.append(
                        {
                            "node": matched_node,
                            "path": matched_path,
                            "score": match_score,
                            "match_type": match_type,
                            "depth": 0,
                        }
                    )

                    # 层级传播：收集所有子孙节点
                    descendants = self._collect_descendant_nodes(
                        matched_node, matched_path
                    )

                    for desc in descendants:
                        # 权重衰减：score = base_score * (decay_factor ^ depth)
                        inherited_score = match_score * (decay_factor ** desc["depth"])

                        results.append(
                            {
                                "node": desc["node"],
                                "path": desc["path"],
                                "score": inherited_score,
                                "match_type": "title_inherited",
                                "depth": desc["depth"],
                                "parent_match": matched_path,
                            }
                        )

        # 按分数排序
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
                results.append(
                    {"node": self.bm25_nodes[i], "score": score, "match_type": "bm25"}
                )
        return results


def hybrid_search(
    query: str,
    index_metadata: Dict[str, Any],
    vector_results: List[Dict[str, Any]],
    max_results: int = 10,
) -> Dict[str, Any]:
    """
    混合检索：结合树状结构搜索、BM25 和向量搜索
    """
    tree_structure = index_metadata.get("tree_structure", {})
    if not tree_structure:
        return {"method": "vector_only", "results": vector_results}

    engine = TreeSearchEngine(tree_structure)

    # 1. 标题匹配（最高优先级，支持层级传播）
    title_matches = engine.search_by_title(query, threshold=0.6, decay_factor=0.7)

    # 统计直接匹配和继承匹配
    direct_matches = [m for m in title_matches if m.get("depth", 0) == 0]
    inherited_matches = [m for m in title_matches if m.get("depth", 0) > 0]

    logger.info(
        f"[智能检索] 标题匹配: {len(direct_matches)} 直接匹配 + "
        f"{len(inherited_matches)} 继承匹配 = {len(title_matches)} 总结果"
    )

    # 2. BM25 搜索
    bm25_matches = engine.search_by_bm25(query, top_k=max_results)
    logger.info(f"[智能检索] BM25 匹配: {len(bm25_matches)} 个结果")

    # 3. 向量搜索（兜底）
    vector_with_scores = []
    for result in vector_results:
        metadata = result.get("metadata", {})
        distance = metadata.get("distance")
        vector_score = 1.0 / (1.0 + distance) if distance is not None else 0
        vector_with_scores.append(
            {
                "text": result.get("text", ""),
                "metadata": metadata,
                "score": vector_score,
                "match_type": "vector",
            }
        )

    # 5. 混合评分
    all_results = []

    # 添加标题匹配结果（权重 2.5）
    for match in title_matches:
        node = match["node"]
        text_content = node.get("text", "")
        depth = match.get("depth", 0)

        # 根据匹配类型生成不同的显示文本
        if depth == 0:
            # 直接匹配
            display_text = f"【章节匹配: {match['path']}】\n{text_content[:500]}"
        else:
            # 继承匹配
            parent = match.get("parent_match", "")
            display_text = (
                f"【继承匹配 (L{depth}): {match['path']}】\n"
                f"父节点匹配: {parent}\n\n{text_content[:500]}"
            )

        all_results.append(
            {
                "text": display_text,
                "metadata": {
                    "section": match["path"],
                    "node_name": node.get("title", ""),
                    "node_id": node.get("node_id", ""),
                    "page": node.get("start_index"),
                    "markdown_path": node.get("markdown_path"),
                    "match_type": match["match_type"],
                    "depth": depth,
                    "parent_match": match.get("parent_match", ""),
                    "score": match["score"] * 2.5,
                    "raw_score": match["score"],
                },
                "score": match["score"] * 2.5,
            }
        )

    # 添加 BM25 匹配结果（权重 1.5）
    # 修复：移除魔法值，只在有 BM25 匹配时处理
    if bm25_matches:
        max_bm25_score = max([m["score"] for m in bm25_matches])

        for match in bm25_matches:
            node = match["node"]
            norm_score = match["score"] / max_bm25_score if max_bm25_score > 0 else 0

            all_results.append(
                {
                    "text": f"【关键词匹配 (BM25)】\n{node.get('text', '')[:500]}...",
                    "metadata": {
                        "section": node.get("title", ""),
                        "node_name": node.get("title", ""),
                        "node_id": node.get("node_id", ""),
                        "page": node.get("start_index"),
                        "match_type": "bm25",
                        "score": norm_score * 1.5,
                        "raw_score": match["score"],
                    },
                    "score": norm_score * 1.5,
                }
            )

    # 添加向量搜索结果（权重 1.0）
    for result in vector_with_scores:
        all_results.append(
            {
                "text": result["text"],
                "metadata": {**result["metadata"], "match_type": "vector"},
                "score": result["score"],
            }
        )

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
    if title_matches:
        method_str.append("title")
    if bm25_matches:
        method_str.append("bm25")
    if vector_with_scores:
        method_str.append("vector")

    method = f"hybrid_{'_'.join(method_str)}"

    logger.info(f"[智能检索] 方法: {method}, 结果数: {len(top_results)}")
    for i, result in enumerate(top_results):
        match_type = result["metadata"].get("match_type", "unknown")
        score = result["score"]
        logger.info(f"  结果 {i+1}: type={match_type}, score={score:.4f}")

    return {"method": method, "results": top_results}
