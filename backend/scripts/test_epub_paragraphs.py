#!/usr/bin/env python3
"""
EPUB 段落向量化测试脚本

仅测试段落提取和向量化功能，不涉及 LLM。

用法:
    cd backend
    uv run python scripts/test_epub_paragraphs.py <epub_path> [--store]

参数:
    epub_path: EPUB 文件路径
    --store: 可选，将结果存储到 ChromaDB（默认只预览不存储）
"""

import argparse
import sys
import time
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent / "deeppdf-api" / "src"))
sys.path.insert(0, str(Path(__file__).parent.parent / "pageindex-lib" / "src"))

from deeppdf.services.indexer import (
    _extract_all_paragraphs,
    _split_text_to_chunks,
    _store_to_chromadb,
    PARAGRAPH_CHUNK_TARGET,
    PARAGRAPH_CHUNK_MAX,
)
from pageindex.epub_parser import EpubParser
from pageindex.epub_to_tree import epub_to_tree


def parse_epub(epub_path: str):
    """解析 EPUB 文件，返回结构列表（不使用 LLM）"""
    print(f"\n{'='*60}")
    print(f"步骤 1: 解析 EPUB")
    print(f"{'='*60}")
    print(f"文件: {epub_path}")

    epub_path = Path(epub_path)
    start_time = time.time()

    # 直接使用 EpubParser 解析
    parser = EpubParser(str(epub_path), extract_images=False)
    parser.load()
    chapters = parser.get_chapters()

    print(f"提取章节: {len(chapters)} 章")

    # 转换为树结构
    metadata = parser.get_metadata()
    toc = parser.get_toc()

    # 构造 epub_data 字典
    epub_data = {
        "metadata": metadata,
        "toc": toc,
        "chapters": chapters,
    }
    tree = epub_to_tree(epub_data)

    parse_time = time.time() - start_time
    print(f"解析完成，耗时: {parse_time:.2f} 秒")

    # 从 tree 中获取 structure 和 doc_name
    structure = tree.get("structure", [])
    doc_name = tree.get("doc_name", epub_path.stem)
    print(f"顶层结构数: {len(structure)}")
    print(f"文档名: {doc_name}")

    return structure, doc_name


def extract_paragraphs(structure, doc_name):
    """提取段落 chunks"""
    print(f"\n{'='*60}")
    print(f"步骤 2: 提取段落")
    print(f"{'='*60}")

    start_time = time.time()
    chunks = _extract_all_paragraphs(structure, "epub", doc_name)
    extract_time = time.time() - start_time

    print(f"提取完成，耗时: {extract_time:.2f} 秒")
    print(f"总 chunks: {len(chunks)}")

    # 统计
    type_count = {}
    block_ids = set()
    sections = set()

    for c in chunks:
        m = c['metadata']
        block_ids.add(m['block_id'])
        sections.add(m['parent_section'])

        # 统计 chunk 分布
        total = m['total_chunks']
        type_count[total] = type_count.get(total, 0) + 1

    print(f"唯一 block_id: {len(block_ids)}")
    print(f"唯一 section: {len(sections)}")
    print(f"每段落 chunk 数分布: {dict(sorted(type_count.items()))}")

    return chunks


def preview_chunks(chunks, limit=10):
    """预览 chunks"""
    print(f"\n{'='*60}")
    print(f"步骤 3: 预览数据")
    print(f"{'='*60}")

    for i, c in enumerate(chunks[:limit]):
        m = c['metadata']
        print(f"\n--- Chunk {i+1} ---")
        print(f"ID: {c['id']}")
        print(f"block_id: {m['block_id']}")
        print(f"section: {m['parent_section'][:50]}...")
        print(f"page: {m['page']}")
        print(f"chunk: {m['chunk_index']+1}/{m['total_chunks']}")
        print(f"text ({len(c['text'])} 字): {c['text'][:100]}...")

        if m['total_chunks'] > 1:
            print(f"full_paragraph ({len(m['full_paragraph'])} 字): {m['full_paragraph'][:80]}...")


def export_chunks(chunks, output_path, doc_name):
    """导出 chunks 到文件"""
    import json

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    # 构建导出数据
    export_data = {
        "doc_name": doc_name,
        "total_chunks": len(chunks),
        "chunks": []
    }

    for c in chunks:
        m = c['metadata']
        export_data["chunks"].append({
            "id": c['id'],
            "text": c['text'],
            "metadata": {
                "block_id": m['block_id'],
                "parent_section": m['parent_section'],
                "page": m['page'],
                "chunk_index": m['chunk_index'],
                "total_chunks": m['total_chunks'],
                "full_paragraph": m.get('full_paragraph', ''),
            }
        })

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(export_data, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*60}")
    print(f"导出完成")
    print(f"{'='*60}")
    print(f"文件: {output_file}")
    print(f"大小: {output_file.stat().st_size / 1024:.1f} KB")


def store_to_chromadb(chunks, doc_name, storage_dir):
    """存储到 ChromaDB"""
    print(f"\n{'='*60}")
    print(f"步骤 4: 存储到 ChromaDB")
    print(f"{'='*60}")

    import hashlib
    import os

    # 生成测试索引 ID
    index_id = f"test_{hashlib.md5(doc_name.encode()).hexdigest()[:8]}"

    # 构造虚拟的 section_nodes（空列表，只测试段落）
    storage_path = Path(storage_dir)
    chroma_dir = storage_path / "chroma"
    chroma_dir.mkdir(parents=True, exist_ok=True)

    start_time = time.time()
    vector_time, paragraph_count = _store_to_chromadb(
        section_nodes=[],  # 不存储章节摘要
        index_id=index_id,
        pdf_path_obj=Path(doc_name),  # 虚拟路径
        storage_dir=storage_dir,
        doc_type="epub",
        progress_callback=lambda step, pct, msg: print(f"  [{pct}%] {step}: {msg}"),
        original_filename=f"{doc_name}.epub",
        paragraph_chunks=chunks,
    )

    print(f"\n存储完成:")
    print(f"  索引 ID: {index_id}")
    print(f"  向量化耗时: {vector_time:.2f} 秒")
    print(f"  段落数: {paragraph_count}")
    print(f"  存储位置: {chroma_dir}")

    return index_id


def verify_storage(index_id, storage_dir):
    """验证存储结果"""
    print(f"\n{'='*60}")
    print(f"步骤 5: 验证存储")
    print(f"{'='*60}")

    import chromadb

    chroma_dir = Path(storage_dir) / "chroma"
    # 使用与 indexer 相同的设置，避免缓存冲突
    client = chromadb.PersistentClient(
        path=str(chroma_dir),
        settings=chromadb.Settings(anonymized_telemetry=False)
    )

    try:
        coll = client.get_collection(name=index_id)
    except Exception as e:
        print(f"获取集合失败: {e}")
        return

    print(f"集合: {coll.name}")
    print(f"文档数: {coll.count()}")

    # 获取样本
    result = coll.get(limit=3, include=['documents', 'metadatas'])

    for i, (doc, meta) in enumerate(zip(result['documents'], result['metadatas'])):
        print(f"\n--- 文档 {i+1} ---")
        print(f"type: {meta.get('type')}")
        print(f"block_id: {meta.get('block_id')}")
        print(f"section: {str(meta.get('parent_section', ''))[:50]}...")
        if meta.get('full_paragraph'):
            print(f"full_paragraph: {meta['full_paragraph'][:50]}...")
        print(f"text: {doc[:80]}...")


def main():
    parser = argparse.ArgumentParser(description="EPUB 段落向量化测试")
    parser.add_argument("epub_path", help="EPUB 文件路径")
    parser.add_argument("--store", action="store_true", help="存储到 ChromaDB")
    parser.add_argument("--storage-dir", default="data", help="存储目录")
    parser.add_argument("--output", "-o", help="导出解析数据到 JSON 文件")
    args = parser.parse_args()

    epub_path = Path(args.epub_path)
    if not epub_path.exists():
        print(f"错误: 文件不存在 - {epub_path}")
        sys.exit(1)

    # 1. 解析 EPUB
    structure, doc_name = parse_epub(str(epub_path))

    # 2. 提取段落
    chunks = extract_paragraphs(structure, doc_name)

    # 3. 预览
    preview_chunks(chunks)

    # 3.5 导出（可选）
    if args.output:
        export_chunks(chunks, args.output, doc_name)

    # 4. 存储（可选）
    if args.store:
        index_id = store_to_chromadb(chunks, doc_name, args.storage_dir)
        verify_storage(index_id, args.storage_dir)
    else:
        print(f"\n{'='*60}")
        print("提示: 使用 --store 参数将结果存储到 ChromaDB")
        print(f"{'='*60}")


if __name__ == "__main__":
    main()
