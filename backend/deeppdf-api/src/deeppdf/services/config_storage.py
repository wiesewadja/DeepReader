"""
用户配置存储服务

管理用户配置的 CRUD 操作
"""

import json
import logging
from pathlib import Path
from typing import List, Optional, Tuple
from datetime import datetime

from ..api.config_models import UserConfig, UserConfigUpdate

logger = logging.getLogger(__name__)


class ConfigStorage:
    """用户配置存储"""

    def __init__(self, storage_dir: str):
        """
        初始化配置存储

        Args:
            storage_dir: 存储目录路径
        """
        self.storage_dir = Path(storage_dir) / "configs"
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        logger.debug(f"[配置存储] 存储目录: {self.storage_dir}")

    def _get_config_path(self, name: str) -> Path:
        """获取配置文件路径"""
        return self.storage_dir / f"{name}.json"

    def _mask_api_key(self, api_key: Optional[str]) -> Optional[str]:
        """掩码处理 API key（用于日志）"""
        if not api_key:
            return None
        return f"{'*' * min(len(api_key), 12)} ({len(api_key)} 字符)"

    def list_configs(self) -> List[UserConfig]:
        """
        列出所有配置

        Returns:
            配置列表
        """
        configs = []

        for config_file in self.storage_dir.glob("*.json"):
            try:
                with open(config_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    configs.append(UserConfig(**data))
            except Exception as e:
                logger.error(f"[配置存储] 读取配置文件失败 {config_file}: {e}")

        logger.info(f"[配置存储] 列出配置: {len(configs)} 个")
        return configs

    def get_config(self, name: str) -> Optional[UserConfig]:
        """
        获取指定配置

        Args:
            name: 配置名称

        Returns:
            配置对象，不存在返回 None
        """
        config_path = self._get_config_path(name)

        if not config_path.exists():
            logger.warning(f"[配置存储] 配置不存在: {name}")
            return None

        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                config = UserConfig(**data)
                logger.info(f"[配置存储] 读取配置: {name}")
                return config
        except Exception as e:
            logger.error(f"[配置存储] 读取配置失败 {name}: {e}")
            return None

    def get_default_config(self) -> Optional[UserConfig]:
        """
        获取默认配置

        Returns:
            默认配置，不存在返回 None
        """
        configs = self.list_configs()
        for config in configs:
            if config.is_default:
                logger.info(f"[配置存储] 默认配置: {config.name}")
                return config
        return None

    def create_config(self, config: UserConfig) -> Tuple[bool, Optional[str]]:
        """
        创建配置

        Args:
            config: 配置对象

        Returns:
            (success, error_message)
        """
        config_path = self._get_config_path(config.name)

        # 检查是否已存在
        if config_path.exists():
            return False, f"配置 '{config.name}' 已存在"

        # 如果设置为默认，取消其他配置的默认状态
        if config.is_default:
            self._clear_default_flag()

        try:
            # 添加时间戳
            data = config.model_dump()
            data["created_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            data["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

            logger.info(f"[配置存储] 创建配置: {config.name}")
            logger.info(f"  - LLM: {config.llm.provider}/{config.llm.model}")
            logger.info(f"  - API Key: {self._mask_api_key(config.llm.api_key)}")
            return True, None
        except Exception as e:
            logger.error(f"[配置存储] 创建配置失败 {config.name}: {e}")
            return False, str(e)

    def update_config(
        self, name: str, update: UserConfigUpdate
    ) -> Tuple[bool, Optional[str]]:
        """
        更新配置

        Args:
            name: 配置名称
            update: 更新数据

        Returns:
            (success, error_message)
        """
        config = self.get_config(name)
        if not config:
            return False, f"配置 '{name}' 不存在"

        try:
            # 更新字段
            if update.description is not None:
                config.description = update.description
            if update.is_default is not None:
                if update.is_default:
                    self._clear_default_flag()
                config.is_default = update.is_default
            if update.llm is not None:
                config.llm = update.llm
            if update.indexing is not None:
                config.indexing = update.indexing

            # 更新时间戳
            config_dict = config.model_dump()
            config_dict["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            config_path = self._get_config_path(name)
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(config_dict, f, ensure_ascii=False, indent=2)

            logger.info(f"[配置存储] 更新配置: {name}")
            return True, None
        except Exception as e:
            logger.error(f"[配置存储] 更新配置失败 {name}: {e}")
            return False, str(e)

    def delete_config(self, name: str) -> Tuple[bool, Optional[str]]:
        """
        删除配置

        Args:
            name: 配置名称

        Returns:
            (success, error_message)
        """
        config_path = self._get_config_path(name)

        if not config_path.exists():
            return False, f"配置 '{name}' 不存在"

        try:
            config_path.unlink()
            logger.info(f"[配置存储] 删除配置: {name}")
            return True, None
        except Exception as e:
            logger.error(f"[配置存储] 删除配置失败 {name}: {e}")
            return False, str(e)

    def set_default_config(self, name: str) -> Tuple[bool, Optional[str]]:
        """
        设置默认配置

        Args:
            name: 配置名称

        Returns:
            (success, error_message)
        """
        config = self.get_config(name)
        if not config:
            return False, f"配置 '{name}' 不存在"

        # 取消其他配置的默认状态
        self._clear_default_flag()

        # 设置当前配置为默认
        config.is_default = True
        return self.update_config(name, UserConfigUpdate(is_default=True))

    def _clear_default_flag(self) -> None:
        """清除所有配置的默认标志"""
        for config_file in self.storage_dir.glob("*.json"):
            try:
                with open(config_file, "r+", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("is_default"):
                        data["is_default"] = False
                        data["updated_at"] = datetime.now().strftime(
                            "%Y-%m-%d %H:%M:%S"
                        )
                        f.seek(0)
                        f.truncate()
                        json.dump(data, f, ensure_ascii=False, indent=2)
            except Exception as e:
                logger.warning(f"[配置存储] 清除默认标志失败 {config_file}: {e}")
