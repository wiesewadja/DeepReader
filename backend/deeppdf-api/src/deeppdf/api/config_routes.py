"""
配置管理 API 路由

提供用户配置的 CRUD 接口
"""
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import ValidationError

from .config_models import (
    LLMConfig,
    IndexingConfig,
    UserConfig,
    UserConfigUpdate,
    UserConfigListResponse,
    UserConfigResponse,
)
from ..services.config_storage import ConfigStorage
from ..config import settings

logger = logging.getLogger(__name__)

# 创建路由器
router = APIRouter(prefix="/api/config", tags=["Configuration"])

# 初始化配置存储服务
_storage_dir = Path(settings.base_dir) / "configs"
_config_storage = ConfigStorage(storage_dir=str(_storage_dir))


def _mask_api_key(api_key: Optional[str]) -> Optional[str]:
    """掩码处理 API key（用于响应）"""
    if not api_key:
        return None
    return f"{'*' * min(len(api_key), 12)} ({len(api_key)} 字符)"


@router.get("", response_model=UserConfigListResponse)
async def list_configs():
    """
    列出所有用户配置

    Returns:
        配置列表响应
    """
    try:
        configs = _config_storage.list_configs()
        logger.info(f"[配置API] 列出配置: {len(configs)} 个")
        return UserConfigListResponse(status="success", configs=configs)
    except Exception as e:
        logger.error(f"[配置API] 列出配置失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list configurations: {str(e)}"
        )


@router.get("/default", response_model=UserConfigResponse)
async def get_default_config():
    """
    获取默认配置

    Returns:
        默认配置响应
    """
    try:
        config = _config_storage.get_default_config()
        if not config:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No default configuration found"
            )

        logger.info(f"[配置API] 获取默认配置: {config.name}")
        return UserConfigResponse(status="success", config=config)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[配置API] 获取默认配置失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get default configuration: {str(e)}"
        )


@router.post("", response_model=UserConfigResponse, status_code=status.HTTP_201_CREATED)
async def create_config(config: UserConfig):
    """
    创建新配置

    Args:
        config: 配置对象

    Returns:
        创建结果响应
    """
    try:
        success, error = _config_storage.create_config(config)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error
            )

        logger.info(f"[配置API] 创建配置成功: {config.name}")
        return UserConfigResponse(
            status="success",
            config=config,
            message=f"Configuration '{config.name}' created successfully"
        )
    except HTTPException:
        raise
    except ValidationError as e:
        logger.error(f"[配置API] 配置验证失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Configuration validation failed: {str(e)}"
        )
    except Exception as e:
        logger.error(f"[配置API] 创建配置失败: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create configuration: {str(e)}"
        )


@router.put("/{name}", response_model=UserConfigResponse)
async def update_config(name: str, update: UserConfigUpdate):
    """
    更新配置

    Args:
        name: 配置名称
        update: 更新数据

    Returns:
        更新结果响应
    """
    try:
        success, error = _config_storage.update_config(name, update)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error
            )

        # 获取更新后的配置
        config = _config_storage.get_config(name)
        logger.info(f"[配置API] 更新配置成功: {name}")
        return UserConfigResponse(
            status="success",
            config=config,
            message=f"Configuration '{name}' updated successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[配置API] 更新配置失败 {name}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update configuration: {str(e)}"
        )


@router.delete("/{name}", response_model=UserConfigResponse)
async def delete_config(name: str):
    """
    删除配置

    Args:
        name: 配置名称

    Returns:
        删除结果响应
    """
    try:
        success, error = _config_storage.delete_config(name)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error
            )

        logger.info(f"[配置API] 删除配置成功: {name}")
        return UserConfigResponse(
            status="success",
            config=None,
            message=f"Configuration '{name}' deleted successfully"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[配置API] 删除配置失败 {name}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete configuration: {str(e)}"
        )


@router.patch("/{name}/set-default", response_model=UserConfigResponse)
async def set_default_config(name: str):
    """
    设置默认配置

    Args:
        name: 配置名称

    Returns:
        设置结果响应
    """
    try:
        success, error = _config_storage.set_default_config(name)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error
            )

        # 获取更新后的配置
        config = _config_storage.get_config(name)
        logger.info(f"[配置API] 设置默认配置成功: {name}")
        return UserConfigResponse(
            status="success",
            config=config,
            message=f"Configuration '{name}' set as default"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[配置API] 设置默认配置失败 {name}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to set default configuration: {str(e)}"
        )
