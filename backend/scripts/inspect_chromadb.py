#!/usr/bin/env python3
"""
ChromaDB 内容查看脚本

用法:
    uv run python scripts/inspect_chromadb.py                    # 列出所有集合
    uv run python scripts/inspect_chromadb.py <collection_name>  # 查看指定集合
    uv run python scripts/inspect_chromadb.py <name> --stats     # 仅显示统计
    uv run python scripts/inspect_chromadb.py <name> --sample 20 # 显示更多样本
"""

import argparse
import sys
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent / "deeppdf-api" / "src"))

import chromadb


def list_collections(client: chromadb.Client):
    """列出所有集合"""
    collections = client.list_collections()
    
    print("=" * 60)
    print("ChromaDB 集合列表")
    print("=" * 60)
    print(f"{'集合名称':<40} {'记录数':>10}")
    print("-" * 60)
    
    total = 0
    for coll in collections:
        count = coll.count()
        total += count
        print(f"{coll.name:<40} {count:>10}")
    
    print("-" * 60)
    print(f"{'总计':<40} {total:>10}")
    print("=" * 60)


def show_collection_stats(coll: chromadb.Collection):
    """显示集合统计信息"""
    print("\n" + "=" * 60)
    print(f"集合: {coll.name}")
    print("=" * 60)
    print(f"总记录数: {coll.count()}")
    
    # 获取所有 metadata
    result = coll.get(include=['metadatas'])
    metas = result['metadatas']
    
    if not metas:
        print("集合为空")
        return
    
    # 统计类型
    print("\n--- 类型统计 ---")
    type_counts = {}
    for m in metas:
        t = m.get('type', 'unknown')
        type_counts[t] = type_counts.get(t, 0) + 1
    
    for t, c in sorted(type_counts.items()):
        print(f"  {t}: {c}")
    
    # 统计 block_id
    print("\n--- block_id 统计 ---")
    has_block_id = sum(1 for m in metas if m.get('block_id'))
    print(f"  有 block_id: {has_block_id}")
    print(f"  无 block_id: {len(metas) - has_block_id}")
    
    # 统计 node_id
    print("\n--- node_id 统计 ---")
    has_node_id = sum(1 for m in metas if m.get('node_id'))
    print(f"  有 node_id: {has_node_id}")
    print(f"  无 node_id: {len(metas) - has_node_id}")
    
    # 显示 metadata 字段
    print("\n--- Metadata 字段 ---")
    all_keys = set()
    for m in metas:
        all_keys.update(m.keys())
    
    for key in sorted(all_keys):
        # 统计该字段有多少记录有值
        count = sum(1 for m in metas if m.get(key) is not None)
        print(f"  {key}: {count}/{len(metas)} 条记录有值")


def show_sample_data(coll: chromadb.Collection, limit: int = 10):
    """显示样本数据"""
    print("\n" + "=" * 60)
    print(f"样本数据 (前 {limit} 条)")
    print("=" * 60)
    
    result = coll.get(limit=limit, include=['metadatas', 'documents'])
    
    for i, (doc, meta) in enumerate(zip(result['documents'], result['metadatas'])):
        print(f"\n[{i+1}]")
        print(f"  type: {meta.get('type', 'unknown')}")
        print(f"  block_id: {meta.get('block_id', '无')}")
        print(f"  node_id: {meta.get('node_id', '无')}")
        print(f"  parent_node_id: {meta.get('parent_node_id', '无')}")
        print(f"  section: {meta.get('section', '无')[:50]}..." if meta.get('section') else "  section: 无")
        print(f"  page: {meta.get('page', '无')}")
        
        # 文本预览
        text_preview = doc[:150].replace('\n', ' ') if doc else "无"
        print(f"  文本预览: {text_preview}...")


def search_by_block_id(coll: chromadb.Collection, block_id: str):
    """按 block_id 搜索"""
    print(f"\n搜索 block_id: {block_id}")
    print("-" * 60)
    
    result = coll.get(
        where={"block_id": block_id},
        include=['metadatas', 'documents']
    )
    
    if not result['ids']:
        print("未找到匹配记录")
        return
    
    for i, (doc, meta) in enumerate(zip(result['documents'], result['metadatas'])):
        print(f"\n[{i+1}]")
        for key, value in meta.items():
            print(f"  {key}: {value}")
        print(f"\n  文本内容:")
        print(f"  {doc[:500]}..." if len(doc) > 500 else f"  {doc}")


def search_by_parent_node(coll: chromadb.Collection, parent_node_id: str):
    """按 parent_node_id 搜索"""
    print(f"\n搜索 parent_node_id: {parent_node_id}")
    print("-" * 60)
    
    result = coll.get(
        where={"parent_node_id": parent_node_id},
        include=['metadatas', 'documents']
    )
    
    if not result['ids']:
        print("未找到匹配记录")
        return
    
    print(f"找到 {len(result['ids'])} 条记录")
    
    for i, (doc, meta) in enumerate(zip(result['documents'][:5], result['metadatas'][:5])):
        print(f"\n[{i+1}] block_id: {meta.get('block_id')}")
        print(f"    文本预览: {doc[:100]}...")
    
    if len(result['ids']) > 5:
        print(f"\n... 还有 {len(result['ids']) - 5} 条记录")


def main():
    parser = argparse.ArgumentParser(description="查看 ChromaDB 内容")
    parser.add_argument("collection", nargs="?", help="集合名称")
    parser.add_argument("--stats", action="store_true", help="仅显示统计信息")
    parser.add_argument("--sample", type=int, default=10, help="显示样本数量 (默认: 10)")
    parser.add_argument("--block-id", help="按 block_id 搜索")
    parser.add_argument("--parent-node", help="按 parent_node_id 搜索")
    
    args = parser.parse_args()
    
    # 连接 ChromaDB
    chroma_path = Path(__file__).parent.parent / "data" / "chroma"
    client = chromadb.PersistentClient(path=str(chroma_path))
    
    if not args.collection:
        # 列出所有集合
        list_collections(client)
        return
    
    # 获取指定集合
    try:
        coll = client.get_collection(args.collection)
    except Exception as e:
        print(f"错误: 集合 '{args.collection}' 不存在")
        print("\n可用集合:")
        for c in client.list_collections():
            print(f"  - {c.name}")
        return
    
    # 搜索模式
    if args.block_id:
        search_by_block_id(coll, args.block_id)
        return
    
    if args.parent_node:
        search_by_parent_node(coll, args.parent_node)
        return
    
    # 显示统计
    show_collection_stats(coll)
    
    # 显示样本
    if not args.stats:
        show_sample_data(coll, args.sample)


if __name__ == "__main__":
    main()