# src/deeppdf/skills/router.py
"""
Skill 路由器

根据查询内容、书籍类型等信息，自动选择最合适的 Skill。
"""

import logging
from typing import Optional, List, Tuple

from .models import Skill, RoutingResult
from .registry import SkillRegistry

logger = logging.getLogger(__name__)


class SkillRouter:
    """Skill 路由器，自动匹配最合适的 Skill"""

    def __init__(self, registry: SkillRegistry):
        """
        初始化路由器

        Args:
            registry: Skill 注册表
        """
        self.registry = registry

    def route(
        self,
        skill_name: Optional[str] = None,
        query: Optional[str] = None,
        book_type: Optional[str] = None,
    ) -> RoutingResult:
        """
        路由到最合适的 Skill

        优先级：手动指定 > book_type 匹配 > keyword 评分 > 默认

        Args:
            skill_name: 手动指定的 Skill 名称
            query: 用户查询内容
            book_type: 书籍类型

        Returns:
            RoutingResult 包含匹配的 Skill 和匹配信息
        """
        # 1. 手动指定（最高优先级）
        if skill_name:
            skill = self.registry.get(skill_name)
            if skill:
                logger.info(f"[SkillRouter] 手动指定: {skill_name}")
                return RoutingResult(
                    skill=skill,
                    match_type="manual",
                    confidence=1.0,
                )
            else:
                logger.warning(
                    f"[SkillRouter] 指定的 Skill 不存在: {skill_name}, 回退到自动路由"
            )

        # 2. book_type 匹配
        if book_type:
            skill = self._match_by_book_type(book_type)
            if skill:
                logger.info(
                    f"[SkillRouter] book_type 匹配: {skill.name} (book_type={book_type})"
                )
                return RoutingResult(
                    skill=skill,
                    match_type="book_type",
                    confidence=1.0,
                )

        # 3. keyword 评分
        if query:
            skill, matched_keywords, score = self._match_by_keywords(query)
            if skill:
                logger.info(
                    f"[SkillRouter] keyword 匹配: {skill.name} "
                    f"(score={score:.2f}, keywords={matched_keywords})"
                )
                return RoutingResult(
                    skill=skill,
                    match_type="keyword",
                    confidence=score,
                    matched_keywords=matched_keywords,
                )

        # 4. 默认 Skill
        default_skill = self.registry.get_default()
        if default_skill:
            logger.info(f"[SkillRouter] 使用默认 Skill: {default_skill.name}")
            return RoutingResult(
                skill=default_skill,
                match_type="default",
                confidence=0.0,
            )

        # 5. 没有任何可用 Skill - 返回 None，使用主 Agent 默认行为
        logger.info("[SkillRouter] 没有匹配到任何 Skill，使用主 Agent 默认行为")
        return RoutingResult(
            skill=None,
            match_type="none",
            confidence=0.0,
        )

    def _match_by_book_type(self, book_type: str) -> Optional[Skill]:
        """
        按书籍类型匹配 Skill

        Args:
            book_type: 书籍类型

        Returns:
            匹配的 Skill，如果没有匹配返回 None
        """
        for skill in self.registry.list_all():
            if skill.book_types and book_type in skill.book_types:
                return skill
        return None

    def _match_by_keywords(
        self, query: str
    ) -> Tuple[Optional[Skill], List[str], float]:
        """
        按关键词匹配 Skill

        使用加权评分进行匹配：
        1. 短语/多词关键词匹配权重更高
        2. 精确匹配权重更高
        3. 考虑匹配关键词的覆盖率和绝对数量

        Args:
            query: 用户查询

        Returns:
            (匹配的 Skill, 匹配的关键词列表, 评分)
        """
        best_skill: Optional[Skill] = None
        best_keywords: List[str] = []
        best_score: float = 0.0

        query_lower = query.lower()

        for skill in self.registry.list_all():
            if not skill.keywords:
                continue

            matched = []
            skill_score = 0.0

            for keyword in skill.keywords:
                keyword_lower = keyword.lower()
                if keyword_lower in query_lower:
                    matched.append(keyword)
                    # 加权评分：
                    # - 多词短语（包含空格）权重更高，因为更具体
                    # - 较长的关键词权重更高
                    keyword_words = keyword.split()
                    if len(keyword_words) > 1:
                        # 短语匹配，权重 2.0
                        skill_score += 2.0
                    else:
                        # 单词匹配，权重 1.0
                        skill_score += 1.0
                    # 额外奖励：关键词长度（越长越具体）
                    skill_score += len(keyword) * 0.01

            if skill_score > best_score:
                best_skill = skill
                best_keywords = matched
                # 最终评分 = 加权得分 / (关键词数量 * 2.0) 归一化到 0-1
                max_possible_score = len(skill.keywords) * 2.0
                best_score = skill_score / max_possible_score if max_possible_score > 0 else 0.0

        return best_skill, best_keywords, best_score
