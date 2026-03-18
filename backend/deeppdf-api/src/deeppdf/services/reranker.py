"""
重排序服务 - 使用 BGE Reranker 对多路召回结果进行重排序
"""

import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from threading import Lock

logger = logging.getLogger(__name__)

# 默认重排序模型
DEFAULT_RERANKER_MODEL = "BAAI/bge-reranker-v2-m3"


class RerankerCache:
    """
    重排序模型缓存（单例模式）
    确保相同配置的模型只加载一次
    """

    _instance = None
    _lock = Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._models: Dict[str, Any] = {}
        return cls._instance

    def get_model(self, model_name: str) -> Any:
        """
        获取或创建重排序模型实例

        Args:
            model_name: 模型名称

        Returns:
            FlagReranker 实例
        """
        with self._lock:
            if model_name not in self._models:
                try:
                    from FlagReranker import FlagReranker

                    logger.info(f"[重排序] 加载模型: {model_name}")
                    self._models[model_name] = FlagReranker(
                        model_name,
                        use_fp16=True,  # 使用 FP16 加速
                    )
                    logger.info(f"[重排序] 模型加载完成: {model_name}")
                except Exception as e:
                    logger.error(f"[重排序] 模型加载失败: {e}")
                    raise

            return self._models[model_name]


# 全局缓存实例
_reranker_cache = RerankerCache()


def rerank_results(
    query: str,
    results: List[Dict[str, Any]],
    model_name: str = DEFAULT_RERANKER_MODEL,
    top_k: int = 10,
) -> List[Dict[str, Any]]:
    """
    对搜索结果进行重排序

    Args:
        query: 用户查询
        results: 多路召回的合并结果（包含 text 字段）
        model_name: 重排序模型名称
        top_k: 返回结果数量

    Returns:
        重排序后的结果列表
    """
    if not results:
        return []

    try:
        # 获取重排序模型
        reranker = _reranker_cache.get_model(model_name)

        # 构建输入对
        pairs = [(query, r.get("text", "")) for r in results]

        # 执行重排序
        scores = reranker.compute_score(pairs)

        # 将结果与分数组合并排序
        scored_results = list(zip(results, scores))
        scored_results.sort(key=lambda x: x[1], reverse=True)

        # 返回 top-k 结果
        return [r for r, scored_results[:top_k]]

    except Exception as e:
        logger.error(f"[重排序] 重排序失败: {e}")
        # 失败时返回原始顺序
        return results[:top_k]
