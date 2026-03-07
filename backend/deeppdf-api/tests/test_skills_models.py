# tests/test_skills_models.py
"""
Skills 数据模型测试
"""
import pytest
from deeppdf.skills.models import Skill, SkillMeta, SkillConfig


class TestSkillModels:
    def test_skill_creation_minimal(self):
        """测试最小化 Skill 创建"""
        skill = Skill(
            name="test-skill",
            description="测试技能描述",
        )
        assert skill.name == "test-skill"
        assert skill.description == "测试技能描述"
        assert skill.tools is None
        assert skill.default_params is None

    def test_skill_creation_full(self):
        """测试完整 Skill 创建"""
        skill = Skill(
            name="academic-reading",
            description="学术论文阅读",
            tools=["inspect_toc", "hybrid_search", "read_page"],
            default_params={
                "hybrid_search": {"top_k": 10},
                "read_page": {"force_visual": False}
            },
            keywords=["论文", "学术", "研究"],
            book_types=["academic_paper", "thesis"],
            prompt_content="你是一位专业的学术阅读助手...",
        )
        assert skill.name == "academic-reading"
        assert skill.tools == ["inspect_toc", "hybrid_search", "read_page"]
        assert skill.keywords == ["论文", "学术", "研究"]
        assert skill.book_types == ["academic_paper", "thesis"]

    def test_skill_config(self):
        """测试 SkillConfig 配置"""
        config = SkillConfig(
            active_skill="academic-reading",
            override_params={"temperature": 0.7}
        )
        assert config.active_skill == "academic-reading"
        assert config.override_params == {"temperature": 0.7}

    def test_skill_meta(self):
        """测试 SkillMeta 元数据"""
        meta = SkillMeta(
            version="1.0",
            author="DeepReader Team",
            tags=["academic", "reading"]
        )
        assert meta.version == "1.0"
        assert meta.author == "DeepReader Team"
        assert meta.tags == ["academic", "reading"]

    def test_skill_optional_fields(self):
        """测试可选字段"""
        skill = Skill(
            name="minimal",
            description="最小配置",
        )
        # 可选字段应为 None 或默认值
        assert skill.keywords is None
        assert skill.book_types is None
        assert skill.prompt_content is None
        assert skill.meta is None

    def test_skill_model_validate(self):
        """测试 Pydantic 模型验证"""
        # 有效数据
        valid_data = {
            "name": "test",
            "description": "测试",
            "tools": ["tool1", "tool2"]
        }
        skill = Skill.model_validate(valid_data)
        assert skill.name == "test"

        # 缺少必填字段应报错
        with pytest.raises(Exception):
            Skill.model_validate({"description": "缺少 name"})
