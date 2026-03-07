# src/deeppdf/skills/__init__.py
"""
Skills 平台模块

提供可扩展的阅读技能系统，支持自动路由和手动切换。
"""

import logging
from pathlib import Path
from typing import Optional

from .models import Skill, SkillConfig, SkillMeta, RoutingResult
from .loader import SkillLoader
from .registry import SkillRegistry
from .router import SkillRouter

logger = logging.getLogger(__name__)

# 全局 Skill 注册表（单例）
_skill_registry: Optional[SkillRegistry] = None


def get_skill_registry() -> SkillRegistry:
    """
    获取全局 Skill 注册表（懒加载）

    Returns:
        SkillRegistry 实例
    """
    global _skill_registry

    if _skill_registry is None:
        from ..config import settings

        _skill_registry = SkillRegistry()

        # 1. 加载内置 Skills
        builtin_dir = Path(__file__).parent / "builtin"
        if builtin_dir.exists():
            count = _skill_registry.load_from_directory(builtin_dir, is_builtin=True)
            logger.info(f"[Skills] 加载了 {count} 个内置 Skills")

        # 2. 加载用户 Skills（如果配置了目录）
        user_skills_dir = settings.user_skills_dir
        if user_skills_dir:
            user_dir = Path(user_skills_dir)
            if user_dir.exists():
                count = _skill_registry.load_from_directory(user_dir, is_builtin=False)
                logger.info(f"[Skills] 加载了 {count} 个用户 Skills")

        # 3. 设置默认 Skill
        if _skill_registry.has("general"):
            _skill_registry.set_default("general")

    return _skill_registry


__all__ = [
    "Skill",
    "SkillConfig",
    "SkillMeta",
    "RoutingResult",
    "SkillLoader",
    "SkillRegistry",
    "SkillRouter",
    "get_skill_registry",
]
