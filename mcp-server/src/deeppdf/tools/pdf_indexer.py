import hashlib
import json
import time
from pathlib import Path
from typing import Dict, Any, List
from ..pageindex.integration import PageIndexWrapper
from ..pageindex.integration import get_pdf_page_tokens
from ..storage.chroma_store import ChromaStore


class PDFIndexError(Exception):
    """PDF 索引错误"""
    pass


def index_pdf(pdf_path: str, storage_dir: str) -> Dict[str, Any]:
    """
    索引 PDF 文件

    Args:
        pdf_path: PDF 文件路径
        storage_dir: 存储目录

    Returns:
        索引结果，包含 index_id, node_count, status
    """
    pdf_path_obj = Path(pdf_path)

    # 验证文件存在
    if not pdf_path_obj.exists():
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    # 验证文件大小（避免空文件）
    if pdf_path_obj.stat().st_size < 1024:
        return {
            "status": "error",
            "error": "PDF file is too small (< 1KB)"
        }

    # 生成索引 ID（基于文件名和时间的 hash）
    file_hash = hashlib.md5(
        f"{pdf_path_obj.name}{time.time()}".encode()
    ).hexdigest()[:12]
    index_id = f"idx_{file_hash}"

    try:
        # 1. 使用 PageIndex 获取页面内容（按页分段）
        # 使用默认模型进行 token 计算
        page_tokens = get_pdf_page_tokens(pdf_path)

        if not page_tokens:
            return {
                "status": "error",
                "error": "No text extracted from PDF"
            }

        # 2. 转换为 sections 格式
        structured_sections = []
        for page_num, (text, token_count) in enumerate(page_tokens):
            if text and text.strip():
                structured_sections.append({
                    "id": f"page_{page_num + 1}",
                    "text": text.strip(),
                    "metadata": {
                        "page": page_num + 1,
                        "total_pages": len(page_tokens),
                        "token_count": token_count
                    }
                })

        if not structured_sections:
            return {
                "status": "error",
                "error": "No valid text content found in PDF"
            }

        # 3. 存储到 ChromaDB
        storage_dir_path = Path(storage_dir)
        chroma_dir = storage_dir_path / "chroma"
        chroma_dir.mkdir(parents=True, exist_ok=True)

        store = ChromaStore(persist_directory=str(chroma_dir))
        store.create_collection(
            name=index_id,
            metadata={
                "pdf_name": pdf_path_obj.name,
                "pdf_path": str(pdf_path_obj.absolute()),
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "node_count": len(structured_sections)
            }
        )

        # 添加文档
        documents = [
            {
                "id": section["id"],
                "text": section["text"],
                "metadata": {
                    **section["metadata"],
                    "pdf_name": pdf_path_obj.name
                }
            }
            for section in structured_sections
        ]
        store.add_documents(index_id, documents)

        # 4. 保存索引元数据
        index_dir = storage_dir_path / "indexes"
        index_dir.mkdir(parents=True, exist_ok=True)

        metadata_path = index_dir / f"{index_id}.json"
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump({
                "id": index_id,
                "pdf_name": pdf_path_obj.name,
                "pdf_path": str(pdf_path_obj.absolute()),
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "node_count": len(structured_sections),
                "sections": structured_sections
            }, f, ensure_ascii=False, indent=2)

        return {
            "status": "success",
            "index_id": index_id,
            "node_count": len(structured_sections),
            "pdf_name": pdf_path_obj.name
        }

    except FileNotFoundError:
        return {
            "status": "error",
            "error": f"PDF file not found: {pdf_path}"
        }
    except Exception as e:
        return {
            "status": "error",
            "error": f"Unexpected error: {str(e)}"
        }
