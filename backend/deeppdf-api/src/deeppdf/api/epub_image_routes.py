"""
EPUB 图片 API 路由

提供 EPUB 图片的访问接口
"""

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response

from ..config import settings
from pageindex.epub_images import get_mime_type

logger = logging.getLogger(__name__)

# 创建路由器
router = APIRouter(prefix="/api/epub-images", tags=["EPUB Images"])


@router.get("/{index_id}/{image_name}")
async def get_epub_image(index_id: str, image_name: str):
    """
    获取 EPUB 图片

    Args:
        index_id: 索引 ID
        image_name: 图片文件名

    Returns:
        图片二进制数据

    Raises:
        HTTPException: 图片不存在 (404)
    """
    # 安全检查：防止路径遍历攻击
    if ".." in image_name or "/" in image_name or "\\" in image_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid image name"
        )

    # 构建图片路径
    storage_dir = Path(settings.base_dir)
    image_path = storage_dir / "epub_images" / index_id / image_name

    # 检查文件是否存在
    if not image_path.exists():
        logger.warning(f"[EPUB图片] 图片不存在: {image_path}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Image '{image_name}' not found for index '{index_id}'"
        )

    # 获取 MIME 类型
    mime_type = get_mime_type(image_name)

    # 读取图片
    try:
        with open(image_path, "rb") as f:
            image_data = f.read()

        logger.debug(f"[EPUB图片] 返回图片: {image_path}, MIME: {mime_type}")

        return Response(
            content=image_data,
            media_type=mime_type,
            headers={
                "Cache-Control": "public, max-age=86400",  # 缓存 1 天
            }
        )
    except Exception as e:
        logger.error(f"[EPUB图片] 读取图片失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read image: {str(e)}"
        )


@router.get("/{index_id}")
async def list_epub_images(index_id: str):
    """
    列出指定索引的所有图片

    Args:
        index_id: 索引 ID

    Returns:
        图片列表信息
    """
    storage_dir = Path(settings.base_dir)
    images_dir = storage_dir / "epub_images" / index_id

    if not images_dir.exists():
        return {
            "status": "success",
            "index_id": index_id,
            "image_count": 0,
            "images": []
        }

    # 列出所有图片文件
    images = []
    for image_file in images_dir.iterdir():
        if image_file.is_file() and image_file.suffix.lower() in [
            ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"
        ]:
            images.append({
                "name": image_file.name,
                "url": f"/api/epub-images/{index_id}/{image_file.name}",
                "size": image_file.stat().st_size,
            })

    logger.debug(f"[EPUB图片] 列出图片: {index_id}, 共 {len(images)} 张")

    return {
        "status": "success",
        "index_id": index_id,
        "image_count": len(images),
        "images": sorted(images, key=lambda x: x["name"])
    }
