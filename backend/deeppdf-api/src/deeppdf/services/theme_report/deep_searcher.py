"""
深度搜索模块

基于查询扩展结果，执行多策略检索并合并结果。
"""

import asyncio
import logging
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from ..cross_book_search import cross_book_search

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """搜索结果"""

    text: str
    book_name: str
    index_id: str
    section: str
    page: int
    obsidian_link: str
    score: float = 0.0
    query: str = ""  # 来源查询


@dataclass
class DeepSearchResult:
    """深度搜索结果"""

    results: List[SearchResult] = field(default_factory=list)
    queries_used: List[str] = field(default_factory=list)
    books_searched: int = 0
    total_results: int = 0
    deduped_results: int = 0


class DeepSearcher:
    """
    深度搜索器

    特性：
    1. 多查询并行搜索
    2. 结果去重与合并
    3. 分数归一化与重排序
    4. 支持指定书籍范围
    """

    def __init__(
        self,
        storage_dir: str,
        max_workers: int = 3,
        top_k_per_query: int = 5,
    ):
        """
        初始化深度搜索器

        Args:
            storage_dir: 存储目录
            max_workers: 最大并行数
            top_k_per_query: 每个查询返回的结果数
        """
        self.storage_dir = storage_dir
        self.max_workers = max_workers
        self.top_k_per_query = top_k_per_query

    def search(
        self,
        queries: List[str],
        index_ids: Optional[List[str]] = None,
        top_k_per_book: int = 3,
    ) -> DeepSearchResult:
        """
        执行多查询搜索

        Args:
            queries: 查询列表（通常是原始主题 + 扩展的子问题）
            index_ids: 可选，限制搜索的索引 ID
            top_k_per_book: 每本书取多少条结果

        Returns:
            DeepSearchResult 包含合并后的结果
        """
        logger.info(f"[DeepSearcher] 开始搜索 {len(queries)} 个查询")

        all_results: List[SearchResult] = []

        # 并行执行多个查询
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = []
            for query in queries:
                future = executor.submit(
                    self._search_single_query,
                    query,
                    index_ids,
                    self.top_k_per_query,
                )
                futures.append((query, future))

            # 收集结果
            for query, future in futures:
                try:
                    results = future.result(timeout=60)
                    for r in results:
                        r.query = query
                    all_results.extend(results)
                except Exception as e:
                    logger.error(f"[DeepSearcher] 查询失败 '{query}': {e}")

        # 去重与合并
        deduped = self._deduplicate_and_merge(all_results)

        # 按书籍分组，每本书限制数量
        final_results = self._limit_per_book(deduped, top_k_per_book)

        # 统计
        books_searched = len(set(r.book_name for r in final_results))

        result = DeepSearchResult(
            results=final_results,
            queries_used=queries,
            books_searched=books_searched,
            total_results=len(all_results),
            deduped_results=len(final_results),
        )

        logger.info(
            f"[DeepSearcher] 搜索完成: {len(all_results)} -> {len(final_results)} 结果, "
            f"{books_searched} 本书"
        )

        return result

    def _search_single_query(
        self,
        query: str,
        index_ids: Optional[List[str]],
        top_k: int,
    ) -> List[SearchResult]:
        """
        执行单个查询搜索

        Args:
            query: 查询字符串
            index_ids: 索引 ID 列表
            top_k: 返回结果数

        Returns:
            SearchResult 列表
        """
        try:
            # 调用现有的跨书籍搜索
            raw_result = cross_book_search(
                query=query,
                storage_dir=self.storage_dir,
                index_ids=index_ids,
                top_k=top_k,
            )

            if raw_result.get("status") != "success":
                return []

            results = []
            for item in raw_result.get("results", []):
                results.append(
                    SearchResult(
                        text=item.get("text", ""),
                        book_name=item.get("book_name", "未知书籍"),
                        index_id=item.get("index_id", ""),
                        section=item.get("section", "未知章节"),
                        page=item.get("page", 0),
                        obsidian_link=item.get("obsidian_link", ""),
                        score=1.0 - item.get("distance", 0.5),  # 转换距离为分数
                    )
                )

            return results

        except Exception as e:
            logger.error(f"[DeepSearcher] 单查询搜索失败: {e}")
            return []

    def _deduplicate_and_merge(
        self, results: List[SearchResult]
    ) -> List[SearchResult]:
        """
        去重并合并结果

        策略：
        1. 基于文本内容去重（相似度 > 0.9）
        2. 保留分数最高的版本
        3. 记录所有来源查询
        """
        if not results:
            return []

        # 简单去重：基于文本前 100 字符
        seen_texts: Dict[str, SearchResult] = {}

        for result in results:
            key = result.text[:100].strip()
            if key not in seen_texts:
                seen_texts[key] = result
            else:
                # 保留分数更高的
                if result.score > seen_texts[key].score:
                    seen_texts[key] = result

        return list(seen_texts.values())

    def _limit_per_book(
        self, results: List[SearchResult], top_k: int
    ) -> List[SearchResult]:
        """
        限制每本书的结果数量

        Args:
            results: 所有结果
            top_k: 每本书最大结果数

        Returns:
            限制后的结果列表
        """
        # 按书籍分组
        book_results: Dict[str, List[SearchResult]] = defaultdict(list)
        for r in results:
            book_results[r.book_name].append(r)

        # 每本书按分数排序，取 top_k
        final_results = []
        for book_name, items in book_results.items():
            sorted_items = sorted(items, key=lambda x: x.score, reverse=True)
            final_results.extend(sorted_items[:top_k])

        # 整体按分数排序
        final_results.sort(key=lambda x: x.score, reverse=True)

        return final_results

    def search_by_book(
        self,
        queries: List[str],
        book_name: str,
        top_k: int = 5,
    ) -> List[SearchResult]:
        """
        在指定书籍中搜索

        Args:
            queries: 查询列表
            book_name: 书籍名称
            top_k: 返回结果数

        Returns:
            SearchResult 列表
        """
        # 找到对应书籍的 index_id
        from deeppdf.services.cross_book_search import get_all_indexes

        all_indexes = get_all_indexes(self.storage_dir)
        target_index_id = None

        for idx in all_indexes:
            if book_name in idx.get("doc_name", ""):
                target_index_id = idx.get("index_id")
                break

        if not target_index_id:
            logger.warning(f"[DeepSearcher] 未找到书籍: {book_name}")
            return []

        # 使用该 index_id 搜索
        result = self.search(queries, index_ids=[target_index_id], top_k_per_book=top_k)

        return result.results


async def deep_search_async(
    queries: List[str],
    storage_dir: str,
    index_ids: Optional[List[str]] = None,
    top_k_per_book: int = 3,
) -> DeepSearchResult:
    """
    异步深度搜索入口

    Args:
        queries: 查询列表
        storage_dir: 存储目录
        index_ids: 索引 ID 列表
        top_k_per_book: 每本书结果数

    Returns:
        DeepSearchResult
    """
    searcher = DeepSearcher(storage_dir=storage_dir)

    # 在线程池中执行同步搜索
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: searcher.search(queries, index_ids, top_k_per_book),
    )

    return result
