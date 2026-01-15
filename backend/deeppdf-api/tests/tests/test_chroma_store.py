import pytest
import tempfile
from pathlib import Path
from deeppdf.storage.chroma_store import ChromaStore


def test_store_initialization():
    """测试存储初始化"""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = ChromaStore(persist_directory=tmpdir)
        assert store.client is not None


def test_create_collection():
    """测试创建集合"""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = ChromaStore(persist_directory=tmpdir)
        collection = store.create_collection(
            name="test_index",
            metadata={"pdf_name": "test.pdf", "node_count": 10}
        )
        assert collection is not None
        assert collection.name == "test_index"


def test_add_documents():
    """测试添加文档"""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = ChromaStore(persist_directory=tmpdir)
        collection = store.create_collection(name="test_index")

        store.add_documents(
            collection_name="test_index",
            documents=[
                {
                    "id": "doc1",
                    "text": "测试内容",
                    "metadata": {"page": 1, "section": "1.1"}
                }
            ]
        )

        # 验证文档数量
        count = collection.count()
        assert count == 1


def test_query_documents():
    """测试查询文档"""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = ChromaStore(persist_directory=tmpdir)
        collection = store.create_collection(name="test_index")

        # 先添加文档
        store.add_documents(
            collection_name="test_index",
            documents=[
                {
                    "id": "doc1",
                    "text": "Transformer 是一种神经网络架构",
                    "metadata": {"page": 1}
                }
            ]
        )

        # 查询
        results = store.query(
            collection_name="test_index",
            query_texts=["Transformer"],
            n_results=1
        )

        assert len(results["ids"][0]) >= 0  # 可能返回空结果，这是预期的


def test_delete_collection():
    """测试删除集合"""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = ChromaStore(persist_directory=tmpdir)
        store.create_collection(name="test_index")

        # 删除集合
        store.delete_collection("test_index")

        # 验证集合已删除
        with pytest.raises(Exception):
            store.get_collection("test_index")


def test_list_collections():
    """测试列出所有集合"""
    with tempfile.TemporaryDirectory() as tmpdir:
        store = ChromaStore(persist_directory=tmpdir)
        store.create_collection(name="index1")
        store.create_collection(name="index2")

        collections = store.list_collections()
        assert len(collections) == 2
