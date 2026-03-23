"""
API 路由定义 - 导出相关端点
"""

import asyncio
import base64
import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional
from fastapi import HTTPException, status
from ..config import settings
from .export_utils import get_pdf_page_count, build_parent_mapping, format_created_at
from ..services.cover_extractor import (
    extract_or_generate_cover,
    extract_pdf_cover,
    extract_epub_cover,
)
from ..services.text_formatter import TextFormatter
from ..utils.llm_client import get_llm_client

logger = logging.getLogger(__name__)


def get_source_file_path(
    metadata: Dict[str, Any], storage_dir: Path
) -> Optional[str]:
    """
    从元数据获取源文件路径（优先从 uploads 目录获取）

    Args:
        metadata: 索引元数据
        storage_dir: 存储目录路径

    Returns:
        文件路径，如果找不到返回 None
    """
    pdf_path = metadata.get("pdf_path", "")

    # 1. 检查 pdf_path 是否在 uploads 目录内（后端管理的文件）
    if pdf_path:
        pdf_path_obj = Path(pdf_path)
        uploads_dir = storage_dir / "uploads"

        try:
            is_in_uploads = (
                uploads_dir in pdf_path_obj.parents
                or pdf_path_obj.parent == uploads_dir
            )
        except (ValueError, TypeError):
            is_in_uploads = False

        # 如果在 uploads 目录内或文件存在，直接使用
        if is_in_uploads and pdf_path_obj.exists():
            return pdf_path
        elif pdf_path_obj.exists():
            return pdf_path

    # 2. 通过 file_id 或 file_name 从 uploads 目录查找
    file_id = metadata.get("file_id", "")
    file_name = metadata.get("file_name", "")

    files_meta_dir = storage_dir / "files_meta"
    uploads_dir = storage_dir / "uploads"

    # 2.1 如果有 file_id，直接使用
    if file_id:
        ext = ".epub" if file_name.lower().endswith(".epub") else ".pdf"
        candidate = uploads_dir / f"{file_id}{ext}"
        if candidate.exists():
            return str(candidate)

    # 2.2 遍历 files_meta 查找匹配的文件名
    if file_name:
        for meta_file in files_meta_dir.glob("*.json"):
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    file_meta = json.load(f)
                if file_meta.get("file_name") == file_name:
                    found_file_id = file_meta.get("file_id")
                    if found_file_id:
                        ext = ".epub" if file_name.lower().endswith(".epub") else ".pdf"
                        candidate = uploads_dir / f"{found_file_id}{ext}"
                        if candidate.exists():
                            return str(candidate)
                        break
            except Exception:
                continue

    return None


async def export_index_data(
    index_id: str,
) -> Dict[str, Any]:
    """
    导出索引的节点数据,供前端生成 Markdown

    直接从 tree_structure 获取数据（EPUB 格式优先），保持原始标题

    Args:
        index_id: 索引 ID

    Returns:
        包含节点数据的字典
    """
    try:
        # 加载索引元数据
        storage_dir = Path(settings.base_dir)
        metadata_path = storage_dir / "indexes" / f"{index_id}.json"

        if not metadata_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Index '{index_id}' not found",
            )

        # 使用异步 I/O 读取文件
        def _load_metadata():
            with open(metadata_path, "r", encoding="utf-8") as f:
                return json.load(f)

        metadata = await asyncio.to_thread(_load_metadata)

        # 创建基于规则的格式化器（不使用 LLM）
        formatter = TextFormatter()

        # 优先使用 tree_structure（EPUB 格式）
        tree_structure = metadata.get("tree_structure", {})
        tree_nodes = tree_structure.get("structure", [])

        # 如果没有 tree_structure，兼容旧的 sections 格式
        use_tree_structure = bool(tree_nodes)
        if not tree_nodes:
            tree_nodes = metadata.get("sections", [])

        nodes = []

        def process_tree_node(node: Dict[str, Any]) -> Dict[str, Any]:
            """处理 tree_structure 格式的节点"""
            node_id = node.get("node_id", "")
            title = node.get("title", "")
            text = node.get("text", "")
            start_index = node.get("start_index", "?")
            end_index = node.get("end_index", "?")
            summary = node.get("summary", "")

            # 格式化页码范围
            if str(start_index) == str(end_index):
                page_range = str(start_index)
            else:
                page_range = f"{start_index}-{end_index}"

            # 格式化文本
            formatted_text = text
            if formatter and text:
                try:
                    doc_type = "epub" if metadata.get("pdf_path", "").lower().endswith(".epub") else "pdf"
                    formatted_text = formatter.format(text, doc_type)
                except Exception as e:
                    logger.warning(f"[导出] 节点格式化失败: {e}, 使用原文")

            return {
                "node_id": node_id,
                "node_name": title,
                "section": title,
                "page_range": page_range,
                "start_index": start_index,
                "end_index": end_index,
                "level": 0,
                "text": formatted_text,
                "summary": summary,
            }

        def process_section_node(section: Dict[str, Any]) -> Dict[str, Any]:
            """处理旧的 sections 格式的节点"""
            node_metadata = section.get("metadata", {})
            node_id = section.get("id", "")
            # 优先使用 node_name，否则使用 section（可能包含 ** 符号）
            title = node_metadata.get("node_name", "") or node_metadata.get("section", "")
            text = section.get("text", "")
            start_index = node_metadata.get("start_index", "?")
            end_index = node_metadata.get("end_index", "?")
            summary = node_metadata.get("summary", "")

            # 格式化页码范围
            if str(start_index) == str(end_index):
                page_range = str(start_index)
            else:
                page_range = f"{start_index}-{end_index}"

            # 格式化文本
            formatted_text = text
            if formatter and text:
                try:
                    doc_type = "epub" if metadata.get("pdf_path", "").lower().endswith(".epub") else "pdf"
                    formatted_text = formatter.format(text, doc_type)
                except Exception as e:
                    logger.warning(f"[导出] 节点格式化失败: {e}, 使用原文")

            return {
                "node_id": node_id,
                "node_name": title,
                "section": title,
                "page_range": page_range,
                "start_index": start_index,
                "end_index": end_index,
                "level": node_metadata.get("level", 0),
                "text": formatted_text,
                "summary": summary,
            }

        # 处理所有节点
        if use_tree_structure:
            for node in tree_nodes:
                processed = process_tree_node(node)
                nodes.append(processed)
        else:
            for section in tree_nodes:
                processed = process_section_node(section)
                nodes.append(processed)

        # 获取文档名称
        doc_name = tree_structure.get("doc_name", metadata.get("pdf_name", ""))

        pdf_path = metadata.get("pdf_path", "")
        total_pages = get_pdf_page_count(pdf_path) if pdf_path else 1

        # 格式化创建时间
        created_at_raw = metadata.get("created_at", "")
        created_at = format_created_at(created_at_raw)

        # 获取作者信息（EPUB 特有）
        author = metadata.get("author") or tree_structure.get("author", "")

        # 获取全书摘要
        doc_description = metadata.get("doc_description", "") or tree_structure.get("doc_description", "")

        return {
            "status": "success",
            "index_id": index_id,
            "pdf_name": doc_name,
            "author": author,
            "doc_description": doc_description,
            "total_pages": total_pages,
            "created_at": created_at,
            "nodes": nodes,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export index data: {str(e)}",
        )


async def export_cover_data(index_id: str) -> Dict[str, Any]:
    """
    导出书籍封面

    优先级：
    1. 从后端缓存的封面文件读取（cover_path）
    2. 从源文件提取封面
    3. 生成默认封面

    Args:
        index_id: 索引 ID

    Returns:
        包含封面 base64 数据的字典
    """
    try:
        # 加载索引元数据
        storage_dir = Path(settings.base_dir)
        metadata_path = storage_dir / "indexes" / f"{index_id}.json"

        if not metadata_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Index '{index_id}' not found",
            )

        # 使用异步 I/O 读取文件
        def _load_metadata():
            with open(metadata_path, "r", encoding="utf-8") as f:
                return json.load(f)

        metadata = await asyncio.to_thread(_load_metadata)

        pdf_name = metadata.get("pdf_name", "Unknown")
        cover_path = metadata.get("cover_path", "")  # 缓存的封面路径

        cover_data = None
        mime_type = "image/png"
        has_custom_cover = False

        # 优先级 0: 从临时封面文件读取（索引进行中早期提取的封面）
        # 当索引正在进行时，封面可能还未保存到最终位置
        temp_cover_path = storage_dir / "temp_cover.bin"
        if cover_data is None and temp_cover_path.exists():
            logger.debug(f"[封面导出] 从临时文件读取封面: {temp_cover_path}")

            def _read_temp_cover():
                with open(temp_cover_path, "rb") as f:
                    return f.read()

            cover_data = await asyncio.to_thread(_read_temp_cover)
            has_custom_cover = True  # 假设有自定义封面

        # 优先级 1: 从缓存的封面文件读取
        if cover_data is None and cover_path and Path(cover_path).exists():
            logger.debug(f"[封面导出] 从缓存读取封面: {cover_path}")

            def _read_cached_cover():
                with open(cover_path, "rb") as f:
                    return f.read()

            cover_data = await asyncio.to_thread(_read_cached_cover)
            # 缓存的封面可能是自定义的，尝试判断
            has_custom_cover = True  # 假设有自定义封面（因为缓存了）

        # 优先级 2: 从 uploads 目录获取源文件（使用统一辅助函数）
        actual_file_path = get_source_file_path(metadata, storage_dir)

        if cover_data is None and actual_file_path:
            logger.debug(f"[封面导出] 从源文件提取封面: {actual_file_path}")

            def _extract_cover():
                return extract_or_generate_cover(actual_file_path, pdf_name)

            cover_data, mime_type = await asyncio.to_thread(_extract_cover)

            # 检查是否有自定义封面
            def _check_custom_cover():
                if actual_file_path.lower().endswith(".pdf"):
                    return extract_pdf_cover(actual_file_path) is not None
                elif actual_file_path.lower().endswith(".epub"):
                    return extract_epub_cover(actual_file_path) is not None
                return False

            has_custom_cover = await asyncio.to_thread(_check_custom_cover)

        # 优先级 3: 生成默认封面
        if cover_data is None:
            logger.warning(
                f"[封面导出] 无法获取封面，生成默认封面: {pdf_name}"
            )

            def _generate_cover():
                from ..services.cover_extractor import generate_default_cover
                return generate_default_cover(pdf_name)

            cover_data = await asyncio.to_thread(_generate_cover)
            has_custom_cover = False

        # 转换为 base64
        cover_base64 = base64.b64encode(cover_data).decode("utf-8")

        logger.debug(
            f"[封面导出] 成功导出封面: {pdf_name}, 自定义封面: {has_custom_cover}"
        )

        return {
            "status": "success",
            "index_id": index_id,
            "pdf_name": pdf_name,
            "cover_data": cover_base64,
            "mime_type": mime_type,
            "has_custom_cover": has_custom_cover,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[封面导出] 导出失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export cover: {str(e)}",
        )
