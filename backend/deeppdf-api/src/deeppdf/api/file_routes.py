"""
文件管理 API 路由

提供 PDF 文件的上传、列表、详情和删除接口
"""
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, status, UploadFile, File
from pydantic import ValidationError

from .file_models import (
    FileUploadResponse,
    FileInfo,
    FileListResponse,
    FileDetailResponse,
    FileDeleteResponse,
)
from ..services.file_storage import FileStorage
from ..config import settings

logger = logging.getLogger(__name__)

# 创建路由器
router = APIRouter(prefix="/api/files", tags=["Files"])

# 初始化文件存储服务
_storage_dir = Path(settings.base_dir)
_file_storage = FileStorage(storage_dir=str(_storage_dir))


@router.post("", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(file: UploadFile = File(...)):
    """
    上传 PDF 文件

    Args:
        file: PDF 文件

    Returns:
        上传结果响应

    Raises:
        HTTPException: 文件验证失败
    """
    # 读取文件内容
    content = await file.read()

    # 验证并保存文件
    success, file_info, error = _file_storage.save_file(file.filename, content)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )

    logger.info(f"[文件API] 文件上传成功: {file_info.file_id} - {file_info.file_name}")

    return FileUploadResponse(
        file_id=file_info.file_id,
        file_name=file_info.file_name,
        file_size=file_info.file_size,
        file_path=file_info.file_path,
        uploaded_at=file_info.uploaded_at,
        status=file_info.status,
        indexed=file_info.indexed
    )


@router.get("", response_model=FileListResponse)
async def list_files():
    """
    列出所有已上传的文件

    Returns:
        文件列表响应
    """
    try:
        files = _file_storage.list_files()
        logger.info(f"[文件API] 列出文件: {len(files)} 个")
        return FileListResponse(status="success", files=files, total=len(files))
    except Exception as e:
        logger.error(f"[文件API] 列出文件失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list files: {str(e)}"
        )


@router.get("/{file_id}", response_model=FileDetailResponse)
async def get_file_info(file_id: str):
    """
    获取文件详情

    Args:
        file_id: 文件 ID

    Returns:
        文件详情响应

    Raises:
        HTTPException: 文件不存在
    """
    file_info = _file_storage.get_file(file_id)

    if not file_info:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File '{file_id}' not found"
        )

    logger.info(f"[文件API] 获取文件详情: {file_id}")
    return FileDetailResponse(status="success", file=file_info)


@router.delete("/{file_id}", response_model=FileDeleteResponse)
async def delete_file(file_id: str):
    """
    删除文件

    删除文件时会同时删除关联的索引。

    Args:
        file_id: 文件 ID

    Returns:
        删除结果响应

    Raises:
        HTTPException: 文件不存在
    """
    success, error, deleted_indexes = _file_storage.delete_file(file_id)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=error
        )

    logger.info(f"[文件API] 文件已删除: {file_id}，同时删除 {deleted_indexes} 个索引")

    return FileDeleteResponse(
        status="success",
        message=f"File '{file_id}' deleted successfully",
        deleted_indexes=deleted_indexes
    )
