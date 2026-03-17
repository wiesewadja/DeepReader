#!/usr/bin/env python3
"""
段落切分和提取测试脚本（不依赖 EPUB 解析）

直接测试段落切分和提取函数，验证数据结构。

用法:
    cd backend
    uv run python scripts/test_paragraph_extraction.py
"""

import sys
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent / "deeppdf-api" / "src"))

from deeppdf.services.indexer import (
    _extract_all_paragraphs,
    _split_text_to_chunks,
    PARAGRAPH_CHUNK_TARGET,
    PARAGRAPH_CHUNK_MAX,
)


def test_chunking():
    """测试文本切分"""
    print("=" * 70)
    print("测试 1: 文本切分")
    print("=" * 70)

    test_cases = [
        ("短文本", "这是一个短段落。" * 5),
        ("中等文本", "第一句内容。" * 60),
        ("长文本", "这是一个完整的测试句子。" * 80),
        ("超长无标点", "测试" * 600),
    ]

    for name, text in test_cases:
        chunks = _split_text_to_chunks(text)
        print(f"\n{name} ({len(text)} 字):")
        print(f"  -> {len(chunks)} chunk(s)")
        for i, c in enumerate(chunks):
            print(f"     chunk {i}: {len(c['text'])} 字, [{c['char_start']}-{c['char_end']}]")


def test_extraction():
    """测试段落提取"""
    print("\n" + "=" * 70)
    print("测试 2: 段落提取")
    print("=" * 70)

    # 模拟 PageIndex 树结构
    mock_structure = [
        {
            "title": "第一章 引言",
            "node_id": "node_001",
            "text": """这是第一章的第一段内容。这段内容描述了引言部分的主要观点，帮助读者理解本书的核心主题。在信息爆炸的时代，批判性思维是避免盲从、去伪存真、做出理性判断的关键能力。

这是第一章的第二段内容。这段相对较短，不需要切分。段落之间用双换行符分隔，符合标准的文档格式。

这是第一章的第三段内容。每一段都会生成一个唯一的 block_id，用于 Obsidian 的块引用功能。这样用户可以直接引用特定段落，而不是整个章节。""",
            "start_index": 1,
            "nodes": [
                {
                    "title": "1.1 子章节",
                    "node_id": "node_001_001",
                    "text": "这是子章节的内容。子章节的段落也会被提取，并且会记录父级章节信息，方便用户追溯上下文。",
                    "start_index": 3,
                    "nodes": []
                }
            ]
        },
        {
            "title": "第二章 方法",
            "node_id": "node_002",
            "text": "第二章的内容，这是一个非常长的段落。" * 50,  # 约 600 字
            "start_index": 5,
            "nodes": []
        }
    ]

    chunks = _extract_all_paragraphs(mock_structure, "epub", "测试文档")

    print(f"\n提取结果:")
    print(f"  总 chunks: {len(chunks)}")

    # 统计
    block_ids = set()
    for c in chunks:
        block_ids.add(c['metadata']['block_id'])

    print(f"  唯一 block_id: {len(block_ids)}")

    # 显示详细数据
    print(f"\n详细数据:")
    for i, c in enumerate(chunks):
        m = c['metadata']
        print(f"\n--- Chunk {i+1} ---")
        print(f"ID: {c['id']}")
        print(f"type: {m['type']}")
        print(f"block_id: {m['block_id']}")
        print(f"section: {m['parent_section']}")
        print(f"page: {m['page']}")
        print(f"chunk: {m['chunk_index']+1}/{m['total_chunks']}")
        print(f"text ({len(c['text'])} 字): {c['text'][:80]}...")

        if m['total_chunks'] > 1:
            print(f"full_paragraph ({len(m['full_paragraph'])} 字): {m['full_paragraph'][:60]}...")


def test_chromadb_metadata():
    """测试 ChromaDB 元数据格式"""
    print("\n" + "=" * 70)
    print("测试 3: ChromaDB 元数据格式")
    print("=" * 70)

    # 模拟一个 chunk 的 metadata
    sample_metadata = {
        "type": "paragraph",
        "block_id": "^ch0-p1",
        "chunk_index": 0,
        "total_chunks": 1,
        "full_paragraph": "这是完整的段落内容，用于 Obsidian 块引用显示...",
        "parent_node_id": "node_001",
        "parent_section": "第一章 引言",
        "page": 1,
        "paragraph_index": 1,
        "char_start": 0,
        "char_end": 100,
        "pdf_name": "测试文档",
    }

    print("\n段落 chunk 元数据字段:")
    for key, value in sample_metadata.items():
        if isinstance(value, str) and len(value) > 50:
            print(f"  {key}: {value[:50]}... (共 {len(value)} 字)")
        else:
            print(f"  {key}: {value}")

    # 对比章节 chunk 的 metadata
    section_metadata = {
        "type": "section",
        "section": "第一章 引言",
        "level": 0,
        "page": 1,
        "start_index": 1,
        "end_index": 5,
        "node_name": "引言",
        "node_id": "node_001",
        "pdf_name": "测试文档",
    }

    print("\n章节 chunk 元数据字段:")
    for key, value in section_metadata.items():
        print(f"  {key}: {value}")


def main():
    print("段落向量化功能测试")
    print("=" * 70)

    test_chunking()
    test_extraction()
    test_chromadb_metadata()

    print("\n" + "=" * 70)
    print("✅ 所有测试完成")
    print("=" * 70)


if __name__ == "__main__":
    main()
