"""
阅读进度 API 路由
"""

import logging
from typing import Dict, List, Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from pydantic import BaseModel
from pathlib import Path

from ..config import settings
from ..services.manager import load_index_metadata
from .export_utils import get_pdf_page_count

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/reading", tags=["Reading"])


def _validate_index_id(index_id: str) -> None:
    """验证 index_id 格式，防止路径遍历攻击"""
    if ".." in index_id or "/" in index_id or "\\" in index_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid index_id format"
        )


# ==================== 章节目录 API ====================


class ChapterItem(BaseModel):
    """章节项"""

    title: str
    start_page: int
    end_page: int
    level: int = 0
    summary: Optional[str] = None  # 章节摘要（LLM 生成）
    obsidian_link: Optional[str] = None  # Obsidian Markdown 文件链接


class SubChapter(BaseModel):
    """二级章节项"""

    title: str
    node_id: Optional[str] = None  # 节点 ID（用于 get_chapter）
    obsidian_link: Optional[str] = None  # Obsidian Markdown 文件链接


class TocSection(BaseModel):
    """2 级扁平章节结构（骨架+叶子）"""

    level_1: str  # 一级章节标题
    node_id: Optional[str] = None  # 一级章节节点 ID（用于 get_chapter）
    obsidian_link: Optional[str] = None  # Obsidian Markdown 文件链接
    summary: Optional[str] = None  # 一级章节摘要
    sub_chapters: List[SubChapter] = []  # 二级章节列表


class TableOfContentsResponse(BaseModel):
    """章节目录响应"""

    index_id: str
    book_name: str
    total_pages: int
    chapters: List[ChapterItem]


class TableOfContentsFlatResponse(BaseModel):
    """扁平化章节目录响应（2 级结构）"""

    status: str = "success"
    book_title: str
    toc: List[TocSection]


def _extract_chapters(
    tree_structure: List[dict],
    level: int = 0,
    book_name: str = "",
    markdown_files: Optional[Dict[str, str]] = None,
) -> List[ChapterItem]:
    """从 tree_structure 提取章节列表"""
    chapters = []
    for idx, node in enumerate(tree_structure):
        title = node.get("title", "未命名章节")
        node_id = node.get("node_id")
        start = node.get("physical_index", node.get("start_index", 1))
        end = node.get("end_index", start)
        # 提取章节摘要（LLM 生成）
        summary = node.get("summary")

        # 生成 Obsidian 链接（Markdown 文件路径）
        # 优先使用 markdown_files 映射（来自实际导出的文件）
        obsidian_link = None
        if markdown_files and node_id and node_id in markdown_files:
            obsidian_link = markdown_files[node_id]
        elif book_name:
            # 回退：自己生成文件名（可能与实际导出不一致）
            folder_name = book_name.replace(".pdf", "").replace(".epub", "")
            safe_title = "".join(c for c in title if c.isalnum() or c in " -_").strip()
            filename = f"{idx + 1:02d}-{safe_title}.md"
            obsidian_link = f"{folder_name}/{filename}"

        chapters.append(
            ChapterItem(
                title=title,
                start_page=start,
                end_page=end,
                level=level,
                summary=summary,
                obsidian_link=obsidian_link,
            )
        )
        # 递归处理子章节
        sub_structure = node.get("structure", [])
        if isinstance(sub_structure, list) and sub_structure:
            chapters.extend(
                _extract_chapters(sub_structure, level + 1, book_name, markdown_files)
            )
    return chapters


def _extract_flat_toc(
    tree_structure: List[dict],
    book_name: str = "",
    markdown_files: Optional[Dict[str, str]] = None,
    level: int = 0,
) -> List[TocSection]:
    """
    提取扁平化的 2 级章节结构（骨架+叶子）

    Args:
        tree_structure: 树状结构数据
        book_name: 书籍名称（用于生成 Obsidian 链接）
        markdown_files: node_id -> 文件路径的映射（来自索引元数据）
        level: 当前层级

    Returns:
        扁平化的 2 级章节列表
    """
    result: List[TocSection] = []

    # 清理书籍名称（移除 .pdf/.epub 后缀）
    folder_name = (
        book_name.replace(".pdf", "").replace(".epub", "") if book_name else ""
    )

    for idx, node in enumerate(tree_structure):
        title = node.get("title", "未命名章节")
        node_id = node.get("node_id")  # 一级章节节点 ID
        summary = node.get("summary")  # LLM 生成的摘要

        # 生成 Obsidian Markdown 文件链接
        # 优先使用 markdown_files 映射（来自实际导出的文件）
        obsidian_link = None
        if markdown_files and node_id and node_id in markdown_files:
            obsidian_link = markdown_files[node_id]
        elif folder_name:
            # 回退：自己生成文件名（可能与实际导出不一致）
            safe_title = "".join(c for c in title if c.isalnum() or c in " -_").strip()
            filename = f"{idx + 1:02d}-{safe_title}.md"
            obsidian_link = f"{folder_name}/{filename}"

        # 获取子章节
        sub_structure = node.get("structure", [])
        sub_chapters: List[SubChapter] = []

        if isinstance(sub_structure, list) and sub_structure:
            for sub_idx, sub_node in enumerate(sub_structure):
                sub_title = sub_node.get("title", "未命名章节")
                sub_node_id = sub_node.get("node_id")

                # 生成子章节的 Obsidian 链接
                # 优先使用 markdown_files 映射
                sub_obsidian_link = None
                if markdown_files and sub_node_id and sub_node_id in markdown_files:
                    sub_obsidian_link = markdown_files[sub_node_id]
                elif folder_name:
                    sub_safe_title = "".join(
                        c for c in sub_title if c.isalnum() or c in " -_"
                    ).strip()
                    sub_filename = f"{idx + 1:02d}-{sub_safe_title}.md"
                    sub_obsidian_link = f"{folder_name}/{sub_filename}"

                sub_chapters.append(
                    SubChapter(
                        title=sub_title,
                        node_id=sub_node_id,
                        obsidian_link=sub_obsidian_link,
                    )
                )

        # 添加当前一级章节及其子章节
        result.append(
            TocSection(
                level_1=title,
                node_id=node_id,
                obsidian_link=obsidian_link,
                summary=summary,
                sub_chapters=sub_chapters,
            )
        )

        # 递归处理子结构（如果有的话，继续添加到当前一级章节下）
        if isinstance(sub_structure, list) and sub_structure:
            for sub_node in sub_structure:
                nested_structure = sub_node.get("structure", [])
                if isinstance(nested_structure, list) and nested_structure:
                    # 将更深层级的章节添加到当前一级章节的 sub_chapters 中
                    for nested_node in nested_structure:
                        nested_title = nested_node.get("title", "未命名章节")
                        nested_node_id = nested_node.get("node_id")

                        # 优先使用 markdown_files 映射
                        nested_obsidian_link = None
                        if (
                            markdown_files
                            and nested_node_id
                            and nested_node_id in markdown_files
                        ):
                            nested_obsidian_link = markdown_files[nested_node_id]

                        sub_chapters.append(
                            SubChapter(
                                title=nested_title,
                                node_id=nested_node_id,
                                obsidian_link=nested_obsidian_link,
                            )
                        )

    return result


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

    # 获取书籍名称（用于生成 Obsidian 链接）
    book_name = (
        metadata.get("pdf_name", "未知书籍").replace(".pdf", "").replace(".epub", "")
    )

    # 获取 markdown_files 映射（用于生成正确的 obsidian_link）
    markdown_files = metadata.get("markdown_files", {})

    # 提取章节（传入 book_name 和 markdown_files 以生成 obsidian_link）
    chapters = _extract_chapters(structure_list, 0, book_name, markdown_files)

    # 获取总页数
    total_pages = metadata.get("total_pages", 0)
    if total_pages == 0:
        pdf_path = metadata.get("pdf_path")
        if pdf_path and Path(pdf_path).exists():
            total_pages = get_pdf_page_count(pdf_path)

    logger.info(f"[阅读API] 获取目录: {index_id}, {len(chapters)} 个章节")

    return TableOfContentsResponse(
        index_id=index_id,
        book_name=book_name,
        total_pages=total_pages,
        chapters=chapters,
    )


@router.get("/{index_id}/toc/flat", response_model=TableOfContentsFlatResponse)
async def get_table_of_contents_flat(index_id: str):
    """
    获取书籍扁平化章节目录（2 级结构：骨架+叶子）

    返回格式：
    {
        "status": "success",
        "book_title": "书籍名称",
        "toc": [
            {
                "level_1": "第一部分：...",
                "summary": "本部分摘要...",
                "sub_chapters": [
                    {"title": "第1章：...", "node_id": "xxx"},
                    {"title": "第2章：...", "node_id": "xxx"}
                ]
            }
        ]
    }

    Args:
        index_id: 索引 ID

    Returns:
        扁平化章节目录信息
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

    # 获取书籍名称
    book_name = (
        metadata.get("pdf_name", "未知书籍").replace(".pdf", "").replace(".epub", "")
    )

    # 获取 markdown_files 映射（用于生成正确的 obsidian_link）
    markdown_files = metadata.get("markdown_files", {})

    # 提取扁平化 2 级结构
    flat_toc = _extract_flat_toc(structure_list, book_name, markdown_files)

    logger.info(f"[阅读API] 获取扁平目录: {index_id}, {len(flat_toc)} 个一级章节")

    return TableOfContentsFlatResponse(
        status="success",
        book_title=book_name,
        toc=flat_toc,
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
