# tests/test_skills_registry.py
"""
Skill 注册表测试
"""
import pytest
import tempfile
from pathlib import Path
from deeppdf.skills.registry import SkillRegistry
from deeppdf.skills.models import Skill
from deeppdf.skills.loader import SkillLoader


class TestSkillRegistry:
    @pytest.fixture
    def sample_skills(self):
        """创建示例 Skills"""
        return {
            "academic": Skill(
                name="academic",
                description="学术论文阅读",
                keywords=["论文", "学术", "研究"],
                book_types=["academic_paper", "thesis"],
                prompt_content="学术阅读助手",
            ),
            "fiction": Skill(
                name="fiction",
                description="小说阅读",
                keywords=["小说", "故事", "文学"],
                book_types=["novel", "fiction"],
                prompt_content="小说阅读助手",
            ),
            "general": Skill(
                name="general",
                description="通用阅读",
                prompt_content="通用阅读助手",
            ),
        }

    def test_registry_register(self, sample_skills):
        """测试注册 Skill"""
        registry = SkillRegistry()

        registry.register(sample_skills["academic"])
        registry.register(sample_skills["fiction"])

        assert registry.has("academic")
        assert registry.has("fiction")
        assert not registry.has("nonexistent")

    def test_registry_get(self, sample_skills):
        """测试获取 Skill"""
        registry = SkillRegistry()
        registry.register(sample_skills["academic"])

        skill = registry.get("academic")
        assert skill is not None
        assert skill.name == "academic"

        # 获取不存在的 Skill
        assert registry.get("nonexistent") is None

    def test_registry_list(self, sample_skills):
        """测试列出所有 Skills"""
        registry = SkillRegistry()
        for skill in sample_skills.values():
            registry.register(skill)

        all_skills = registry.list_all()
        assert len(all_skills) == 3
        names = [s.name for s in all_skills]
        assert "academic" in names
        assert "fiction" in names
        assert "general" in names

    def test_registry_override(self, sample_skills):
        """测试 Skill 覆盖（用户 Skill 覆盖内置 Skill）"""
        registry = SkillRegistry()

        # 注册内置 Skill
        builtin = Skill(
            name="test",
            description="内置版本",
            prompt_content="内置内容",
            is_builtin=True,
        )
        registry.register(builtin)

        # 注册用户 Skill（同名）
        user = Skill(
            name="test",
            description="用户版本",
            prompt_content="用户内容",
            is_builtin=False,
        )
        registry.register(user)

        # 用户版本应该覆盖内置版本
        skill = registry.get("test")
        assert skill.description == "用户版本"
        assert skill.is_builtin == False

    def test_registry_load_from_directory(self):
        """测试从目录加载 Skills"""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir = Path(tmpdir)

            # 创建测试 Skill 文件
            skill_file = tmpdir / "test-skill.md"
            skill_file.write_text('''---
name: test-skill
description: 测试技能
---
测试内容
''')

            registry = SkillRegistry()
            count = registry.load_from_directory(tmpdir)

            assert count == 1
            assert registry.has("test-skill")

    def test_registry_clear(self, sample_skills):
        """测试清空注册表"""
        registry = SkillRegistry()
        for skill in sample_skills.values():
            registry.register(skill)

        assert len(registry.list_all()) == 3

        registry.clear()
        assert len(registry.list_all()) == 0

    def test_registry_get_default_skill(self, sample_skills):
        """测试获取默认 Skill"""
        registry = SkillRegistry()
        for skill in sample_skills.values():
            registry.register(skill)

        # 设置默认 Skill
        registry.set_default("general")

        default = registry.get_default()
        assert default is not None
        assert default.name == "general"

    def test_registry_builtin_detection(self):
        """测试内置 Skill 检测"""
        registry = SkillRegistry()

        builtin = Skill(
            name="builtin-skill",
            description="内置",
            is_builtin=True,
        )
        user = Skill(
            name="user-skill",
            description="用户",
            is_builtin=False,
        )

        registry.register(builtin)
        registry.register(user)

        builtin_skills = registry.list_builtin()
        user_skills = registry.list_user()

        assert len(builtin_skills) == 1
        assert len(user_skills) == 1
        assert builtin_skills[0].name == "builtin-skill"
        assert user_skills[0].name == "user-skill"
