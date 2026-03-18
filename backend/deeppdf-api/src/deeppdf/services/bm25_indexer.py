"""
BM25 全文索引服务

功能：
1. 索引时构建 BM25 索引并持久化
2. 查询时加载索引并独立检索

存储位置: {storage_dir}/bm25/{index_id}.pkl
"""

import hashlib
import logging
import pickle
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

# 中文 NLP 依赖
try:
    import jieba3
    from rank_bm25 import BM25Okapi

    # 创建 jieba3 兼容层
    class _JiebaCompat:
        """jieba3 兼容层，模拟原版 jieba API"""

        def cut_for_search(self, sentence):
            """搜索引擎模式分词"""
            return jieba3._cut_text(sentence, model="base", use_hmm=True)

    jieba = _JiebaCompat()

except ImportError:
    logging.warning(
        "Missing dependencies: jieba3 or rank_bm25. BM25 indexing will be disabled."
    )
    jieba = None
    BM25Okapi = None

logger = logging.getLogger(__name__)


# 停用词列表（仅保留无意义的虚词，不过滤核心概念词）
STOP_WORDS = {
    # 助词/虚词
    "的", "了", "是", "在", "和", "与", "或", "对于", "关于", "这类", "那种",
    "这个", "那个", "这些", "那些", "等",
    # 疑问代词（保留"如何"、"什么"等，因为它们可能包含查询意图）
    "吗", "呢", "啊", "吧", "哈", "嗯",
    # 动词虚词
    "有", "没有", "可以", "能够", "应该", "需要", "要", "会",
    # 常见无意义词
    "书中", "内容", "是否",
}


class BM25Index:
    """BM25 索引对象"""

    def __init__(self):
        self.bm25: Optional[BM25Okapi] = None
        self.doc_ids: List[str] = []  # 段落 ID 列表
        self.corpus: List[List[str]] = []  # 分词后的语料
        self.doc_texts: Dict[str, str] = {}  # doc_id -> 原始文本
        self.doc_metadatas: Dict[str, Dict] = {}  # doc_id -> metadata

    def build(self, documents: List[Dict[str, Any]]) -> None:
        """
        构建 BM25 索引

        Args:
            documents: 文档列表，每个文档包含:
                - id: 段落 ID
                - text: 段落文本
                - metadata: 元数据（包含 parent_section 等）
        """
        if not jieba or not BM25Okapi:
            logger.warning("[BM25] 依赖缺失，跳过索引构建")
            return

        self.doc_ids = []
        self.corpus = []
        self.doc_texts = {}
        self.doc_metadatas = {}

        for doc in documents:
            doc_id = doc.get("id")
            text = doc.get("text", "")
            metadata = doc.get("metadata", {})

            if not doc_id or not text:
                continue

            # 组合章节标题和段落文本
            parent_section = metadata.get("parent_section", "")
            full_text = f"{parent_section} {text}"

            # 分词
            tokens = self._tokenize(full_text)

            self.doc_ids.append(doc_id)
            self.corpus.append(tokens)
            self.doc_texts[doc_id] = text
            self.doc_metadatas[doc_id] = metadata

        # 构建 BM25 索引
        if self.corpus:
            self.bm25 = BM25Okapi(self.corpus)
            logger.info(f"[BM25] 索引构建完成: {len(self.doc_ids)} 个段落")
        else:
            logger.warning("[BM25] 无有效文档，索引为空")

    def _tokenize(self, text: str) -> List[str]:
        """
        分词并过滤停用词

        Args:
            text: 输入文本

        Returns:
            分词后的 token 列表
        """
        tokens = list(jieba.cut_for_search(text))

        # 过滤停用词、标点、单字符
        filtered = []
        for token in tokens:
            token = token.strip()
            if not token:
                continue
            if token in STOP_WORDS:
                continue
            if len(token) == 1 and not token.isalnum():
                continue
            filtered.append(token)

        return filtered

    def search(self, query: str, top_k: int = 20) -> List[Dict[str, Any]]:
        """
        BM25 检索

        Args:
            query: 查询文本
            top_k: 返回结果数量

        Returns:
            检索结果列表，每个结果包含:
                - id: 段落 ID
                - text: 段落文本
                - metadata: 元数据
                - bm25_score: BM25 分数（归一化到 0-1）
        """
        if not self.bm25 or not self.doc_ids:
            return []

        # 查询分词
        query_tokens = self._tokenize(query)

        if not query_tokens:
            return []

        # BM25 评分
        scores = self.bm25.get_scores(query_tokens)

        # 获取 top-k 索引
        scored_docs = list(enumerate(scores))
        scored_docs.sort(key=lambda x: x[1], reverse=True)
        top_docs = scored_docs[:top_k]

        # 归一化分数
        max_score = top_docs[0][1] if top_docs and top_docs[0][1] > 0 else 1

        results = []
        for idx, score in top_docs:
            if score <= 0:
                continue

            doc_id = self.doc_ids[idx]
            normalized_score = score / max_score if max_score > 0 else 0

            results.append({
                "id": doc_id,
                "text": self.doc_texts.get(doc_id, ""),
                "metadata": self.doc_metadatas.get(doc_id, {}),
                "bm25_score": normalized_score,
            })

        return results

    def to_dict(self) -> Dict[str, Any]:
        """序列化为字典"""
        return {
            "doc_ids": self.doc_ids,
            "corpus": self.corpus,
            "doc_texts": self.doc_texts,
            "doc_metadatas": self.doc_metadatas,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "BM25Index":
        """从字典反序列化"""
        index = cls()
        index.doc_ids = data.get("doc_ids", [])
        index.corpus = data.get("corpus", [])
        index.doc_texts = data.get("doc_texts", {})
        index.doc_metadatas = data.get("doc_metadatas", {})

        # 重建 BM25 模型
        if index.corpus and BM25Okapi:
            index.bm25 = BM25Okapi(index.corpus)

        return index


# ============================================================
# 索引持久化
# ============================================================

def get_bm25_index_path(storage_dir: str, index_id: str) -> Path:
    """获取 BM25 索引文件路径"""
    return Path(storage_dir) / "bm25" / f"{index_id}.pkl"


def save_bm25_index(index: BM25Index, storage_dir: str, index_id: str) -> bool:
    """
    保存 BM25 索引到磁盘

    Args:
        index: BM25 索引对象
        storage_dir: 存储目录
        index_id: 索引 ID

    Returns:
        是否保存成功
    """
    try:
        index_path = get_bm25_index_path(storage_dir, index_id)
        index_path.parent.mkdir(parents=True, exist_ok=True)

        # 序列化（不保存 bm25 模型对象，只保存数据）
        data = index.to_dict()

        with open(index_path, "wb") as f:
            pickle.dump(data, f)

        logger.info(f"[BM25] 索引已保存: {index_path}")
        return True

    except Exception as e:
        logger.error(f"[BM25] 保存索引失败: {e}")
        return False


def load_bm25_index(storage_dir: str, index_id: str) -> Optional[BM25Index]:
    """
    从磁盘加载 BM25 索引

    Args:
        storage_dir: 存储目录
        index_id: 索引 ID

    Returns:
        BM25 索引对象，如果不存在则返回 None
    """
    try:
        index_path = get_bm25_index_path(storage_dir, index_id)

        if not index_path.exists():
            logger.debug(f"[BM25] 索引文件不存在: {index_path}")
            return None

        with open(index_path, "rb") as f:
            data = pickle.load(f)

        index = BM25Index.from_dict(data)
        logger.info(f"[BM25] 索引已加载: {len(index.doc_ids)} 个段落")

        return index

    except Exception as e:
        logger.error(f"[BM25] 加载索引失败: {e}")
        return None


def delete_bm25_index(storage_dir: str, index_id: str) -> bool:
    """
    删除 BM25 索引

    Args:
        storage_dir: 存储目录
        index_id: 索引 ID

    Returns:
        是否删除成功
    """
    try:
        index_path = get_bm25_index_path(storage_dir, index_id)

        if index_path.exists():
            index_path.unlink()
            logger.info(f"[BM25] 索引已删除: {index_path}")

        return True

    except Exception as e:
        logger.error(f"[BM25] 删除索引失败: {e}")
        return False


# ============================================================
# 索引构建入口
# ============================================================

def build_bm25_index_from_paragraphs(
    paragraphs: List[Dict[str, Any]],
    storage_dir: str,
    index_id: str,
) -> Optional[BM25Index]:
    """
    从段落列表构建 BM25 索引并保存

    Args:
        paragraphs: 段落列表（从 ChromaDB 获取）
        storage_dir: 存储目录
        index_id: 索引 ID

    Returns:
        BM25 索引对象
    """
    index = BM25Index()
    index.build(paragraphs)

    if index.bm25:
        save_bm25_index(index, storage_dir, index_id)
        return index

    return None


def bm25_search(
    query: str,
    storage_dir: str,
    index_id: str,
    top_k: int = 20,
) -> List[Dict[str, Any]]:
    """
    BM25 独立检索

    Args:
        query: 查询文本
        storage_dir: 存储目录
        index_id: 索引 ID
        top_k: 返回结果数量

    Returns:
        检索结果列表
    """
    index = load_bm25_index(storage_dir, index_id)

    if not index:
        logger.warning(f"[BM25] 索引不存在: {index_id}")
        return []

    return index.search(query, top_k)