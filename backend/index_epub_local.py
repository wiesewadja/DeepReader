#!/usr/bin/env python3
"""
本地 EPUB 索引脚本

功能：
1. 解析 EPUB 文件结构
2. 提取章节文本
3. 提取段落并生成 block_id
4. 向量化并存储到 ChromaDB
5. 保存元数据

不使用 LLM，纯本地处理。
"""

import os
import sys
import json
import time
import hashlib
import re
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from ebooklib import epub
from bs4 import BeautifulSoup

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent / "deeppdf-api" / "src"))

from deeppdf.storage.chroma_store import ChromaStore


class LocalEPUBIndexer:
    """本地 EPUB 索引器"""

    def __init__(self, storage_dir: str = "./data"):
        self.storage_dir = Path(storage_dir)
        self.chroma_dir = self.storage_dir / "chroma"
        self.indexes_dir = self.storage_dir / "indexes"

        # 确保目录存在
        self.chroma_dir.mkdir(parents=True, exist_ok=True)
        self.indexes_dir.mkdir(parents=True, exist_ok=True)

        # 初始化向量存储
        self.store = ChromaStore(persist_directory=str(self.chroma_dir))

    def parse_epub(self, epub_path: str) -> Tuple[List[Dict], List[Dict]]:
        """
        解析 EPUB 文件

        Returns:
            chapters: 章节列表
            paragraphs: 段落列表
        """
        print(f"\n[1] 解析 EPUB: {epub_path}")

        book = epub.read_epub(epub_path)
        book_name = Path(epub_path).stem

        # 获取所有文档项（按顺序）
        items = list(book.get_items_of_type(9))  # 9 = ITEM_DOCUMENT

        print(f"    找到 {len(items)} 个文档项")

        chapters = []
        paragraphs = []
        chapter_index = 0

        for item in items:
            # 解析 HTML
            soup = BeautifulSoup(item.get_content(), 'html.parser')

            # 获取标题
            title_tag = soup.find(['h1', 'h2', 'h3', 'title'])
            title = title_tag.get_text().strip() if title_tag else f"Chapter {chapter_index + 1}"

            # 清理标题（移除多余空格和特殊字符）
            title = re.sub(r'\s+', ' ', title)
            title = title[:100]  # 限制长度

            # 获取正文内容
            # 移除脚本和样式
            for script in soup(["script", "style"]):
                script.decompose()

            text = soup.get_text()

            # 清理文本
            lines = [line.strip() for line in text.split('\n') if line.strip()]
            text = '\n'.join(lines)

            if len(text) < 50:  # 跳过太短的章节
                continue

            # 生成节点 ID
            node_id = f"{chapter_index:04d}"

            # 添加章节
            chapter = {
                "id": f"ch_{node_id}",
                "text": text[:2000],  # 限制章节文本长度
                "metadata": {
                    "section": title,
                    "node_name": title,
                    "node_id": node_id,
                    "level": 0,
                    "page": chapter_index + 1,
                    "type": "section",
                    "pdf_name": book_name,
                }
            }
            chapters.append(chapter)

            # 提取段落
            para_list = self._extract_paragraphs(text, node_id, title, chapter_index, book_name)
            paragraphs.extend(para_list)

            print(f"    章节 {chapter_index + 1}: {title[:50]}... ({len(para_list)} 段落)")

            chapter_index += 1

        print(f"\n    总计: {len(chapters)} 章节, {len(paragraphs)} 段落")

        return chapters, paragraphs

    def _extract_paragraphs(
        self,
        text: str,
        node_id: str,
        section_title: str,
        chapter_index: int,
        book_name: str
    ) -> List[Dict]:
        """从文本中提取段落"""
        paragraphs = []

        # 按双换行分割段落
        para_texts = re.split(r'\n\s*\n', text)

        for para_idx, para_text in enumerate(para_texts):
            para_text = para_text.strip()

            if len(para_text) < 20:  # 跳过太短的段落
                continue

            # 生成 block_id
            block_id = f"^ch{chapter_index}-p{para_idx}"

            # 如果段落太长，切分成 chunks
            chunks = self._split_paragraph(para_text, max_length=500)

            for chunk_idx, chunk in enumerate(chunks):
                chunk_id = f"{node_id}_p{para_idx}-c{chunk_idx}"

                # 构建元数据（确保没有 None 值）
                metadata = {
                    "type": "paragraph",
                    "block_id": block_id,
                    "chunk_index": chunk_idx,
                    "total_chunks": len(chunks),
                    "full_paragraph": para_text if chunk_idx == 0 else "",
                    "parent_node_id": node_id,
                    "parent_section": section_title,
                    "page": chapter_index + 1,
                    "paragraph_index": para_idx,
                    "pdf_name": book_name,
                }

                # 移除空字符串的 optional 字段
                if chunk_idx > 0:
                    del metadata["full_paragraph"]

                paragraph = {
                    "id": chunk_id,
                    "text": chunk,
                    "metadata": metadata,
                }
                paragraphs.append(paragraph)

        return paragraphs

    def _split_paragraph(self, text: str, max_length: int = 500) -> List[str]:
        """切分长段落"""
        if len(text) <= max_length:
            return [text]

        chunks = []
        sentences = re.split(r'([。！？.!?])', text)

        current_chunk = ""
        for i in range(0, len(sentences), 2):
            sentence = sentences[i]
            if i + 1 < len(sentences):
                sentence += sentences[i + 1]  # 添加标点

            if len(current_chunk) + len(sentence) > max_length:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = sentence
            else:
                current_chunk += sentence

        if current_chunk:
            chunks.append(current_chunk.strip())

        return chunks

    def create_index(
        self,
        epub_path: str,
        index_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """创建索引"""

        epub_path = Path(epub_path)
        if not epub_path.exists():
            raise FileNotFoundError(f"EPUB 文件不存在: {epub_path}")

        book_name = epub_path.stem

        # 生成索引 ID
        if not index_id:
            index_id = f"idx_{int(time.time())}_{hashlib.md5(book_name.encode()).hexdigest()[:8]}"

        print(f"\n{'='*60}")
        print(f"创建索引: {book_name}")
        print(f"索引 ID: {index_id}")
        print(f"{'='*60}")

        # 1. 解析 EPUB
        chapters, paragraphs = self.parse_epub(str(epub_path))

        if not paragraphs:
            raise ValueError("未提取到任何段落")

        # 2. 创建集合
        print(f"\n[2] 创建向量集合...")

        collection_metadata = {
            "doc_type": "epub",
            "pdf_name": book_name,
            "pdf_path": str(epub_path.absolute()),
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "node_count": len(chapters),
            "paragraph_count": len(paragraphs),
            "indexing_method": "local_script",
            "llm_enabled": False,
        }

        self.store.create_collection(name=index_id, metadata=collection_metadata)
        print(f"    集合创建成功")

        # 3. 存储段落向量（只存储段落，不存储章节）
        print(f"\n[3] 存储段落向量...")

        start_time = time.time()
        self.store.add_documents(index_id, paragraphs)
        embed_time = time.time() - start_time

        print(f"    存储 {len(paragraphs)} 个段落")
        print(f"    耗时: {embed_time:.2f} 秒")

        # 4. 保存元数据
        print(f"\n[4] 保存元数据...")

        # 构建树结构（用于标题匹配）
        tree_structure = {
            "structure": [
                {
                    "title": ch["metadata"]["section"],
                    "node_id": ch["metadata"]["node_id"],
                    "start_index": ch["metadata"]["page"],
                    "end_index": ch["metadata"]["page"],
                    "text": ch["text"],
                    "nodes": []
                }
                for ch in chapters
            ]
        }

        metadata = {
            "id": index_id,
            "doc_type": "epub",
            "pdf_name": book_name,
            "pdf_path": str(epub_path.absolute()),
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "node_count": len(chapters),
            "paragraph_count": len(paragraphs),
            "indexing_method": "local_script",
            "llm_enabled": False,
            "tree_structure": tree_structure,
            "sections": chapters,
            "total_pages": len(chapters),
        }

        # 保存到文件
        metadata_path = self.indexes_dir / f"{index_id}.json"
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)

        print(f"    元数据保存到: {metadata_path}")

        # 5. 返回结果
        print(f"\n{'='*60}")
        print("索引创建完成!")
        print(f"{'='*60}")
        print(f"  索引 ID: {index_id}")
        print(f"  书籍名称: {book_name}")
        print(f"  章节数: {len(chapters)}")
        print(f"  段落数: {len(paragraphs)}")
        print(f"  总耗时: {embed_time:.2f} 秒")

        return {
            "status": "success",
            "index_id": index_id,
            "pdf_name": book_name,
            "node_count": len(chapters),
            "paragraph_count": len(paragraphs),
        }

    def query(
        self,
        index_id: str,
        query: str,
        max_results: int = 5,
        scope_node_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """查询索引"""
        print(f"\n[查询] index_id={index_id}, query='{query}'")
        if scope_node_ids:
            print(f"       scope={scope_node_ids}")

        # 构建查询参数
        query_params = {
            "collection_name": index_id,
            "query_texts": [query],
            "n_results": max_results * 2 if scope_node_ids else max_results,
        }

        # 范围过滤
        if scope_node_ids:
            if len(scope_node_ids) == 1:
                query_params["where"] = {"parent_node_id": scope_node_ids[0]}
            else:
                query_params["where"] = {
                    "$or": [{"parent_node_id": nid} for nid in scope_node_ids]
                }

        # 执行查询
        results = self.store.query(**query_params)

        # 格式化结果
        formatted_results = []
        if results["ids"] and results["ids"][0]:
            for i, doc_id in enumerate(results["ids"][0]):
                distances = results.get("distances", [])
                distance = distances[0][i] if distances and distances[0] else None

                metadata = results["metadatas"][0][i] if results["metadatas"] else {}
                if distance is not None:
                    metadata["distance"] = distance

                text = results["documents"][0][i] if results["documents"] else ""

                formatted_results.append({
                    "text": text,
                    "metadata": metadata,
                })

        print(f"       返回 {len(formatted_results)} 个结果")

        return {
            "status": "success",
            "results": formatted_results[:max_results],
        }


def main():
    import argparse

    parser = argparse.ArgumentParser(description="本地 EPUB 索引工具")
    parser.add_argument("epub_path", help="EPUB 文件路径")
    parser.add_argument("--index-id", help="指定索引 ID")
    parser.add_argument("--storage-dir", default="./data", help="存储目录")
    parser.add_argument("--query", help="创建索引后执行查询")
    parser.add_argument("--scope", help="范围锁定的 node_id（逗号分隔）")

    args = parser.parse_args()

    # 创建索引器
    indexer = LocalEPUBIndexer(storage_dir=args.storage_dir)

    # 创建索引
    result = indexer.create_index(args.epub_path, index_id=args.index_id)

    if args.query:
        index_id = result["index_id"]
        scope_node_ids = args.scope.split(",") if args.scope else None

        # 执行查询
        query_result = indexer.query(
            index_id=index_id,
            query=args.query,
            scope_node_ids=scope_node_ids
        )

        print("\n" + "="*60)
        print("查询结果:")
        print("="*60)

        for i, r in enumerate(query_result["results"]):
            metadata = r["metadata"]
            result_type = metadata.get("type", "unknown")

            print(f"\n[{i+1}] 类型: {result_type}")

            if result_type == "paragraph":
                print(f"    block_id: {metadata.get('block_id')}")
                print(f"    parent: {metadata.get('parent_node_id')}")
                print(f"    章节: {metadata.get('parent_section')}")
            else:
                print(f"    node_id: {metadata.get('node_id')}")
                print(f"    章节: {metadata.get('section')}")

            text = r["text"]
            preview = text[:100] + "..." if len(text) > 100 else text
            print(f"    内容: {preview}")


if __name__ == "__main__":
    main()
