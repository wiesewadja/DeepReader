# src/deeppdf/skills/loader.py
"""
Skill 文件加载器

从 Markdown + YAML frontmatter 格式的文件中加载 Skill 定义。
"""

import logging
from pathlib import Path
from typing import Dict, Optional

import yaml

from .models import Skill, SkillMeta

logger = logging.getLogger(__name__)


class SkillLoader:
    """Skill 文件加载器，支持 Markdown + YAML frontmatter 格式"""

    def __init__(self):
        """初始化加载器"""
        pass

    def load_file(self, file_path: Path) -> Optional[Skill]:
        """
        从文件加载 Skill

        Args:
            file_path: Skill 文件路径

        Returns:
            Skill 对象，如果加载失败返回 None
        """
        if not file_path.exists():
            logger.warning(f"[SkillLoader] 文件不存在: {file_path}")
            return None

        if file_path.suffix.lower() != ".md":
            logger.debug(f"[SkillLoader] 跳过非 Markdown 文件: {file_path}")
            return None

        try:
            content = file_path.read_text(encoding="utf-8")
            return self.parse_skill_content(content, str(file_path))
        except Exception as e:
            logger.error(f"[SkillLoader] 读取文件失败 {file_path}: {e}")
            return None

    def parse_skill_content(self, content: str, source_path: str = "") -> Optional[Skill]:
        """
        解析 Skill 内容

        Args:
            content: 文件内容
            source_path: 来源路径（用于日志和调试）

        Returns:
            Skill 对象，如果解析失败返回 None
        """
        # 解析 frontmatter
        frontmatter, body = self._parse_frontmatter(content)
        if frontmatter is None:
            logger.warning(f"[SkillLoader] 无法解析 frontmatter: {source_path}")
            return None

        # 验证必填字段
        if "name" not in frontmatter:
            logger.warning(f"[SkillLoader] 缺少必填字段 'name': {source_path}")
            return None

        if "description" not in frontmatter:
            logger.warning(f"[SkillLoader] 缺少必填字段 'description': {source_path}")
            return None

        # 构建 Skill 对象
        try:
            skill_data = {
                "name": frontmatter["name"],
                "description": frontmatter["description"],
                "tools": frontmatter.get("tools"),
                "default_params": frontmatter.get("default_params"),
                "keywords": frontmatter.get("keywords"),
                "book_types": frontmatter.get("book_types"),
                "prompt_content": body.strip() if body else None,
                "source_path": source_path,
            }

            # 解析元数据
            if "meta" in frontmatter:
                skill_data["meta"] = SkillMeta(**frontmatter["meta"])

            return Skill(**skill_data)

        except Exception as e:
            logger.error(f"[SkillLoader] 创建 Skill 对象失败 {source_path}: {e}")
            return None

    def _parse_frontmatter(self, content: str) -> tuple[Optional[Dict], str]:
        """
        解析 YAML frontmatter

        Args:
            content: 文件内容

        Returns:
            (frontmatter_dict, body_content) 元组
        """
        # 检查是否以 --- 开头
        if not content.startswith("---"):
            return None, content

        # 查找结束的 ---
        parts = content.split("---", 2)
        if len(parts) < 3:
            return None, content

        frontmatter_str = parts[1].strip()
        body = parts[2].strip()

        try:
            frontmatter = yaml.safe_load(frontmatter_str)
            if not isinstance(frontmatter, dict):
                return None, body
            return frontmatter, body
        except yaml.YAMLError as e:
            logger.debug(f"[SkillLoader] YAML 解析错误: {e}")
            return None, body

    def load_directory(self, dir_path: Path) -> Dict[str, Skill]:
        """
        加载目录下的所有 Skill 文件

        Args:
            dir_path: 目录路径

        Returns:
            Skill 字典 {name: Skill}
        """
        skills: Dict[str, Skill] = {}

        if not dir_path.exists():
            logger.warning(f"[SkillLoader] 目录不存在: {dir_path}")
            return skills

        if not dir_path.is_dir():
            logger.warning(f"[SkillLoader] 不是目录: {dir_path}")
            return skills

        for file_path in dir_path.glob("*.md"):
            skill = self.load_file(file_path)
            if skill:
                # 检查重名
                if skill.name in skills:
                    logger.warning(
                        f"[SkillLoader] Skill 名称冲突: {skill.name}, "
                        f"已存在: {skills[skill.name].source_path}, "
                        f"新文件: {skill.source_path}"
                    )
                    continue
                skills[skill.name] = skill
                logger.info(f"[SkillLoader] 加载 Skill: {skill.name} <- {file_path}")

        return skills
