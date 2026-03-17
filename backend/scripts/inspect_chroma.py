#!/usr/bin/env python3
"""
ChromaDB 数据检查脚本

用法:
    cd backend
    uv run python scripts/inspect_chroma.py [index_id]

如果不指定 index_id，会列出所有集合并显示第一个集合的样本。
如果指定 index_id，会显示该集合的详细信息。
"""

import chromadb
from pathlib import Path
import sys
import numpy as np


def inspect_collection(coll, limit: int = 5):
    """检查单个集合"""
    print(f"\n{'='*70}")
    print(f"集合: {coll.name}")
    print(f"文档数: {coll.count()}")
    print(f"{'='*70}")

    # 获取元数据字段统计
    result = coll.get(limit=min(100, coll.count()), include=['metadatas'])

    if not result['metadatas']:
        print("  (空集合)")
        return

    # 统计字段出现次数
    field_counts = {}
    type_counts = {}
    for meta in result['metadatas']:
        for key in meta.keys():
            field_counts[key] = field_counts.get(key, 0) + 1
        if 'type' in meta:
            type_counts[meta['type']] = type_counts.get(meta['type'], 0) + 1

    print(f"\n【字段统计】(采样 {len(result['metadatas'])} 条)")
    for key, count in sorted(field_counts.items(), key=lambda x: -x[1]):
        print(f"  {key}: {count}/{len(result['metadatas'])} ({count*100//len(result['metadatas'])}%)")

    if type_counts:
        print(f"\n【类型分布】")
        for t, count in type_counts.items():
            print(f"  {t}: {count}")

    # 获取向量信息
    result_with_emb = coll.get(limit=min(10, coll.count()), include=['embeddings'])
    embeddings = result_with_emb['embeddings']
    
    if embeddings is not None and len(embeddings) > 0:
        emb_dim = len(embeddings[0])
        norms = [np.linalg.norm(emb) for emb in embeddings]
        avg_norm = np.mean(norms)
        
        print(f"\n【向量信息】")
        print(f"  嵌入模型: bge-small-zh-v1.5")
        print(f"  向量维度: {emb_dim}")
        print(f"  平均范数: {avg_norm:.4f}")
        print(f"  向量样本 (前10维): {embeddings[0][:10]}")

    # 获取样本数据
    result = coll.get(limit=limit, include=['documents', 'metadatas'])

    print(f"\n【样本数据】(前 {limit} 条)")
    for i in range(len(result['ids'])):
        print(f"\n--- 文档 {i+1} ---")
        print(f"ID: {result['ids'][i]}")

        meta = result['metadatas'][i]
        print(f"Metadata:")
        for key in ['type', 'block_id', 'section', 'node_name', 'page', 'level', 'pdf_name']:
            if key in meta:
                val = meta[key]
                if isinstance(val, str) and len(val) > 60:
                    val = val[:60] + "..."
                print(f"  {key}: {val}")

        # 段落特有字段
        if meta.get('type') == 'paragraph':
            for key in ['chunk_index', 'total_chunks', 'full_paragraph']:
                if key in meta:
                    val = meta[key]
                    if key == 'full_paragraph' and isinstance(val, str) and len(val) > 60:
                        val = f"{val[:60]}... (共 {len(val)} 字)"
                    print(f"  {key}: {val}")

        doc = result['documents'][i]
        print(f"Text ({len(doc)} 字): {doc[:100]}...")


def search_similar(coll, query_text: str, n_results: int = 5):
    """搜索相似文档"""
    print(f"\n{'='*70}")
    print(f"相似度搜索: \"{query_text[:50]}...\"")
    print(f"{'='*70}")

    result = coll.query(
        query_texts=[query_text],
        n_results=n_results,
        include=['documents', 'metadatas', 'distances']
    )

    for i in range(len(result['ids'][0])):
        print(f"\n--- 结果 {i+1} (距离: {result['distances'][0][i]:.4f}) ---")
        meta = result['metadatas'][0][i]
        print(f"章节: {meta.get('section', 'N/A')}")
        print(f"页码: {meta.get('page', 'N/A')}")
        doc = result['documents'][0][i]
        print(f"内容: {doc[:150]}...")


def main():
    chroma_dir = Path(__file__).parent.parent / "data" / "chroma"
    client = chromadb.PersistentClient(path=str(chroma_dir))

    collections = client.list_collections()
    print(f"共有 {len(collections)} 个集合")

    if len(sys.argv) > 1:
        # 查看指定集合
        index_id = sys.argv[1]
        coll = client.get_collection(name=index_id)
        inspect_collection(coll, limit=10)
        
        # 如果有第三个参数，进行相似度搜索
        if len(sys.argv) > 2:
            query = sys.argv[2]
            search_similar(coll, query)
    else:
        # 列出所有集合
        print("\n可用集合:")
        for i, coll in enumerate(collections):
            print(f"  {i+1}. {coll.name} ({coll.count()} 文档)")

        # 显示第一个集合的详情
        if collections:
            inspect_collection(collections[0], limit=5)


if __name__ == "__main__":
    main()
