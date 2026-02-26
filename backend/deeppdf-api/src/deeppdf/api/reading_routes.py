"""
阅读进度 API 路由
"""

import logging
from typing import List
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from pathlib import Path

from ..config import settings
from ..services.manager import (
    load_index_metadata,
    update_reading_progress,
)

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"索引不存在: {index_id}")

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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"索引不存在: {index_id}")

    metadata = metadata_result.get("metadata", {})
    total_pages = metadata.get("total_pages", 0)
    read_pages = metadata.get("read_pages", [])

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
