# tests/test_skills_loader.py
"""
Skill 文件加载器测试
"""
import pytest
import tempfile
from pathlib import Path
from deeppdf.skills.loader import SkillLoader
from deeppdf.skills.models import Skill


class TestSkillLoader:
    def test_load_simple_skill(self):
        """测试加载简单的 Skill 文件"""
        skill_content = '''---
name: test-skill
description: 测试技能描述
---

你是一个专业的阅读助手。
专注于帮助用户理解文档内容。
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write(skill_content)
            f.flush()

            loader = SkillLoader()
            skill = loader.load_file(Path(f.name))

            assert skill is not None
            assert skill.name == "test-skill"
            assert skill.description == "测试技能描述"
            assert "专业的阅读助手" in skill.prompt_content

            Path(f.name).unlink()

    def test_load_skill_with_tools(self):
        """测试加载带工具配置的 Skill"""
        skill_content = '''---
name: academic-reading
description: 学术论文阅读
tools:
  - inspect_toc
  - hybrid_search
  - read_page
default_params:
  hybrid_search:
    top_k: 10
keywords:
  - 论文
  - 学术
  - 研究
book_types:
  - academic_paper
  - thesis
---

你是一位专业的学术阅读助手。
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write(skill_content)
            f.flush()

            loader = SkillLoader()
            skill = loader.load_file(Path(f.name))

            assert skill.name == "academic-reading"
            assert skill.tools == ["inspect_toc", "hybrid_search", "read_page"]
            assert skill.default_params == {"hybrid_search": {"top_k": 10}}
            assert "论文" in skill.keywords

            Path(f.name).unlink()

    def test_load_skill_with_meta(self):
        """测试加载带元数据的 Skill"""
        skill_content = '''---
name: fiction-reading
description: 小说阅读
meta:
  version: "1.0"
  author: DeepReader Team
  tags:
    - fiction
    - entertainment
---

你是一位专业的文学阅读助手。
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write(skill_content)
            f.flush()

            loader = SkillLoader()
            skill = loader.load_file(Path(f.name))

            assert skill.name == "fiction-reading"
            assert skill.meta is not None
            assert skill.meta.version == "1.0"
            assert skill.meta.author == "DeepReader Team"
            assert "fiction" in skill.meta.tags

            Path(f.name).unlink()

    def test_load_directory(self):
        """测试加载目录下的所有 Skill 文件"""
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir = Path(tmpdir)

            # 创建多个 skill 文件
            skill1 = tmpdir / "skill1.md"
            skill1.write_text('''---
name: skill1
description: 技能1
---
内容1
''')
            skill2 = tmpdir / "skill2.md"
            skill2.write_text('''---
name: skill2
description: 技能2
---
内容2
''')
            # 创建非 md 文件（应被忽略）
            other_file = tmpdir / "other.txt"
            other_file.write_text("should be ignored")

            loader = SkillLoader()
            skills = loader.load_directory(tmpdir)

            assert len(skills) == 2
            assert "skill1" in skills
            assert "skill2" in skills

    def test_invalid_skill_file(self):
        """测试加载无效的 Skill 文件"""
        # 缺少必填字段
        skill_content = '''---
description: 缺少 name 字段
---
内容
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write(skill_content)
            f.flush()

            loader = SkillLoader()
            skill = loader.load_file(Path(f.name))

            # 应该返回 None 或抛出异常
            assert skill is None

            Path(f.name).unlink()

    def test_empty_frontmatter(self):
        """测试空 frontmatter 的文件"""
        skill_content = '''---
---
没有 frontmatter 的内容
'''
        with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False) as f:
            f.write(skill_content)
            f.flush()

            loader = SkillLoader()
            skill = loader.load_file(Path(f.name))

            # 应该返回 None
            assert skill is None

            Path(f.name).unlink()
