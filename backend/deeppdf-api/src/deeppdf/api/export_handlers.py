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


async def export_index_data(
    index_id: str,
) -> Dict[str, Any]:
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

        # 创建基于规则的格式化器（不使用 LLM）
        formatter = TextFormatter()

        # 提取节点数据
        nodes = []
        tree_structure = metadata.get("tree_structure", {}).get("structure", [])

        # 在循环外构建一次父子映射（性能优化）
        parent_mapping = build_parent_mapping(tree_structure)

        # 构建 node_id -> tree_node 的映射，用于获取原文和摘要
        # tree_structure 中的 text 字段保存的是原始 OCR 文本
        # summary 字段保存的是 LLM 生成的摘要
        def build_tree_info_map(tree_nodes: list) -> dict:
            """递归构建 node_id -> {text, summary} 的映射"""
            info_map = {}
            for node in tree_nodes:
                node_id = node.get("node_id", "")
                if node_id:
                    info_map[node_id] = {
                        "text": node.get("text", ""),
                        "summary": node.get("summary", ""),
                    }
                # 递归处理子节点
                children = node.get("nodes", [])
                if children:
                    # 合并子节点的映射
                    child_map = build_tree_info_map(children)
                    info_map.update(child_map)
            return info_map

        tree_info_map = build_tree_info_map(tree_structure)

        for section in metadata.get("sections", []):
            node_metadata = section.get("metadata", {})
            start_index = node_metadata.get("start_index", "?")
            end_index = node_metadata.get("end_index", "?")

            # 格式化页码范围
            if str(start_index) == str(end_index):
                page_range = str(start_index)
            else:
                page_range = f"{start_index}-{end_index}"

            # 获取原文和摘要：优先从 tree_structure 获取
            # 这是修复现有索引数据的关键步骤
            section_id = section.get("id", "")
            tree_info = tree_info_map.get(section_id, {})
            original_text = tree_info.get("text", "")
            node_summary = tree_info.get("summary", "")

            # 如果 tree_structure 中没有原文，再尝试从 metadata 获取
            if not original_text:
                original_text = node_metadata.get("original_text", section.get("text", ""))

            # 如果 tree_structure 中没有摘要，再尝试从 metadata 获取
            if not node_summary:
                node_summary = node_metadata.get("summary", "")

            # 应用基于规则的格式化（不使用 LLM）
            formatted_text = original_text
            if formatter and original_text:
                try:
                    doc_type = "epub" if metadata.get("pdf_path", "").lower().endswith(".epub") else "pdf"
                    formatted_text = formatter.format(original_text, doc_type)
                except Exception as e:
                    logger.warning(f"[导出] 节点格式化失败: {e}, 使用原文")

            nodes.append(
                {
                    "node_id": section.get("id", ""),
                    "node_name": node_metadata.get("node_name", ""),
                    "section": node_metadata.get("section", ""),
                    "page_range": page_range,
                    "start_index": start_index,
                    "end_index": end_index,
                    "level": node_metadata.get("level", 0),
                    "text": formatted_text,
                    "summary": node_summary,  # 添加摘要字段
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
                if pdf_path.lower().endswith(".pdf"):
                    return extract_pdf_cover(pdf_path) is not None
                elif pdf_path.lower().endswith(".epub"):
                    return extract_epub_cover(pdf_path) is not None
                return False

            has_custom_cover = await asyncio.to_thread(_check_custom_cover)
        else:
            # 源文件不存在，仅使用书名生成默认封面
            logger.warning(
                f"[封面导出] 源文件不存在: {pdf_path}, 使用书名生成默认封面: {pdf_name}"
            )

            def _generate_cover():
                from ..services.cover_extractor import generate_default_cover

                cover_data = generate_default_cover(pdf_name)
                return cover_data, "image/png"

            cover_data, mime_type = await asyncio.to_thread(_generate_cover)
            has_custom_cover = False

        # 转换为 base64
        cover_base64 = base64.b64encode(cover_data).decode("utf-8")

        logger.info(
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


async def format_text_with_llm(
    index_id: str,
    node_ids: Optional[list[str]] = None,
    provider: str = "deepseek",
) -> Dict[str, Any]:
    """
    使用 LLM 重新格式化索引中的文本（可选特定节点）

    Args:
        index_id: 索引 ID
        node_ids: 要格式化的节点 ID 列表（可选，默认全部）
        provider: LLM 提供商

    Returns:
        包含格式化结果的字典
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

        # 读取元数据
        def _load_metadata():
            with open(metadata_path, "r", encoding="utf-8") as f:
                return json.load(f)

        metadata = await asyncio.to_thread(_load_metadata)

        # 创建 LLM 客户端
        try:
            llm_client, _ = get_llm_client(provider=provider)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to create LLM client: {str(e)}",
            )

        # 创建带 LLM 的格式化器
        formatter = TextFormatter(use_llm=True, llm_client=llm_client)

        # 获取文档类型
        doc_type = (
            "epub" if metadata.get("pdf_path", "").lower().endswith(".epub") else "pdf"
        )

        # 处理每个节点
        formatted_count = 0
        failed_count = 0
        formatted_nodes = []

        sections = metadata.get("sections", [])
        for section in sections:
            node_id = section.get("id", "")

            # 如果指定了节点列表，只处理指定的节点
            if node_ids and node_id not in node_ids:
                continue

            node_metadata = section.get("metadata", {})
            original_text = node_metadata.get("original_text", section.get("text", ""))

            if not original_text or len(original_text) < 100:
                continue

            try:
                # 使用 LLM 格式化
                logger.info(f"[LLM 格式化] 处理节点: {node_id}")

                def _format_text(text=original_text):
                    return formatter.format(text, doc_type)

                formatted_text = await asyncio.to_thread(_format_text)

                # 更新元数据中的文本
                node_metadata["original_text"] = formatted_text
                formatted_count += 1

                formatted_nodes.append(
                    {
                        "node_id": node_id,
                        "section": node_metadata.get("section", ""),
                        "success": True,
                    }
                )

            except Exception as e:
                logger.error(f"[LLM 格式化] 节点 {node_id} 失败: {e}")
                failed_count += 1
                formatted_nodes.append(
                    {
                        "node_id": node_id,
                        "section": node_metadata.get("section", ""),
                        "success": False,
                        "error": str(e),
                    }
                )

        # 保存更新后的元数据
        def _save_metadata():
            with open(metadata_path, "w", encoding="utf-8") as f:
                json.dump(metadata, f, ensure_ascii=False, indent=2)

        await asyncio.to_thread(_save_metadata)

        logger.info(f"[LLM 格式化] 完成: {formatted_count} 成功, {failed_count} 失败")

        return {
            "status": "success",
            "index_id": index_id,
            "formatted_count": formatted_count,
            "failed_count": failed_count,
            "formatted_nodes": formatted_nodes,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[LLM 格式化] 导出失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to format text: {str(e)}",
        )


async def format_single_text(
    text: str,
    doc_type: str = "pdf",
    provider: str = "deepseek",
) -> Dict[str, Any]:
    """
    使用 LLM 格式化单段文本（不依赖索引）

    这是一个简化的 API，直接接收文本内容，返回格式化后的文本。
    适用于前端对已下载的章节文件进行 AI 格式化。

    Args:
        text: 原始文本内容
        doc_type: 文档类型 (pdf/epub)
        provider: LLM 提供商

    Returns:
        包含格式化文本的字典
    """
    try:
        if not text or len(text.strip()) < 50:
            return {
                "status": "success",
                "formatted_text": text,  # 文本太短，原样返回
            }

        # 创建 LLM 客户端
        try:
            llm_client, _ = get_llm_client(provider=provider)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to create LLM client: {str(e)}",
            )

        # 创建带 LLM 的格式化器
        formatter = TextFormatter(use_llm=True, llm_client=llm_client)

        # 格式化文本
        logger.info(f"[单文本格式化] 开始格式化, 文本长度: {len(text)}")

        def _format():
            return formatter.format(text, doc_type)

        formatted_text = await asyncio.to_thread(_format)

        logger.info(f"[单文本格式化] 完成, 结果长度: {len(formatted_text)}")

        return {
            "status": "success",
            "formatted_text": formatted_text,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[单文本格式化] 失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to format text: {str(e)}",
        )
