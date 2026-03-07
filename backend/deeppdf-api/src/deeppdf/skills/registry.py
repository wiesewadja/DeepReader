# src/deeppdf/skills/registry.py
"""
Skill 注册表

管理所有已注册的 Skills，支持内置和用户 Skills 的合并与覆盖。
"""

import logging
from pathlib import Path
from typing import Dict, List, Optional

from .models import Skill
from .loader import SkillLoader

logger = logging.getLogger(__name__)


class SkillRegistry:
    """Skill 注册表，管理所有已注册的 Skills"""

    def __init__(self):
        """初始化注册表"""
        self._skills: Dict[str, Skill] = {}
        self._default_skill_name: Optional[str] = None
        self._loader = SkillLoader()

    def register(self, skill: Skill) -> None:
        """
        注册 Skill

        如果已存在同名 Skill，用户 Skill 会覆盖内置 Skill。
        同类型 Skill 后注册的会覆盖先注册的。

        Args:
            skill: 要注册的 Skill 对象
        """
        existing = self._skills.get(skill.name)

        if existing:
            # 用户 Skill 覆盖内置 Skill
            if existing.is_builtin and not skill.is_builtin:
                logger.info(
                    f"[SkillRegistry] 用户 Skill '{skill.name}' 覆盖内置 Skill"
                )
                self._skills[skill.name] = skill
            elif not existing.is_builtin and not skill.is_builtin:
                logger.warning(
                    f"[SkillRegistry] 用户 Skill '{skill.name}' 已存在，将被新版本覆盖"
                )
                self._skills[skill.name] = skill
            elif existing.is_builtin and skill.is_builtin:
                logger.warning(
                    f"[SkillRegistry] 内置 Skill '{skill.name}' 已存在，将被新版本覆盖"
                )
                self._skills[skill.name] = skill
            # 内置 Skill 不覆盖用户 Skill
        else:
            self._skills[skill.name] = skill
            logger.debug(f"[SkillRegistry] 注册 Skill: {skill.name}")

    def get(self, name: str) -> Optional[Skill]:
        """
        获取 Skill

        Args:
            name: Skill 名称

        Returns:
            Skill 对象，如果不存在返回 None
        """
        return self._skills.get(name)

    def has(self, name: str) -> bool:
        """
        检查 Skill 是否存在

        Args:
            name: Skill 名称

        Returns:
            是否存在
        """
        return name in self._skills

    def list_all(self) -> List[Skill]:
        """
        列出所有 Skills

        Returns:
            Skill 列表
        """
        return list(self._skills.values())

    def list_builtin(self) -> List[Skill]:
        """
        列出所有内置 Skills

        Returns:
            内置 Skill 列表
        """
        return [s for s in self._skills.values() if s.is_builtin]

    def list_user(self) -> List[Skill]:
        """
        列出所有用户 Skills

        Returns:
            用户 Skill 列表
        """
        return [s for s in self._skills.values() if not s.is_builtin]

    def set_default(self, name: str) -> bool:
        """
        设置默认 Skill

        Args:
            name: Skill 名称

        Returns:
            是否设置成功
        """
        if self.has(name):
            self._default_skill_name = name
            logger.info(f"[SkillRegistry] 设置默认 Skill: {name}")
            return True
        else:
            logger.warning(f"[SkillRegistry] Skill '{name}' 不存在，无法设为默认")
            return False

    def get_default(self) -> Optional[Skill]:
        """
        获取默认 Skill

        Returns:
            默认 Skill，如果未设置或不存在返回 None
        """
        if self._default_skill_name:
            return self.get(self._default_skill_name)
        return None

    def load_from_directory(
        self, dir_path: Path, is_builtin: bool = False
    ) -> int:
        """
        从目录加载 Skills

        Args:
            dir_path: 目录路径
            is_builtin: 是否为内置 Skills

        Returns:
            加载的 Skill 数量
        """
        skills = self._loader.load_directory(dir_path)

        for skill in skills.values():
            skill.is_builtin = is_builtin
            self.register(skill)

        logger.info(
            f"[SkillRegistry] 从 {dir_path} 加载了 {len(skills)} 个 Skills "
            f"({'内置' if is_builtin else '用户'})"
        )

        return len(skills)

    def clear(self) -> None:
        """清空所有注册的 Skills"""
        self._skills.clear()
        self._default_skill_name = None
        logger.info("[SkillRegistry] 已清空所有 Skills")
