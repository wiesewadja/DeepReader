# tests/test_skills_router.py
"""
Skill 路由器测试
"""
import pytest
from deeppdf.skills.router import SkillRouter, RoutingResult
from deeppdf.skills.models import Skill
from deeppdf.skills.registry import SkillRegistry


from typing import Dict, List


class TestSkillRouter:
    @pytest.fixture
    def registry_with_skills(self):
        """创建包含测试 Skills 的注册表"""
        registry = SkillRegistry()

        # 学术论文 Skill
        registry.register(
            Skill(
                name="academic",
                description="学术论文阅读",
                keywords=["论文", "学术", "研究", "paper", "research"],
                book_types=["academic_paper", "thesis"],
                prompt_content="学术阅读助手",
            )
        )

        # 小说阅读 Skill
        registry.register(
            Skill(
                name="fiction",
                description="小说阅读",
                keywords=["小说", "故事", "文学", "novel", "story"],
                book_types=["novel", "fiction"],
                prompt_content="小说阅读助手",
            )
        )

        # 通用阅读 Skill（默认）
        registry.register(
            Skill(
                name="general",
                description="通用阅读",
                prompt_content="通用阅读助手",
            )
        )
        registry.set_default("general")

        return registry

    @pytest.fixture
    def router(self, registry_with_skills):
        """创建路由器"""
        return SkillRouter(registry_with_skills)

    def test_manual_override(self, router):
        """测试手动指定 Skill"""
        result = router.route(skill_name="academic")

        assert result.skill.name == "academic"
        assert result.match_type == "manual"

    def test_route_by_book_type(self, router):
        """测试按书籍类型路由"""
        result = router.route(book_type="academic_paper")

        assert result.skill.name == "academic"
        assert result.match_type == "book_type"

        result = router.route(book_type="novel")
        assert result.skill.name == "fiction"
        assert result.match_type == "book_type"

    def test_route_by_keyword(self, router):
        """测试按关键词路由"""
        # 完全匹配
        result = router.route(query="这篇论文的研究方法是什么？")
        assert result.skill.name == "academic"
        assert result.match_type == "keyword"
        assert "论文" in result.matched_keywords

        # 多关键词匹配
        result = router.route(query="这本小说的故事情节如何？")
        assert result.skill.name == "fiction"
        assert result.match_type == "keyword"

    def test_route_default(self, router):
        """测试默认路由"""
        # 无匹配信息
        result = router.route()

        assert result.skill.name == "general"
        assert result.match_type == "default"

    def test_route_priority(self, router):
        """测试路由优先级：手动 > book_type > keyword > default"""
        # 手动指定优先级最高
        result = router.route(skill_name="fiction", book_type="academic_paper", query="论文")
        assert result.skill.name == "fiction"
        assert result.match_type == "manual"

        # book_type 优先于 keyword
        result = router.route(book_type="novel", query="论文研究")
        assert result.skill.name == "fiction"
        assert result.match_type == "book_type"

    def test_route_no_match(self, router):
        """测试无匹配时的默认行为"""
        # 未知书籍类型，无关键词匹配
        result = router.route(book_type="unknown_type", query="普通内容")

        assert result.skill.name == "general"
        assert result.match_type == "default"

    def test_keyword_scoring(self, router):
        """测试关键词评分机制"""
        # 多个 Skill 都有关键词，应该选择匹配度最高的
        result = router.route(query="这是一篇关于学术研究的故事")

        # 学术论文匹配到 "学术"、"研究"（2个）
        # 小说匹配到 "故事"（1个）
        # 应该选择学术
        assert result.skill.name == "academic"
        assert result.match_type == "keyword"
