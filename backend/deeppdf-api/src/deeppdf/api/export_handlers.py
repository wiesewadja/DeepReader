"""
API 路由定义 - 导出相关端点
"""
import asyncio
import json
from pathlib import Path
from typing import Any, Dict
from fastapi import HTTPException, status
from ..config import settings
from .export_utils import get_pdf_page_count, build_parent_mapping, format_created_at


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
                detail=f"Index '{index_id}' not found"
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

            nodes.append({
                "node_id": section.get("id", ""),
                "node_name": node_metadata.get("node_name", ""),
                "section": node_metadata.get("section", ""),
                "page_range": page_range,
                "start_index": start_index,
                "end_index": end_index,
                "level": node_metadata.get("level", 0),
                "text": original_text,
                "parent_id": parent_mapping.get(section.get("id", ""))
            })

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
            "nodes": nodes
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export index data: {str(e)}"
        )
