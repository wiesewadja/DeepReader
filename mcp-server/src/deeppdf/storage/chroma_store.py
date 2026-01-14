"""
ChromaDB 存储封装
提供 PDF 文档向量存储和检索功能
"""
import chromadb
from chromadb.config import Settings
from pathlib import Path
from typing import List, Dict, Any, Optional
import hashlib


class ChromaStore:
    """ChromaDB 存储管理器"""

    def __init__(self, persist_directory: str = None):
        """
        初始化 ChromaDB 客户端

        Args:
            persist_directory: 持久化存储目录
        """
        if persist_directory is None:
            persist_directory = Path(__file__).parent.parent.parent / "data" / "chroma"

        self.persist_directory = Path(persist_directory)
        self.persist_directory.mkdir(parents=True, exist_ok=True)

        # 初始化 ChromaDB 客户端
        self.client = chromadb.PersistentClient(
            path=str(self.persist_directory),
            settings=Settings(
                anonymized_telemetry=False,
                allow_reset=True
            )
        )

    def create_collection(
        self,
        name: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> chromadb.Collection:
        """
        创建集合

        Args:
            name: 集合名称
            metadata: 集合元数据

        Returns:
            ChromaDB 集合对象
        """
        # 检查集合是否已存在
        existing_collections = [c.name for c in self.client.list_collections()]
        if name in existing_collections:
            return self.client.get_collection(name)

        # 创建新集合
        # ChromaDB 不接受空 metadata，只有当 metadata 非空时才传递
        create_kwargs = {"name": name}
        if metadata:
            create_kwargs["metadata"] = metadata

        collection = self.client.create_collection(**create_kwargs)
        return collection

    def get_collection(self, name: str) -> chromadb.Collection:
        """
        获取集合

        Args:
            name: 集合名称

        Returns:
            ChromaDB 集合对象
        """
        return self.client.get_collection(name)

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
        embeddings: Optional[List[List[float]]] = None
    ) -> None:
        """
        添加文档到集合

        Args:
            collection_name: 集合名称
            documents: 文档列表，每个文档包含 id, text, metadata
            embeddings: 可选的嵌入向量列表
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
        collection.add(
            ids=ids,
            documents=texts,
            metadatas=metadatas,
            embeddings=embeddings
        )

    def query(
        self,
        collection_name: str,
        query_texts: List[str],
        n_results: int = 5,
        where: Optional[Dict[str, Any]] = None,
        query_embeddings: Optional[List[List[float]]] = None
    ) -> Dict[str, Any]:
        """
        查询文档

        Args:
            collection_name: 集合名称
            query_texts: 查询文本列表
            n_results: 返回结果数量
            where: 元数据过滤条件
            query_embeddings: 可选的查询嵌入向量

        Returns:
            查询结果
        """
        collection = self.get_collection(collection_name)

        results = collection.query(
            query_texts=query_texts,
            n_results=n_results,
            where=where,
            query_embeddings=query_embeddings
        )

        return results

    def update_documents(
        self,
        collection_name: str,
        documents: List[Dict[str, Any]]
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

        collection.update(
            ids=ids,
            documents=texts,
            metadatas=metadatas
        )

    def delete_documents(
        self,
        collection_name: str,
        ids: List[str]
    ) -> None:
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
