"""
ChromaDB 存储封装
提供 PDF 文档向量存储和检索功能，使用中文嵌入模型
"""

import chromadb
from chromadb.config import Settings
from pathlib import Path
from typing import List, Dict, Any, Optional, Callable
import hashlib
import logging
from threading import Lock

from .embeddings import ChineseEmbeddingFunction
from ..config import settings

logger = logging.getLogger(__name__)


class ChromaStoreCache:
    """
    ChromaStore 实例缓存（单例模式）

    确保相同 persist_directory 的 ChromaStore 只创建一次，
    避免重复加载嵌入模型和初始化客户端。
    """

    _instance = None
    _lock = Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._stores: Dict[str, "ChromaStore"] = {}
                    cls._instance._refs: Dict[str, int] = {}
        return cls._instance

    def get_store(
        self,
        persist_directory: str,
        embedding_function: Optional[Callable] = None,
    ) -> "ChromaStore":
        """
        获取或创建 ChromaStore 实例

        Args:
            persist_directory: 持久化存储目录
            embedding_function: 嵌入函数（可选）

        Returns:
            ChromaStore 实例
        """
        # 生成缓存键（基于目录路径）
        cache_key = str(Path(persist_directory).resolve())

        with self._lock:
            if cache_key not in self._stores:
                # 创建新的 ChromaStore 实例
                logger.info(f"[ChromaStoreCache] 创建新实例: {cache_key}")
                self._stores[cache_key] = ChromaStore(
                    persist_directory=persist_directory,
                    embedding_function=embedding_function,
                    _from_cache=True,  # 标记从缓存创建，跳过嵌入函数初始化
                )
                self._refs[cache_key] = 1
            else:
                # 增加引用计数
                self._refs[cache_key] += 1
                logger.debug(
                    f"[ChromaStoreCache] 缓存命中: {cache_key} (引用: {self._refs[cache_key]})"
                )

            return self._stores[cache_key]

    def release_store(self, cache_key: str) -> None:
        """
        释放存储引用（减少引用计数）

        Args:
            cache_key: 存储缓存键
        """
        with self._lock:
            if cache_key in self._refs:
                self._refs[cache_key] -= 1
                logger.debug(
                    f"[ChromaStoreCache] 释放引用: {cache_key} (剩余: {self._refs[cache_key]})"
                )

    def clear_cache(self) -> None:
        """清空所有缓存的存储实例"""
        with self._lock:
            self._stores.clear()
            self._refs.clear()
            logger.info("[ChromaStoreCache] 已清空所有缓存")

    def get_cache_stats(self) -> Dict[str, Any]:
        """
        获取缓存统计信息

        Returns:
            包含缓存条目数和各条目引用计数的字典
        """
        with self._lock:
            return {
                "total_stores": len(self._stores),
                "references": dict(self._refs),
            }


# 全局缓存实例
_chroma_cache = ChromaStoreCache()


def get_chroma_store(
    persist_directory: str,
    embedding_function: Optional[Callable] = None,
) -> "ChromaStore":
    """
    获取 ChromaStore 实例（带缓存）

    推荐使用此函数获取 ChromaStore 实例，而不是直接创建。

    Args:
        persist_directory: 持久化存储目录
        embedding_function: 嵌入函数（可选）

    Returns:
        ChromaStore 实例
    """
    return _chroma_cache.get_store(
        persist_directory=persist_directory,
        embedding_function=embedding_function,
    )


class ChromaStore:
    """ChromaDB 存储管理器，使用中文嵌入模型"""

    def __init__(
        self,
        persist_directory: str = None,
        embedding_function: Optional[Callable] = None,
        _from_cache: bool = False,
    ):
        """
        初始化 ChromaDB 客户端

        Args:
            persist_directory: 持久化存储目录
            embedding_function: 嵌入函数，默认使用中文嵌入模型
            _from_cache: 内部参数，标记是否从缓存创建（跳过嵌入函数初始化）
        """
        if persist_directory is None:
            persist_directory = settings.base_dir / "chroma"

        self.persist_directory = Path(persist_directory)
        self.persist_directory.mkdir(parents=True, exist_ok=True)

        # 初始化中文嵌入函数（延迟加载）
        # 如果没有提供嵌入函数，使用默认的中文嵌入函数（会复用全局缓存的模型）
        self._embedding_function = embedding_function
        self._embedding_function_initialized = embedding_function is not None

        # 初始化 ChromaDB 客户端
        self.client = chromadb.PersistentClient(
            path=str(self.persist_directory),
            settings=Settings(anonymized_telemetry=False, allow_reset=True),
        )

    @property
    def embedding_function(self) -> Callable:
        """延迟加载嵌入函数"""
        if not self._embedding_function_initialized:
            self._embedding_function = ChineseEmbeddingFunction()
            self._embedding_function_initialized = True
        return self._embedding_function

    def create_collection(
        self,
        name: str,
        metadata: Optional[Dict[str, Any]] = None,
        embedding_function: Optional[Callable] = None,
        force_recreate: bool = False,
    ) -> chromadb.Collection:
        """
        创建集合

        Args:
            name: 集合名称
            metadata: 集合元数据
            embedding_function: 嵌入函数，默认使用实例的嵌入函数
            force_recreate: 是否强制重新创建（删除已存在的集合）

        Returns:
            ChromaDB 集合对象
        """
        # 检查集合是否已存在
        existing_collections = [c.name for c in self.client.list_collections()]

        if name in existing_collections:
            if force_recreate:
                # 强制删除已存在的集合
                logger.info(f"[ChromaStore] 删除已存在的集合: {name}")
                self.client.delete_collection(name)
            else:
                # 返回现有集合（注意：不会更新嵌入函数）
                logger.warning(f"[ChromaStore] 集合已存在，返回现有集合: {name}")
                return self.client.get_collection(name)

        # 使用指定的嵌入函数或默认的中文嵌入函数
        embed_fn = embedding_function or self.embedding_function

        # 创建新集合
        # ChromaDB 不接受空 metadata，只有当 metadata 非空时才传递
        create_kwargs = {"name": name, "embedding_function": embed_fn}
        if metadata:
            create_kwargs["metadata"] = metadata

        collection = self.client.create_collection(**create_kwargs)
        logger.info(f"[ChromaStore] 集合创建成功: {name}, 嵌入函数: {type(embed_fn).__name__}")
        return collection

    def get_collection(self, name: str) -> chromadb.Collection:
        """
        获取集合

        Args:
            name: 集合名称

        Returns:
            ChromaDB 集合对象
        """
        return self.client.get_collection(name, embedding_function=self.embedding_function)

    def delete_collection(self, name: str) -> None:
        """
        删除集合

        Args:
            name: 集合名称
        """
        self.client.delete_collection(name)

    def list_collections(self) -> List[chromadb.Collection]:
        """
        列出所有集合

        Returns:
            集合列表
        """
        return self.client.list_collections()

    def add_documents(
        self,
        collection_name: str,
        documents: List[Dict[str, Any]],
        embeddings: Optional[List[List[float]]] = None,
    ) -> None:
        """
        添加文档到集合

        Args:
            collection_name: 集合名称
            documents: 文档列表，每个文档包含 id, text, metadata
            embeddings: 可选的嵌入向量列表（如果提供，将覆盖自动生成的嵌入）
        """
        collection = self.get_collection(collection_name)

        ids = []
        texts = []
        metadatas = []

        for doc in documents:
            doc_id = doc.get("id")
            if doc_id is None:
                # 如果没有提供 id，使用文本的哈希值
                doc_id = hashlib.md5(doc["text"].encode()).hexdigest()

            ids.append(doc_id)
            texts.append(doc["text"])
            metadatas.append(doc.get("metadata", {}))

        # 添加文档到集合
        # 如果没有提供 embeddings，ChromaDB 会使用集合的嵌入函数自动生成
        collection.add(
            ids=ids, documents=texts, metadatas=metadatas, embeddings=embeddings
        )

    def query(
        self,
        collection_name: str,
        query_texts: List[str],
        n_results: int = 5,
        where: Optional[Dict[str, Any]] = None,
        query_embeddings: Optional[List[List[float]]] = None,
    ) -> Dict[str, Any]:
        """
        查询文档

        Args:
            collection_name: 集合名称
            query_texts: 查询文本列表
            n_results: 返回结果数量
            where: 元数据过滤条件
            query_embeddings: 可选的查询嵌入向量（如果提供，将覆盖自动生成的嵌入）

        Returns:
            查询结果
        """
        collection = self.get_collection(collection_name)

        results = collection.query(
            query_texts=query_texts,
            n_results=n_results,
            where=where,
            query_embeddings=query_embeddings,
        )

        return results

    def update_documents(
        self, collection_name: str, documents: List[Dict[str, Any]]
    ) -> None:
        """
        更新文档

        Args:
            collection_name: 集合名称
            documents: 要更新的文档列表
        """
        collection = self.get_collection(collection_name)

        ids = []
        texts = []
        metadatas = []

        for doc in documents:
            ids.append(doc["id"])
            texts.append(doc["text"])
            metadatas.append(doc.get("metadata", {}))

        collection.update(ids=ids, documents=texts, metadatas=metadatas)

    def delete_documents(self, collection_name: str, ids: List[str]) -> None:
        """
        删除文档

        Args:
            collection_name: 集合名称
            ids: 要删除的文档 ID 列表
        """
        collection = self.get_collection(collection_name)
        collection.delete(ids=ids)

    def get_collection_count(self, collection_name: str) -> int:
        """
        获取集合中的文档数量

        Args:
            collection_name: 集合名称

        Returns:
            文档数量
        """
        collection = self.get_collection(collection_name)
        return collection.count()

    def reset(self) -> None:
        """重置数据库（删除所有数据）"""
        self.client.reset()
