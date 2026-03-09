"""
阅读进度 API 路由
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status, BackgroundTasks
from pydantic import BaseModel, Field, field_validator
from pathlib import Path

from ..config import settings
from ..services.manager import (
    load_index_metadata,
    update_reading_progress,
)
from .export_utils import get_pdf_page_count

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/reading", tags=["Reading"])


class UpdateProgressRequest(BaseModel):
    """更新进度请求"""

    pages: List[int] = Field(..., description="新增的已阅读页码列表")

    @field_validator("pages")
    @classmethod
    def validate_pages(cls, v: List[int]) -> List[int]:
        """验证页码列表"""
        if not v:
            raise ValueError("pages cannot be empty")
        if any(p < 1 for p in v):
            raise ValueError("page numbers must be positive integers")
        return v


class ProgressResponse(BaseModel):
    """进度响应"""

    index_id: str
    read_pages: List[int]
    total_pages: int
    progress: float
    status: str
    last_read_at: str | None = None
    chat_rounds: int = 0


def _validate_index_id(index_id: str) -> None:
    """验证 index_id 格式，防止路径遍历攻击"""
    if ".." in index_id or "/" in index_id or "\\" in index_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid index_id format"
        )


@router.post("/{index_id}/progress", response_model=ProgressResponse)
async def update_progress(index_id: str, request: UpdateProgressRequest):
    """
    更新阅读进度

    Args:
        index_id: 索引 ID
        request: 包含新增已阅读页码的请求体

    Returns:
        更新后的进度信息

    Raises:
        HTTPException: 索引不存在或更新失败
    """
    _validate_index_id(index_id)
    storage_dir = str(Path(settings.base_dir))

    # 检查索引是否存在
    metadata_result = await load_index_metadata(index_id, storage_dir)
    if metadata_result.get("status") != "success":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"索引不存在: {index_id}"
        )

    # 更新进度
    result = await update_reading_progress(
        index_id=index_id,
        storage_dir=storage_dir,
        pages=request.pages,
    )

    if result.get("status") != "success":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=result.get("error"),
        )

    # 获取更新后的元数据
    metadata_result = await load_index_metadata(index_id, storage_dir)
    metadata = metadata_result.get("metadata", {})

    logger.info(f"[阅读API] 更新进度成功: {index_id}, 新增 {len(request.pages)} 页")

    return ProgressResponse(
        index_id=index_id,
        read_pages=metadata.get("read_pages", []),
        total_pages=metadata.get("total_pages", 0),
        progress=result.get("progress", 0.0),
        status=metadata.get("status", "active"),
        last_read_at=metadata.get("last_read_at"),
        chat_rounds=metadata.get("chat_rounds", 0),
    )


@router.get("/{index_id}/progress", response_model=ProgressResponse)
async def get_progress(index_id: str):
    """
    获取阅读进度

    Args:
        index_id: 索引 ID

    Returns:
        当前进度信息

    Raises:
        HTTPException: 索引不存在
    """
    _validate_index_id(index_id)
    storage_dir = str(Path(settings.base_dir))

    metadata_result = await load_index_metadata(index_id, storage_dir)
    if metadata_result.get("status") != "success":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"索引不存在: {index_id}"
        )

    metadata = metadata_result.get("metadata", {})
    total_pages = metadata.get("total_pages", 0)
    read_pages = metadata.get("read_pages", [])

    # 如果 total_pages 为 0，尝试从 PDF 文件获取
    if total_pages == 0:
        pdf_path = metadata.get("pdf_path")
        if pdf_path and Path(pdf_path).exists():
            total_pages = get_pdf_page_count(pdf_path)
            logger.info(f"[阅读API] 从 PDF 获取页数: {pdf_path} -> {total_pages} 页")

    if total_pages > 0:
        progress = round(len(read_pages) / total_pages * 100, 1)
    else:
        progress = 0.0

    logger.info(f"[阅读API] 获取进度: {index_id}, 进度 {progress}%")

    return ProgressResponse(
        index_id=index_id,
        read_pages=read_pages,
        total_pages=total_pages,
        progress=progress,
        status=metadata.get("status", "active"),
        last_read_at=metadata.get("last_read_at"),
        chat_rounds=metadata.get("chat_rounds", 0),
    )


# ==================== 章节目录 API ====================


class ChapterItem(BaseModel):
    """章节项"""

    title: str
    start_page: int
    end_page: int
    level: int = 0


class TableOfContentsResponse(BaseModel):
    """章节目录响应"""

    index_id: str
    book_name: str
    total_pages: int
    chapters: List[ChapterItem]


def _extract_chapters(tree_structure: List[dict], level: int = 0) -> List[ChapterItem]:
    """从 tree_structure 提取章节列表"""
    chapters = []
    for node in tree_structure:
        title = node.get("title", "未命名章节")
        start = node.get("physical_index", node.get("start_index", 1))
        end = node.get("end_index", start)
        chapters.append(
            ChapterItem(title=title, start_page=start, end_page=end, level=level)
        )
        # 递归处理子章节
        sub_structure = node.get("structure", [])
        if isinstance(sub_structure, list) and sub_structure:
            chapters.extend(_extract_chapters(sub_structure, level + 1))
    return chapters


@router.get("/{index_id}/toc", response_model=TableOfContentsResponse)
async def get_table_of_contents(index_id: str):
    """
    获取书籍章节目录

    Args:
        index_id: 索引 ID

    Returns:
        章节目录信息
    """
    _validate_index_id(index_id)
    storage_dir = str(Path(settings.base_dir))

    metadata_result = await load_index_metadata(index_id, storage_dir)
    if metadata_result.get("status") != "success":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"索引不存在: {index_id}"
        )

    metadata = metadata_result.get("metadata", {})

    # 从 tree_structure 提取章节
    tree_structure = metadata.get("tree_structure", {})
    structure_list = (
        tree_structure.get("structure", []) if isinstance(tree_structure, dict) else []
    )
    chapters = _extract_chapters(structure_list)

    # 获取总页数
    total_pages = metadata.get("total_pages", 0)
    if total_pages == 0:
        pdf_path = metadata.get("pdf_path")
        if pdf_path and Path(pdf_path).exists():
            total_pages = get_pdf_page_count(pdf_path)

    book_name = (
        metadata.get("pdf_name", "未知书籍").replace(".pdf", "").replace(".epub", "")
    )

    logger.info(f"[阅读API] 获取目录: {index_id}, {len(chapters)} 个章节")

    return TableOfContentsResponse(
        index_id=index_id,
        book_name=book_name,
        total_pages=total_pages,
        chapters=chapters,
    )


# ==================== 摘要生成 API ====================


class SummaryResponse(BaseModel):
    """摘要响应"""

    index_id: str
    book_name: str
    summary: str


@router.get("/{index_id}/summary", response_model=SummaryResponse)
async def get_or_generate_summary(
    index_id: str, background_tasks: BackgroundTasks, regenerate: bool = False
):
    """
    获取或生成书籍摘要

    Args:
        index_id: 索引 ID
        regenerate: 是否强制重新生成

    Returns:
        书籍摘要
    """
    _validate_index_id(index_id)
    storage_dir = str(Path(settings.base_dir))

    metadata_result = await load_index_metadata(index_id, storage_dir)
    if metadata_result.get("status") != "success":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"索引不存在: {index_id}"
        )

    metadata = metadata_result.get("metadata", {})
    book_name = (
        metadata.get("pdf_name", "未知书籍").replace(".pdf", "").replace(".epub", "")
    )

    # 检查是否已有摘要
    existing_summary = metadata.get("summary")
    if existing_summary and not regenerate:
        logger.info(f"[阅读API] 返回已有摘要: {index_id}")
        return SummaryResponse(
            index_id=index_id,
            book_name=book_name,
            summary=existing_summary,
        )

    # 从 markdown_files 读取章节内容生成摘要
    markdown_files = metadata.get("markdown_files", {})
    summary_parts = []

    if markdown_files:
        # 读取前 3 个章节的内容（跳过目录类章节）
        chapter_count = 0
        for node_id, md_path in sorted(markdown_files.items()):
            if chapter_count >= 3:
                break

            # 跳过目录、前言等辅助章节
            section_title = md_path.split("/")[-1].replace(".md", "").lower()
            if any(
                skip in section_title
                for skip in ["目录", "toc", "preface", "前言", "序"]
            ):
                continue

            # 构建完整路径并读取内容
            full_path = Path(settings.base_dir) / "markdown" / md_path
            if full_path.exists():
                try:
                    content = full_path.read_text(encoding="utf-8")
                    # 提取 frontmatter 中的 section 标题
                    section_name = ""
                    if "---" in content:
                        fm_end = content.find("---", 4)
                        if fm_end > 0:
                            fm = content[:fm_end]
                            for line in fm.split("\n"):
                                if line.startswith("section:"):
                                    section_name = (
                                        line.split(":", 1)[1].strip().strip('"')
                                    )
                                    break
                            content = content[fm_end + 3 :]

                    # 提取前 500 字符作为内容预览
                    # 去除 markdown 标记和页面标记
                    import re

                    content = re.sub(
                        r"^---[\s\S]*?---", "", content
                    )  # 移除 frontmatter
                    content = re.sub(r"### 第 \d+ 页.*?\n", "", content)  # 移除页面标记
                    content = re.sub(r"\^page-\d+", "", content)  # 移除页面锚点
                    content = re.sub(r"#+ ", "", content)  # 移除标题标记
                    content = content.strip()[:500]  # 取前 500 字符

                    if content:
                        if section_name:
                            summary_parts.append(
                                f"**{section_name}**: {content[:200]}..."
                            )
                        chapter_count += 1
                except Exception as e:
                    logger.warning(f"[阅读API] 读取章节失败: {md_path}, {e}")

    # 生成最终摘要
    if summary_parts:
        summary = f"《{book_name}》主要内容包括：" + "；".join(summary_parts)
    else:
        # 回退到从 tree_structure 提取章节标题
        tree_structure = metadata.get("tree_structure", {})
        structure_list = (
            tree_structure.get("structure", [])
            if isinstance(tree_structure, dict)
            else []
        )
        if structure_list:
            chapter_titles = [node.get("title", "") for node in structure_list[:10]]
            summary = f"《{book_name}》包含以下章节：" + "、".join(chapter_titles)
            if len(structure_list) > 10:
                summary += f"等共 {len(structure_list)} 个章节。"
        else:
            summary = f"《{book_name}》是一本已索引的书籍，暂无详细摘要信息。"

    logger.info(f"[阅读API] 生成摘要: {index_id}")

    return SummaryResponse(
        index_id=index_id,
        book_name=book_name,
        summary=summary,
    )
