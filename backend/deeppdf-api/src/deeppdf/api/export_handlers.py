"""
API 路由定义 - 导出相关端点
"""

import asyncio
import base64
import json
import logging
from pathlib import Path
from typing import Any, Dict
from fastapi import HTTPException, status
from ..config import settings
from .export_utils import get_pdf_page_count, build_parent_mapping, format_created_at
from ..services.cover_extractor import extract_or_generate_cover, extract_pdf_cover, extract_epub_cover

logger = logging.getLogger(__name__)


async def export_index_data(index_id: str) -> Dict[str, Any]:
    """
    导出索引的节点数据,供前端生成 Markdown

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

        # 提取节点数据
        nodes = []
        tree_structure = metadata.get("tree_structure", {}).get("structure", [])

        # 在循环外构建一次父子映射（性能优化）
        parent_mapping = build_parent_mapping(tree_structure)

        for section in metadata.get("sections", []):
            node_metadata = section.get("metadata", {})
            start_index = node_metadata.get("start_index", "?")
            end_index = node_metadata.get("end_index", "?")

            # 格式化页码范围
            if str(start_index) == str(end_index):
                page_range = str(start_index)
            else:
                page_range = f"{start_index}-{end_index}"

            # 返回原文（metadata["original_text"]），而非用于向量化的摘要（section["text"]）
            original_text = node_metadata.get("original_text", section.get("text", ""))

            nodes.append(
                {
                    "node_id": section.get("id", ""),
                    "node_name": node_metadata.get("node_name", ""),
                    "section": node_metadata.get("section", ""),
                    "page_range": page_range,
                    "start_index": start_index,
                    "end_index": end_index,
                    "level": node_metadata.get("level", 0),
                    "text": original_text,
                    "parent_id": parent_mapping.get(section.get("id", "")),
                }
            )

        # 获取总页数
        pdf_path = metadata.get("pdf_path", "")
        total_pages = get_pdf_page_count(pdf_path) if pdf_path else 0

        # 格式化创建时间
        created_at_raw = metadata.get("created_at", "")
        created_at = format_created_at(created_at_raw)

        return {
            "status": "success",
            "index_id": index_id,
            "pdf_name": metadata.get("pdf_name", ""),
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
        pdf_path = metadata.get("pdf_path", "")

        # 检查源文件是否存在
        source_file_exists = pdf_path and Path(pdf_path).exists()

        if source_file_exists:
            # 尝试从源文件提取封面
            def _extract_cover():
                cover_data, mime_type = extract_or_generate_cover(pdf_path, pdf_name)
                return cover_data, mime_type

            cover_data, mime_type = await asyncio.to_thread(_extract_cover)

            # 检查是否有自定义封面（通过尝试单独提取）
            def _check_custom_cover():
                if pdf_path.lower().endswith('.pdf'):
                    return extract_pdf_cover(pdf_path) is not None
                elif pdf_path.lower().endswith('.epub'):
                    return extract_epub_cover(pdf_path) is not None
                return False

            has_custom_cover = await asyncio.to_thread(_check_custom_cover)
        else:
            # 源文件不存在，仅使用书名生成默认封面
            logger.warning(f"[封面导出] 源文件不存在: {pdf_path}, 使用书名生成默认封面: {pdf_name}")

            def _generate_cover():
                from ..services.cover_extractor import generate_default_cover
                cover_data = generate_default_cover(pdf_name)
                return cover_data, "image/png"

            cover_data, mime_type = await asyncio.to_thread(_generate_cover)
            has_custom_cover = False

        # 转换为 base64
        cover_base64 = base64.b64encode(cover_data).decode('utf-8')

        logger.info(f"[封面导出] 成功导出封面: {pdf_name}, 自定义封面: {has_custom_cover}")

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
