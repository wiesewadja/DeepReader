import hashlib
import json
import time
from pathlib import Path
from typing import Dict, Any
from .pdf_parser import PDFParser, PDFParseError
from ..pageindex.integration import PageIndexWrapper
from ..storage.chroma_store import ChromaStore


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
        # 1. 解析 PDF（提取原始文本）
        parser = PDFParser()
        raw_sections = parser.extract_sections(pdf_path)

        if not raw_sections:
            return {
                "status": "error",
                "error": "No text extracted from PDF"
            }

        # 2. 使用 PageIndex 进行智能分段
        try:
            # 初始化 PageIndex（使用 mock 配置，不需要 API key）
            pageindex = PageIndexWrapper(
                pdf_path=str(pdf_path_obj),
                llm_provider="mock"  # 使用 mock 模式进行测试
            )

            # 使用 PageIndex 解析结构化内容
            pageindex_result = pageindex.parse()

            if pageindex_result and "tree" in pageindex_result:
                # 使用 PageIndex 的结果
                structured_sections = _convert_pageindex_to_sections(pageindex_result["tree"])
            else:
                # 回退到简单的按页分割
                structured_sections = [
                    {
                        "id": f"section_{i}",
                        "text": section["text"],
                        "metadata": section.get("metadata", {})
                    }
                    for i, section in enumerate(raw_sections)
                ]
        except Exception as e:
            # PageIndex 失败，回退到简单分割
            structured_sections = [
                {
                    "id": f"section_{i}",
                    "text": section["text"],
                    "metadata": section.get("metadata", {})
                }
                for i, section in enumerate(raw_sections)
            ]

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

    except PDFParseError as e:
        return {
            "status": "error",
            "error": f"PDF parsing failed: {str(e)}"
        }
    except Exception as e:
        return {
            "status": "error",
            "error": f"Unexpected error: {str(e)}"
        }


def _convert_pageindex_to_sections(tree: Dict) -> list:
    """
    将 PageIndex 的树结构转换为 sections 列表

    Args:
        tree: PageIndex 返回的树结构

    Returns:
        sections 列表
    """
    sections = []

    def process_node(node, level=0):
        # 提取节点文本
        text = node.get("content", "")
        if not text:
            text = node.get("title", "")

        if text:
            sections.append({
                "id": node.get("id", f"section_{len(sections)}"),
                "text": text,
                "metadata": {
                    "level": level,
                    "page": node.get("page", 1),
                    "type": node.get("type", "section")
                }
            })

        # 处理子节点
        for child in node.get("children", []):
            process_node(child, level + 1)

    if "root" in tree:
        root_id = tree["root"]
        nodes = tree.get("nodes", {})

        # 找到根节点
        root_node = None
        if isinstance(nodes, list):
            for node in nodes:
                if node.get("id") == root_id:
                    root_node = node
                    break
        elif isinstance(nodes, dict):
            root_node = nodes.get(root_id)

        if root_node:
            process_node(root_node)
    elif isinstance(tree.get("nodes"), list):
        # 直接遍历节点列表
        for node in tree["nodes"]:
            process_node(node)

    return sections
