# DeepReader Skills 平台实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 DeepReader 构建可扩展的阅读技能系统，让用户可以为不同类型文档定制 Agent 行为，支持自动路由匹配和手动切换。

**Architecture:** 采用"组合合并"策略，Skill 文件定义 Prompt 和工具配置，后端加载内置和用户 Skills，通过 SkillRouter 自动匹配或手动指定，最终与工具格式说明合并注入 Agent。

**Tech Stack:** Python FastAPI (后端), TypeScript (前端), Markdown + YAML frontmatter (Skill 文件格式)

---

## Phase 1: 后端核心模块

### Task 1.1: Skills 数据模型定义

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/skills/__init__.py`
- Create: `backend/deeppdf-api/src/deeppdf/skills/models.py`
- Test: `backend/deeppdf-api/tests/test_skills_models.py`

**Step 1: Write the failing test**

```python
# tests/test_skills_models.py
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
            book_types=["academic", "thesis"],
            output_format="academic",
            prompt_content="# 学术论文阅读\n\n你是学术阅读助手...",
            source="builtin"
        )
        assert skill.name == "academic-reading"
        assert len(skill.tools) == 3
        assert skill.default_params["hybrid_search"]["top_k"] == 10
        assert "论文" in skill.keywords

    def test_skill_meta(self):
        """测试 Skill 元信息"""
        meta = SkillMeta(
            name="test-skill",
            description="测试",
            source="user",
            is_active=True
        )
        assert meta.name == "test-skill"
        assert meta.source == "user"

    def test_skill_config(self):
        """测试 Skill 配置"""
        config = SkillConfig(
            skill_name="academic-reading",
            allowed_tools=["hybrid_search"],
            tool_params={"hybrid_search": {"top_k": 5}},
            system_prompt="你是学术助手..."
        )
        assert config.skill_name == "academic-reading"
        assert "hybrid_search" in config.allowed_tools
```

**Step 2: Run test to verify it fails**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_skills_models.py -v
```

Expected: FAIL (ModuleNotFoundError)

**Step 3: Implement the models**

```python
# src/deeppdf/skills/__init__.py
"""Skills 模块 - 可扩展阅读技能系统"""

from .models import Skill, SkillMeta, SkillConfig

__all__ = ["Skill", "SkillMeta", "SkillConfig"]
```

```python
# src/deeppdf/skills/models.py
"""Skills 数据模型定义"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class SkillMeta(BaseModel):
    """Skill 元信息（用于列表展示）"""

    name: str = Field(..., description="Skill 唯一标识符")
    description: str = Field(..., description="简短描述")
    source: str = Field("builtin", description="来源: builtin 或 user")
    is_active: bool = Field(False, description="是否为当前激活状态")


class Skill(BaseModel):
    """完整的 Skill 定义"""

    # 必需字段
    name: str = Field(..., description="Skill 唯一标识符，仅允许字母、数字、连字符")
    description: str = Field(..., description="简短描述，用于路由匹配和 UI 展示")

    # 工具配置
    tools: Optional[List[str]] = Field(None, description="可用工具列表")
    default_params: Optional[Dict[str, Dict[str, Any]]] = Field(
        None, description="工具默认参数，key 为工具名"
    )

    # 路由配置
    keywords: Optional[List[str]] = Field(None, description="路由关键词")
    book_types: Optional[List[str]] = Field(None, description="适用书籍类型")

    # 输出配置
    output_format: Optional[str] = Field(None, description="输出格式标识")

    # Prompt 内容
    prompt_content: str = Field("", description="Skill 的 Prompt 内容")

    # 元数据
    source: str = Field("builtin", description="来源: builtin 或 user")
    file_path: Optional[str] = Field(None, description="文件路径（用于调试）")


class SkillConfig(BaseModel):
    """Agent 使用的 Skill 配置（运行时）"""

    skill_name: str = Field(..., description="Skill 名称")
    allowed_tools: List[str] = Field(default_factory=list, description="允许的工具列表")
    tool_params: Dict[str, Dict[str, Any]] = Field(
        default_factory=dict, description="工具参数覆盖"
    )
    system_prompt: str = Field(..., description="完整 System Prompt")
```

**Step 4: Run test to verify it passes**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_skills_models.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/skills/__init__.py backend/deeppdf-api/src/deeppdf/skills/models.py backend/deeppdf-api/tests/test_skills_models.py
git commit -m "feat(skills): add data models for skills platform"
```

---

### Task 1.2: Skill 文件加载器

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/skills/loader.py`
- Test: `backend/deeppdf-api/tests/test_skills_loader.py`

**Step 1: Write the failing test**

```python
# tests/test_skills_loader.py
import pytest
from pathlib import Path
from deeppdf.skills.loader import SkillLoader
from deeppdf.skills.models import Skill


class TestSkillLoader:
    def test_parse_skill_file(self, tmp_path: Path):
        """测试解析 Skill 文件"""
        skill_file = tmp_path / "test-skill" / "SKILL.md"
        skill_file.parent.mkdir()

        skill_content = '''---
name: test-skill
description: 测试技能描述
tools:
  - hybrid_search
  - read_page
default_params:
  hybrid_search:
    top_k: 10
keywords:
  - 测试
  - 技能
---

# 测试技能

## 概述
这是一个测试技能的 Prompt 内容。

## 核心原则
- 原则1
- 原则2
'''
        skill_file.write_text(skill_content)

        loader = SkillLoader()
        skill = loader.parse_skill_file(skill_file)

        assert skill.name == "test-skill"
        assert skill.description == "测试技能描述"
        assert skill.tools == ["hybrid_search", "read_page"]
        assert skill.default_params["hybrid_search"]["top_k"] == 10
        assert "测试技能的 Prompt 内容" in skill.prompt_content
        assert skill.source == "user"

    def test_load_from_directory(self, tmp_path: Path):
        """测试从目录加载多个 Skills"""
        # 创建两个 skill 文件
        for name in ["skill-a", "skill-b"]:
            skill_dir = tmp_path / name
            skill_dir.mkdir()
            skill_file = skill_dir / "SKILL.md"
            skill_file.write_text(f'''---
name: {name}
description: {name} 描述
---
# {name}
Prompt 内容
''')

        loader = SkillLoader()
        skills = loader.load_from_directory(tmp_path)

        assert len(skills) == 2
        skill_names = [s.name for s in skills]
        assert "skill-a" in skill_names
        assert "skill-b" in skill_names

    def test_parse_invalid_frontmatter(self, tmp_path: Path):
        """测试解析无效 frontmatter"""
        skill_file = tmp_path / "invalid" / "SKILL.md"
        skill_file.parent.mkdir()

        # 缺少必需字段
        skill_file.write_text('''---
description: 没有name字段
---
内容
''')

        loader = SkillLoader()
        with pytest.raises(ValueError, match="name"):
            loader.parse_skill_file(skill_file)
```

**Step 2: Run test to verify it fails**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_skills_loader.py -v
```

Expected: FAIL

**Step 3: Implement the loader**

```python
# src/deeppdf/skills/loader.py
"""Skill 文件加载器"""

import logging
import re
from pathlib import Path
from typing import Dict, List, Optional

import yaml

from .models import Skill

logger = logging.getLogger(__name__)


class SkillLoader:
    """Skill 文件加载器，支持 Markdown + YAML frontmatter 格式"""

    # Frontmatter 正则模式
    FRONTMATTER_PATTERN = re.compile(
        r"^---\s*\n(.*?)\n---\s*\n(.*)$",
        re.DOTALL
    )

    def parse_skill_file(self, file_path: Path, source: str = "user") -> Skill:
        """
        解析单个 Skill 文件

        Args:
            file_path: Skill 文件路径
            source: 来源标识 ("builtin" 或 "user")

        Returns:
            Skill 对象

        Raises:
            ValueError: 解析失败
        """
        if not file_path.exists():
            raise ValueError(f"Skill 文件不存在: {file_path}")

        content = file_path.read_text(encoding="utf-8")

        # 解析 frontmatter 和正文
        frontmatter, prompt_content = self._parse_content(content)

        # 验证必需字段
        if "name" not in frontmatter:
            raise ValueError(f"Skill 文件缺少必需字段 'name': {file_path}")
        if "description" not in frontmatter:
            raise ValueError(f"Skill 文件缺少必需字段 'description': {file_path}")

        # 创建 Skill 对象
        skill = Skill(
            name=frontmatter["name"],
            description=frontmatter["description"],
            tools=frontmatter.get("tools"),
            default_params=frontmatter.get("default_params"),
            keywords=frontmatter.get("keywords"),
            book_types=frontmatter.get("book_types"),
            output_format=frontmatter.get("output_format"),
            prompt_content=prompt_content.strip(),
            source=source,
            file_path=str(file_path),
        )

        logger.info(f"[SkillLoader] 已加载 Skill: {skill.name} (source={source})")
        return skill

    def _parse_content(self, content: str) -> tuple[Dict[str, any], str]:
        """
        解析文件内容，提取 frontmatter 和正文

        Args:
            content: 文件完整内容

        Returns:
            (frontmatter_dict, prompt_content) 元组
        """
        match = self.FRONTMATTER_PATTERN.match(content)

        if not match:
            raise ValueError("Skill 文件格式无效：缺少 YAML frontmatter")

        frontmatter_yaml = match.group(1)
        prompt_content = match.group(2)

        try:
            frontmatter = yaml.safe_load(frontmatter_yaml)
        except yaml.YAMLError as e:
            raise ValueError(f"Skill 文件 frontmatter YAML 解析失败: {e}") from e

        if not isinstance(frontmatter, dict):
            raise ValueError("Skill 文件 frontmatter 必须是 YAML 对象")

        return frontmatter, prompt_content

    def load_from_directory(
        self,
        directory: Path,
        source: str = "user"
    ) -> List[Skill]:
        """
        从目录加载所有 Skills

        目录结构期望：
        directory/
          skill-name-1/
            SKILL.md
          skill-name-2/
            SKILL.md

        Args:
            directory: Skills 目录路径
            source: 来源标识

        Returns:
            Skill 列表
        """
        skills: List[Skill] = []

        if not directory.exists():
            logger.warning(f"[SkillLoader] Skills 目录不存在: {directory}")
            return skills

        for skill_dir in directory.iterdir():
            if not skill_dir.is_dir():
                continue

            skill_file = skill_dir / "SKILL.md"
            if not skill_file.exists():
                logger.warning(f"[SkillLoader] 跳过目录（缺少 SKILL.md）: {skill_dir}")
                continue

            try:
                skill = self.parse_skill_file(skill_file, source=source)
                skills.append(skill)
            except ValueError as e:
                logger.error(f"[SkillLoader] 加载 Skill 失败: {skill_file}: {e}")

        logger.info(f"[SkillLoader] 从 {directory} 加载了 {len(skills)} 个 Skills")
        return skills
```

**Step 4: Run test to verify it passes**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_skills_loader.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/skills/loader.py backend/deeppdf-api/tests/test_skills_loader.py
git commit -m "feat(skills): add skill file loader with YAML frontmatter support"
```

---

### Task 1.3: Skill 注册中心

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/skills/registry.py`
- Test: `backend/deeppdf-api/tests/test_skills_registry.py`

**Step 1: Write the failing test**

```python
# tests/test_skills_registry.py
import pytest
from pathlib import Path
from deeppdf.skills.registry import SkillRegistry
from deeppdf.skills.models import Skill


class TestSkillRegistry:
    def test_register_and_get_skill(self, tmp_path: Path):
        """测试注册和获取 Skill"""
        registry = SkillRegistry(
            builtin_skills_path=tmp_path / "builtin",
            user_skills_path=tmp_path / "user"
        )

        skill = Skill(
            name="test-skill",
            description="测试",
            prompt_content="测试内容",
            source="user"
        )

        registry.register_skill(skill)
        retrieved = registry.get_skill("test-skill")

        assert retrieved is not None
        assert retrieved.name == "test-skill"

    def test_user_skill_overwrites_builtin(self, tmp_path: Path):
        """测试用户 Skill 覆盖内置 Skill"""
        registry = SkillRegistry(
            builtin_skills_path=tmp_path / "builtin",
            user_skills_path=tmp_path / "user"
        )

        builtin = Skill(
            name="same-name",
            description="内置版本",
            prompt_content="内置内容",
            source="builtin"
        )
        user = Skill(
            name="same-name",
            description="用户版本",
            prompt_content="用户内容",
            source="user"
        )

        registry.register_skill(builtin)
        registry.register_skill(user)

        retrieved = registry.get_skill("same-name")
        assert retrieved.description == "用户版本"
        assert retrieved.source == "user"

    def test_list_skills(self, tmp_path: Path):
        """测试列出 Skills"""
        registry = SkillRegistry(
            builtin_skills_path=tmp_path / "builtin",
            user_skills_path=tmp_path / "user"
        )

        for i in range(3):
            registry.register_skill(Skill(
                name=f"skill-{i}",
                description=f"描述 {i}",
                prompt_content=f"内容 {i}",
                source="builtin" if i == 0 else "user"
            ))

        metas = registry.list_skills()
        assert len(metas) == 3

        # 按名称排序检查
        names = [m.name for m in metas]
        assert "skill-0" in names
        assert "skill-1" in names
        assert "skill-2" in names

    def test_reload_all(self, tmp_path: Path):
        """测试重新加载所有 Skills"""
        builtin_path = tmp_path / "builtin"
        user_path = tmp_path / "user"
        builtin_path.mkdir()
        user_path.mkdir()

        # 创建内置 skill
        builtin_dir = builtin_path / "builtin-skill"
        builtin_dir.mkdir()
        (builtin_dir / "SKILL.md").write_text('''---
name: builtin-skill
description: 内置技能
---
内置内容
''')

        # 创建用户 skill
        user_dir = user_path / "user-skill"
        user_dir.mkdir()
        (user_dir / "SKILL.md").write_text('''---
name: user-skill
description: 用户技能
---
用户内容
''')

        registry = SkillRegistry(
            builtin_skills_path=builtin_path,
            user_skills_path=user_path
        )
        registry.reload_all()

        assert registry.get_skill("builtin-skill") is not None
        assert registry.get_skill("user-skill") is not None

    def test_get_default_skill(self, tmp_path: Path):
        """测试获取默认 Skill"""
        registry = SkillRegistry(
            builtin_skills_path=tmp_path / "builtin",
            user_skills_path=tmp_path / "user"
        )

        default = registry.get_default_skill()
        assert default.name == "general-reading"
```

**Step 2: Run test to verify it fails**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_skills_registry.py -v
```

Expected: FAIL

**Step 3: Implement the registry**

```python
# src/deeppdf/skills/registry.py
"""Skill 注册中心 - 管理所有已加载的 Skills"""

import logging
from pathlib import Path
from typing import Dict, List, Optional

from .models import Skill, SkillMeta
from .loader import SkillLoader

logger = logging.getLogger(__name__)


# 默认兜底 Skill（当没有其他 Skill 可用时使用）
DEFAULT_SKILL = Skill(
    name="general-reading",
    description="通用阅读助手，适用于各类文档的默认阅读模式",
    tools=["inspect_toc", "hybrid_search", "read_page"],
    default_params={
        "hybrid_search": {"top_k": 5},
        "read_page": {"force_visual": False}
    },
    prompt_content="""# 通用阅读

## 概述

你是一位智能阅读助手，帮助用户理解和探索各类文档内容。

## 核心原则

**准确引用**: 引用内容时标注页码

**清晰表达**: 用简洁的语言回答问题

**主动探索**: 根据问题主动查找相关内容

## 行为准则

1. 根据问题选择合适的工具
2. 引用内容时使用 `[[文件名.md#^page-N|第N页]]` 格式
3. 不确定时先查看目录了解结构

## 输出格式

- 直接回答问题
- 引用时标注页码
- 使用自然的对话风格
""",
    source="system"
)


class SkillRegistry:
    """Skill 注册中心"""

    def __init__(
        self,
        builtin_skills_path: Optional[Path] = None,
        user_skills_path: Optional[Path] = None
    ):
        """
        初始化注册中心

        Args:
            builtin_skills_path: 内置 Skills 目录路径
            user_skills_path: 用户 Skills 目录路径
        """
        self._skills: Dict[str, Skill] = {}
        self._loader = SkillLoader()
        self._builtin_path = builtin_skills_path
        self._user_path = user_skills_path

        # 注册默认 Skill
        self._skills[DEFAULT_SKILL.name] = DEFAULT_SKILL

    def reload_all(self) -> None:
        """重新加载所有 Skills（内置 + 用户）"""
        # 清空现有 Skills（保留默认）
        self._skills = {DEFAULT_SKILL.name: DEFAULT_SKILL}

        # 加载内置 Skills
        if self._builtin_path:
            builtin_skills = self._loader.load_from_directory(
                self._builtin_path, source="builtin"
            )
            for skill in builtin_skills:
                self._skills[skill.name] = skill
            logger.info(f"[SkillRegistry] 加载了 {len(builtin_skills)} 个内置 Skills")

        # 加载用户 Skills（覆盖同名内置）
        if self._user_path:
            user_skills = self._loader.load_from_directory(
                self._user_path, source="user"
            )
            for skill in user_skills:
                self._skills[skill.name] = skill
                if skill.name in [s.name for s in builtin_skills]:
                    logger.info(f"[SkillRegistry] 用户 Skill 覆盖内置: {skill.name}")
            logger.info(f"[SkillRegistry] 加载了 {len(user_skills)} 个用户 Skills")

        total = len(self._skills)
        logger.info(f"[SkillRegistry] 总计 {total} 个 Skills 可用")

    def register_skill(self, skill: Skill) -> None:
        """
        注册 Skill（会覆盖同名 Skill）

        Args:
            skill: Skill 对象
        """
        self._skills[skill.name] = skill
        logger.debug(f"[SkillRegistry] 注册 Skill: {skill.name} (source={skill.source})")

    def get_skill(self, name: str) -> Optional[Skill]:
        """
        获取 Skill

        Args:
            name: Skill 名称

        Returns:
            Skill 对象，不存在返回 None
        """
        return self._skills.get(name)

    def get_default_skill(self) -> Skill:
        """获取默认 Skill"""
        return DEFAULT_SKILL

    def list_skills(self) -> List[SkillMeta]:
        """
        列出所有 Skills 元信息

        Returns:
            SkillMeta 列表
        """
        metas = []
        for skill in self._skills.values():
            metas.append(SkillMeta(
                name=skill.name,
                description=skill.description,
                source=skill.source,
                is_active=False  # 由外部设置
            ))
        return metas

    def get_all_skills(self) -> List[Skill]:
        """获取所有 Skill 对象"""
        return list(self._skills.values())
```

**Step 4: Run test to verify it passes**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_skills_registry.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/skills/registry.py backend/deeppdf-api/tests/test_skills_registry.py
git commit -m "feat(skills): add skill registry with builtin/user skill support"
```

---

### Task 1.4: Skill 路由器

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/skills/router.py`
- Test: `backend/deeppdf-api/tests/test_skills_router.py`

**Step 1: Write the failing test**

```python
# tests/test_skills_router.py
import pytest
from deeppdf.skills.router import SkillRouter
from deeppdf.skills.models import Skill


class TestSkillRouter:
    @pytest.fixture
    def router_with_skills(self):
        """创建带测试 Skills 的路由器"""
        skills = [
            Skill(
                name="academic-reading",
                description="学术论文阅读",
                keywords=["论文", "研究", "学术", "引用"],
                book_types=["academic", "thesis"],
                prompt_content="学术助手"
            ),
            Skill(
                name="fiction-reading",
                description="小说阅读",
                keywords=["小说", "故事", "人物", "情节"],
                book_types=["fiction", "novel"],
                prompt_content="小说助手"
            ),
            Skill(
                name="technical-docs",
                description="技术文档阅读",
                keywords=["API", "配置", "安装", "使用"],
                book_types=["technical", "manual"],
                prompt_content="技术助手"
            ),
        ]
        return SkillRouter(skills)

    def test_match_by_book_type(self, router_with_skills):
        """测试按书籍类型匹配"""
        skill = router_with_skills.match_skill(
            query="这本书讲了什么",
            book_metadata={"type": "academic"}
        )
        assert skill.name == "academic-reading"

    def test_match_by_keywords(self, router_with_skills):
        """测试按关键词匹配"""
        skill = router_with_skills.match_skill(
            query="这篇论文的核心观点是什么",
            book_metadata={}
        )
        assert skill.name == "academic-reading"

    def test_match_by_book_type_priority(self, router_with_skills):
        """测试书籍类型优先级高于关键词"""
        # 查询包含"小说"关键词，但书籍类型是 academic
        skill = router_with_skills.match_skill(
            query="这个小说的情节怎么样",
            book_metadata={"type": "academic"}
        )
        # 应该按书籍类型匹配，而不是关键词
        assert skill.name == "academic-reading"

    def test_return_default_when_no_match(self, router_with_skills):
        """测试无匹配时返回默认"""
        skill = router_with_skills.match_skill(
            query="随便看看",
            book_metadata={}
        )
        assert skill.name == "general-reading"

    def test_manual_override(self, router_with_skills):
        """测试手动指定优先"""
        skill = router_with_skills.match_skill(
            query="这篇论文的核心观点",
            book_metadata={"type": "academic"},
            manual_skill_name="fiction-reading"
        )
        assert skill.name == "fiction-reading"

    def test_keyword_scoring(self, router_with_skills):
        """测试关键词评分机制"""
        # 查询包含多个学术关键词
        skill = router_with_skills.match_skill(
            query="这篇研究论文的引用方法是什么",
            book_metadata={}
        )
        assert skill.name == "academic-reading"
```

**Step 2: Run test to verify it fails**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_skills_router.py -v
```

Expected: FAIL

**Step 3: Implement the router**

```python
# src/deeppdf/skills/router.py
"""Skill 路由器 - 自动匹配最合适的 Skill"""

import logging
from typing import Any, Dict, List, Optional

from .models import Skill
from .registry import DEFAULT_SKILL

logger = logging.getLogger(__name__)


class SkillRouter:
    """Skill 自动路由匹配器"""

    def __init__(self, skills: List[Skill]):
        """
        初始化路由器

        Args:
            skills: 可用 Skill 列表
        """
        self._skills = skills

    def match_skill(
        self,
        query: str,
        book_metadata: Dict[str, Any],
        manual_skill_name: Optional[str] = None
    ) -> Skill:
        """
        匹配最合适的 Skill

        优先级：
        1. 手动指定 > 自动匹配
        2. 书籍类型匹配 > 关键词匹配 > 默认

        Args:
            query: 用户查询
            book_metadata: 书籍元数据
            manual_skill_name: 手动指定的 Skill 名称

        Returns:
            匹配的 Skill 对象
        """
        # 1. 手动指定
        if manual_skill_name:
            skill = self._find_skill_by_name(manual_skill_name)
            if skill:
                logger.info(f"[SkillRouter] 手动指定 Skill: {skill.name}")
                return skill
            else:
                logger.warning(
                    f"[SkillRouter] 手动指定的 Skill 不存在: {manual_skill_name}"
                )

        # 2. 书籍类型匹配
        skill = self._match_by_book_type(book_metadata)
        if skill:
            logger.info(
                f"[SkillRouter] 按书籍类型匹配: {skill.name} "
                f"(type={book_metadata.get('type')})"
            )
            return skill

        # 3. 关键词匹配
        skill = self._match_by_keywords(query)
        if skill:
            logger.info(f"[SkillRouter] 按关键词匹配: {skill.name}")
            return skill

        # 4. 返回默认
        logger.info("[SkillRouter] 无匹配，返回默认 Skill")
        return DEFAULT_SKILL

    def _find_skill_by_name(self, name: str) -> Optional[Skill]:
        """按名称查找 Skill"""
        for skill in self._skills:
            if skill.name == name:
                return skill
        return None

    def _match_by_book_type(
        self,
        book_metadata: Dict[str, Any]
    ) -> Optional[Skill]:
        """基于书籍元数据匹配"""
        book_type = book_metadata.get("type")
        if not book_type:
            return None

        for skill in self._skills:
            if skill.book_types and book_type in skill.book_types:
                return skill

        return None

    def _match_by_keywords(self, query: str) -> Optional[Skill]:
        """基于查询关键词匹配"""
        query_lower = query.lower()

        # 计算每个 skill 的匹配分数
        scores: List[tuple[Skill, int]] = []

        for skill in self._skills:
            if not skill.keywords:
                continue

            score = sum(
                1 for kw in skill.keywords
                if kw.lower() in query_lower
            )

            if score > 0:
                scores.append((skill, score))

        if not scores:
            return None

        # 返回分数最高的 skill
        scores.sort(key=lambda x: x[1], reverse=True)
        return scores[0][0]
```

**Step 4: Run test to verify it passes**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_skills_router.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/skills/router.py backend/deeppdf-api/tests/test_skills_router.py
git commit -m "feat(skills): add skill router with book_type and keyword matching"
```

---

### Task 1.5: 创建内置 Skills

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/skills/builtin/academic/SKILL.md`
- Create: `backend/deeppdf-api/src/deeppdf/skills/builtin/fiction/SKILL.md`
- Create: `backend/deeppdf-api/src/deeppdf/skills/builtin/technical/SKILL.md`

**Step 1: Create academic skill**

```markdown
# backend/deeppdf-api/src/deeppdf/skills/builtin/academic/SKILL.md
---
name: academic-reading
description: 适用于学术论文、研究报告、学位论文等学术文献的深度阅读与分析
tools:
  - inspect_toc
  - hybrid_search
  - read_page
  - cross_book_search
default_params:
  hybrid_search:
    top_k: 10
  read_page:
    force_visual: false
output_format: academic
keywords:
  - 论文
  - 研究
  - 学术
  - 引用
  - 文献
  - 方法
  - 结论
book_types:
  - academic
  - thesis
  - research_report
---

# 学术论文阅读

## 概述

你是一位专注于学术研究的阅读助手。你的任务是帮助用户深入理解学术文献的核心论点、研究方法和论证逻辑。

## 核心原则

**严谨引用**: 每个论断必须有明确的出处引用，使用 Obsidian 的 `[[]]` 格式

**逻辑追踪**: 关注作者的论证链条，识别前提-论点-结论的结构

**批判思考**: 不仅总结内容，还要指出研究局限和可能的反驳

## 行为准则

1. **先看结构**: 使用 `inspect_toc` 了解论文的整体结构
2. **定位核心**: 使用 `hybrid_search` 找到关键概念和论点
3. **深度阅读**: 使用 `read_page` 阅读重要章节的完整内容
4. **交叉验证**: 适当使用 `cross_book_search` 对比其他文献

## 输出格式

回答采用学术引用风格：

- 论点陈述 + 页码引用
- 使用"作者认为..."、"研究表明..."等学术表达
- 引用格式: `[[章节.md#^page-N|第N页]]`
```

**Step 2: Create fiction skill**

```markdown
# backend/deeppdf-api/src/deeppdf/skills/builtin/fiction/SKILL.md
---
name: fiction-reading
description: 适用于小说、故事、文学作品等虚构类内容的阅读与赏析
tools:
  - inspect_toc
  - hybrid_search
  - read_page
default_params:
  hybrid_search:
    top_k: 5
  read_page:
    force_visual: false
output_format: narrative
keywords:
  - 小说
  - 故事
  - 人物
  - 情节
  - 角色
  - 结局
  - 主题
book_types:
  - fiction
  - novel
  - literature
---

# 小说阅读

## 概述

你是一位热爱文学的阅读伴侣。你的任务是帮助用户更好地理解和欣赏文学作品，关注情节、人物、主题和写作技巧。

## 核心原则

**沉浸体验**: 用生动的语言描述情节和场景，让用户感受故事的魅力

**人物追踪**: 关注角色的性格发展、动机和关系变化

**主题挖掘**: 识别作品中的深层主题和象征意义

**适度剧透**: 讨论情节时注意不要过度剧透，除非用户明确要求

## 行为准则

1. **了解全貌**: 先使用 `inspect_toc` 了解故事章节结构
2. **追踪线索**: 使用 `hybrid_search` 搜索人物名、关键词
3. **精读段落**: 使用 `read_page` 阅读关键情节

## 输出格式

回答采用叙事风格：

- 用生动的语言描述场景和情节
- 可以适当引用原文中的精彩句子
- 引用格式: `[[章节名.md#^page-N|第N页]]`
```

**Step 3: Create technical skill**

```markdown
# backend/deeppdf-api/src/deeppdf/skills/builtin/technical/SKILL.md
---
name: technical-docs
description: 适用于技术手册、API 文档、教程等技术类文档的查阅与理解
tools:
  - inspect_toc
  - hybrid_search
  - read_page
default_params:
  hybrid_search:
    top_k: 8
  read_page:
    force_visual: false
output_format: structured
keywords:
  - API
  - 配置
  - 安装
  - 使用
  - 设置
  - 参数
  - 命令
book_types:
  - technical
  - manual
  - documentation
---

# 技术文档阅读

## 概述

你是一位专业的技术文档助手。你的任务是帮助用户快速理解技术概念、查找特定信息、解决技术问题。

## 核心原则

**精准定位**: 快速找到用户需要的技术信息

**实践导向**: 不仅解释概念，还提供实际应用示例

**结构清晰**: 使用代码块、列表等格式化元素提高可读性

## 行为准则

1. **快速定位**: 使用 `hybrid_search` 直接搜索关键词
2. **精确阅读**: 使用 `read_page` 阅读相关章节
3. **避免冗余**: 不要阅读不相关的内容

## 输出格式

回答采用结构化风格：

- 使用代码块展示配置、命令
- 使用表格对比选项
- 使用步骤列表说明操作流程
- 引用格式: `[[文件名.md#^page-N|第N页]]`
```

**Step 4: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/skills/builtin/
git commit -m "feat(skills): add builtin skills for academic, fiction and technical docs"
```

---

## Phase 2: Agent 集成

### Task 2.1: 扩展 Agent 初始化以支持 Skill

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/agent/core.py`
- Test: `backend/deeppdf-api/tests/test_agent_skill_integration.py`

**Step 1: Write the failing test**

```python
# tests/test_agent_skill_integration.py
import pytest
from unittest.mock import Mock, patch
from deeppdf.agent.core import DeepPDFAgent
from deeppdf.skills.models import Skill


class TestAgentSkillIntegration:
    @pytest.fixture
    def mock_skill(self):
        return Skill(
            name="test-skill",
            description="测试技能",
            tools=["hybrid_search", "read_page"],
            default_params={
                "hybrid_search": {"top_k": 10}
            },
            prompt_content="# 测试技能\n\n你是测试助手。",
            source="builtin"
        )

    @pytest.fixture
    def agent_params(self):
        return {
            "index_id": "test-index",
            "storage_dir": "/tmp/test",
            "tree_structure": {"structure": []},
        }

    def test_agent_with_skill(self, mock_skill, agent_params):
        """测试 Agent 使用 Skill 初始化"""
        with patch("deeppdf.agent.core.create_tool_executor") as mock_executor:
            mock_executor.return_value = Mock(tools={})

            agent = DeepPDFAgent(**agent_params, skill=mock_skill)

            # 验证 System Prompt 包含 Skill 内容
            assert "测试技能" in agent.system_prompt
            assert "你是测试助手" in agent.system_prompt

    def test_agent_filters_tools_by_skill(self, mock_skill, agent_params):
        """测试 Agent 根据 Skill 过滤工具"""
        with patch("deeppdf.agent.core.create_tool_executor") as mock_executor:
            # 创建包含所有工具的 mock executor
            mock_executor.return_value = Mock(
                tools={
                    "inspect_toc": Mock(),
                    "hybrid_search": Mock(),
                    "read_page": Mock(),
                    "cross_book_search": Mock(),
                }
            )

            agent = DeepPDFAgent(**agent_params, skill=mock_skill)

            # 获取工具 schemas
            schemas = agent._get_tool_schemas_for_skill()
            tool_names = [s["function"]["name"] for s in schemas]

            # 应该只包含 Skill 指定的工具
            assert "hybrid_search" in tool_names
            assert "read_page" in tool_names
            assert "inspect_toc" not in tool_names  # Skill 未指定
```

**Step 2: Run test to verify it fails**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_agent_skill_integration.py -v
```

Expected: FAIL

**Step 3: Implement skill support in Agent**

修改 `backend/deeppdf-api/src/deeppdf/agent/core.py`:

1. 在 `__init__` 中添加 `skill` 参数
2. 使用 Skill 的 prompt_content 构建 system_prompt
3. 添加 `_get_tool_schemas_for_skill` 方法过滤工具

```python
# 在 __init__ 方法中添加 skill 参数
def __init__(
    self,
    index_id: str,
    storage_dir: str,
    tree_structure: Dict[str, Any],
    *,
    index_metadata: Optional[Dict[str, Any]] = None,
    llm_provider: str = "deepseek",
    llm_model: Optional[str] = None,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    pageindex_lib_path: Optional[str] = None,
    enable_llm_tree_search: bool = False,
    cross_book_mode: bool = False,
    temperature: Optional[float] = None,
    top_p: Optional[float] = None,
    max_iterations: Optional[int] = None,
    skill: Optional["Skill"] = None,  # 新增
):
    # ... 现有初始化代码 ...

    # 根据 skill 构建 System Prompt
    if skill:
        from .prompts import build_skill_system_prompt
        self.skill = skill
        self.system_prompt = build_skill_system_prompt(
            skill=skill,
            tool_descriptions=self.executor.get_tool_descriptions()
        )
        logger.info(f"[Agent初始化] 使用 Skill: {skill.name}")
    else:
        # 使用默认 Prompt
        self.skill = None
        # ... 现有 Prompt 构建逻辑 ...

def _get_tool_schemas_for_skill(self) -> List[Dict[str, Any]]:
    """根据 Skill 过滤工具 schemas"""
    if self.skill and self.skill.tools:
        return self._get_tool_schemas(allowed=self.skill.tools)
    return self._get_tool_schemas()
```

**Step 4: Run test to verify it passes**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_agent_skill_integration.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/agent/core.py backend/deeppdf-api/tests/test_agent_skill_integration.py
git commit -m "feat(agent): add skill support to DeepPDFAgent"
```

---

### Task 2.2: 添加 Skill Prompt 构建函数

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/agent/prompts.py`
- Test: `backend/deeppdf-api/tests/test_skill_prompt_builder.py`

**Step 1: Write the failing test**

```python
# tests/test_skill_prompt_builder.py
import pytest
from deeppdf.agent.prompts import build_skill_system_prompt
from deeppdf.skills.models import Skill


class TestSkillPromptBuilder:
    def test_build_prompt_with_skill(self):
        """测试使用 Skill 构建 Prompt"""
        skill = Skill(
            name="test-skill",
            description="测试",
            prompt_content="# 测试技能\n\n你是测试助手，请遵循以下原则...",
        )

        tool_descriptions = """## 可用工具

### hybrid_search
混合检索工具

### read_page
读取指定页面
"""

        prompt = build_skill_system_prompt(skill, tool_descriptions)

        # 验证组合合并：工具说明 + Skill Prompt
        assert "## 可用工具" in prompt
        assert "hybrid_search" in prompt
        assert "你是测试助手" in prompt

    def test_prompt_separator(self):
        """测试 Prompt 分隔符"""
        skill = Skill(
            name="test",
            description="测试",
            prompt_content="技能内容",
        )

        prompt = build_skill_system_prompt(skill, "工具说明")

        # 应该有分隔符
        assert "---" in prompt
```

**Step 2: Run test to verify it fails**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_skill_prompt_builder.py -v
```

Expected: FAIL

**Step 3: Implement the prompt builder**

在 `backend/deeppdf-api/src/deeppdf/agent/prompts.py` 中添加：

```python
def build_skill_system_prompt(skill: "Skill", tool_descriptions: str) -> str:
    """
    使用 Skill 构建 System Prompt（组合合并方式）

    结构：
    1. 工具格式说明（后端固定）
    2. 分隔符
    3. Skill 的 Prompt 内容

    Args:
        skill: Skill 对象
        tool_descriptions: 工具描述字符串

    Returns:
        完整的 System Prompt
    """
    # 工具格式说明
    tool_instructions = f"""## 工具使用说明

{tool_descriptions}

### 工具调用格式
使用 XML 标签格式调用工具：
<tool>
<name>工具名</name>
<arguments>
{{"参数名": "参数值"}}
</arguments>
</tool>
"""

    # 组合合并
    return f"{tool_instructions}\n\n---\n\n{skill.prompt_content}"
```

**Step 4: Run test to verify it passes**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_skill_prompt_builder.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/agent/prompts.py backend/deeppdf-api/tests/test_skill_prompt_builder.py
git commit -m "feat(prompts): add build_skill_system_prompt for skill-based agent"
```

---

### Task 2.3: Skills API 端点

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/api/skills_routes.py`
- Create: `backend/deeppdf-api/src/deeppdf/api/skills_models.py`
- Modify: `backend/deeppdf-api/src/deeppdf/main.py`
- Test: `backend/deeppdf-api/tests/test_skills_api.py`

**Step 1: Write the failing test**

```python
# tests/test_skills_api.py
import pytest
from fastapi.testclient import TestClient


class TestSkillsAPI:
    def test_list_skills(self, test_client: TestClient):
        """测试列出 Skills"""
        response = test_client.get("/api/skills")
        assert response.status_code == 200

        data = response.json()
        assert "skills" in data
        assert isinstance(data["skills"], list)

        # 应该包含默认的 general-reading
        skill_names = [s["name"] for s in data["skills"]]
        assert "general-reading" in skill_names

    def test_get_skill_detail(self, test_client: TestClient):
        """测试获取 Skill 详情"""
        response = test_client.get("/api/skills/general-reading")
        assert response.status_code == 200

        data = response.json()
        assert data["name"] == "general-reading"
        assert "description" in data
        assert "prompt_preview" in data

    def test_get_nonexistent_skill(self, test_client: TestClient):
        """测试获取不存在的 Skill"""
        response = test_client.get("/api/skills/nonexistent-skill")
        assert response.status_code == 404

    def test_reload_skills(self, test_client: TestClient):
        """测试重新加载 Skills"""
        response = test_client.post("/api/skills/reload")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "success"
```

**Step 2: Run test to verify it fails**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_skills_api.py -v
```

Expected: FAIL

**Step 3: Implement the API**

```python
# src/deeppdf/api/skills_models.py
"""Skills API 数据模型"""

from typing import List, Optional
from pydantic import BaseModel


class SkillMetaResponse(BaseModel):
    """Skill 元信息响应"""
    name: str
    description: str
    source: str
    is_active: bool = False


class SkillDetailResponse(BaseModel):
    """Skill 详情响应"""
    name: str
    description: str
    source: str
    tools: Optional[List[str]] = None
    keywords: Optional[List[str]] = None
    book_types: Optional[List[str]] = None
    prompt_preview: str  # 前 500 字符


class ListSkillsResponse(BaseModel):
    """Skills 列表响应"""
    skills: List[SkillMetaResponse]
    total: int


class ReloadSkillsResponse(BaseModel):
    """重新加载响应"""
    status: str
    message: str
    total_skills: int
```

```python
# src/deeppdf/api/skills_routes.py
"""Skills API 路由"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException

from .skills_models import (
    SkillMetaResponse,
    SkillDetailResponse,
    ListSkillsResponse,
    ReloadSkillsResponse,
)
from ..skills.registry import SkillRegistry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/skills", tags=["skills"])

# 全局 Registry 实例（在 main.py 中初始化）
_registry: Optional[SkillRegistry] = None


def get_registry() -> SkillRegistry:
    """获取 Registry 实例"""
    global _registry
    if _registry is None:
        raise RuntimeError("Skills registry not initialized")
    return _registry


def init_skills_registry(builtin_path, user_path) -> SkillRegistry:
    """初始化 Registry"""
    global _registry
    _registry = SkillRegistry(
        builtin_skills_path=builtin_path,
        user_skills_path=user_path
    )
    _registry.reload_all()
    return _registry


@router.get("", response_model=ListSkillsResponse)
async def list_skills():
    """列出所有可用的 Skills"""
    registry = get_registry()
    skills = registry.list_skills()

    return ListSkillsResponse(
        skills=[
            SkillMetaResponse(
                name=s.name,
                description=s.description,
                source=s.source,
                is_active=s.is_active
            )
            for s in skills
        ],
        total=len(skills)
    )


@router.get("/{skill_name}", response_model=SkillDetailResponse)
async def get_skill(skill_name: str):
    """获取 Skill 详情"""
    registry = get_registry()
    skill = registry.get_skill(skill_name)

    if not skill:
        raise HTTPException(status_code=404, detail=f"Skill not found: {skill_name}")

    # 截取 Prompt 预览
    prompt_preview = skill.prompt_content[:500]
    if len(skill.prompt_content) > 500:
        prompt_preview += "..."

    return SkillDetailResponse(
        name=skill.name,
        description=skill.description,
        source=skill.source,
        tools=skill.tools,
        keywords=skill.keywords,
        book_types=skill.book_types,
        prompt_preview=prompt_preview
    )


@router.post("/reload", response_model=ReloadSkillsResponse)
async def reload_skills():
    """重新加载所有 Skills"""
    registry = get_registry()
    registry.reload_all()

    return ReloadSkillsResponse(
        status="success",
        message="Skills reloaded successfully",
        total_skills=len(registry.list_skills())
    )
```

**Step 4: Register router in main.py**

在 `main.py` 中添加：

```python
from .api.skills_routes import router as skills_router, init_skills_registry

# 在 app.include_router 调用中添加
app.include_router(skills_router)

# 在 lifespan 或 startup 事件中初始化
@app.on_event("startup")
async def startup_event():
    # ... 其他初始化 ...

    # 初始化 Skills Registry
    from pathlib import Path
    builtin_path = Path(__file__).parent / "skills" / "builtin"
    user_path = Path(settings.storage_dir) / "DeepReader" / "skills"
    init_skills_registry(builtin_path, user_path)
```

**Step 5: Run test to verify it passes**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_skills_api.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/api/skills_routes.py backend/deeppdf-api/src/deeppdf/api/skills_models.py backend/deeppdf-api/src/deeppdf/main.py backend/deeppdf-api/tests/test_skills_api.py
git commit -m "feat(api): add skills management API endpoints"
```

---

### Task 2.4: 扩展 Agent API 支持 Skill 参数

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/api/models.py`
- Modify: `backend/deeppdf-api/src/deeppdf/api/routes.py`

**Step 1: Add skill_name to AgentRequest**

在 `models.py` 的 `AgentRequest` 中添加：

```python
class AgentRequest(BaseModel):
    """Agent 请求参数"""
    query: str
    index_id: str
    session_id: Optional[str] = None
    keep_history: bool = True
    context_docs: Optional[List[ContextDoc]] = None
    skill_name: Optional[str] = None  # 新增：指定 Skill
```

**Step 2: Use skill in agent creation**

在 `routes.py` 的 agent 端点中：

```python
@router.post("/chat/agent/stream")
async def agent_stream(request: AgentRequest):
    # ... 获取 index_metadata ...

    # 获取 Skill（如果指定）
    skill = None
    if request.skill_name:
        from ..skills.routes import get_registry
        registry = get_registry()
        skill = registry.get_skill(request.skill_name)
        if not skill:
            raise HTTPException(
                status_code=400,
                detail=f"Skill not found: {request.skill_name}"
            )

    # 创建 Agent（传入 skill）
    agent = DeepPDFAgent(
        # ... 其他参数 ...
        skill=skill
    )
```

**Step 3: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/api/models.py backend/deeppdf-api/src/deeppdf/api/routes.py
git commit -m "feat(api): add skill_name parameter to agent API"
```

---

## Phase 3: 前端集成

### Task 3.1: 前端 Skills API 客户端

**Files:**
- Modify: `frontend/src/api/http-client.ts`
- Modify: `frontend/src/api/index.ts`

**Step 1: Add Skills types and API methods**

在 `http-client.ts` 中添加：

```typescript
// ==================== Skills 相关类型 ====================

/**
 * Skill 元信息
 */
export interface SkillMeta {
  name: string;
  description: string;
  source: 'builtin' | 'user' | 'system';
  is_active: boolean;
}

/**
 * Skill 详情
 */
export interface SkillDetail {
  name: string;
  description: string;
  source: string;
  tools?: string[];
  keywords?: string[];
  book_types?: string[];
  prompt_preview: string;
}

/**
 * Skills 列表响应
 */
export interface ListSkillsResponse {
  skills: SkillMeta[];
  total: number;
}

// 在 DeepPDFClient 类中添加方法

/**
 * 列出所有可用的 Skills
 */
async listSkills(): Promise<ListSkillsResponse> {
  return this.request<ListSkillsResponse>('/api/skills');
}

/**
 * 获取 Skill 详情
 */
async getSkill(skillName: string): Promise<SkillDetail> {
  return this.request<SkillDetail>(`/api/skills/${skillName}`);
}

/**
 * 重新加载 Skills
 */
async reloadSkills(): Promise<{ status: string; message: string; total_skills: number }> {
  return this.request<{ status: string; message: string; total_skills: number }>('/api/skills/reload', {
    method: 'POST'
  });
}
```

**Step 2: Commit**

```bash
git add frontend/src/api/http-client.ts frontend/src/api/index.ts
git commit -m "feat(frontend): add skills API client methods"
```

---

### Task 3.2: Chat UI 显示当前 Skill

**Files:**
- Modify: `frontend/src/components/chat-input/chat-input.ts`
- Modify: `frontend/src/components/message-list/message-list.ts`

**Step 1: Add skill selector to chat input**

在聊天输入组件中添加 Skill 选择下拉菜单，显示当前激活的 Skill。

**Step 2: Commit**

```bash
git add frontend/src/components/chat-input/ frontend/src/components/message-list/
git commit -m "feat(frontend): add skill selector to chat UI"
```

---

## Phase 4: 文档和测试

### Task 4.1: 更新技术文档

**Files:**
- Update: `docs/Agent对话模块技术文档.md`

**Step 1: Add Skills section to documentation**

在技术文档中添加 Skills 平台的说明，包括：
- 架构设计
- 文件格式
- API 端点
- 如何创建自定义 Skill

**Step 2: Commit**

```bash
git add docs/Agent对话模块技术文档.md
git commit -m "docs: add skills platform documentation"
```

---

### Task 4.2: 集成测试

**Files:**
- Create: `backend/deeppdf-api/tests/test_skills_integration.py`

**Step 1: Write integration test**

```python
# tests/test_skills_integration.py
"""Skills 平台集成测试"""

import pytest
from pathlib import Path
from deeppdf.skills import SkillRegistry, SkillRouter
from deeppdf.skills.models import Skill


class TestSkillsIntegration:
    """端到端集成测试"""

    def test_full_workflow(self, tmp_path: Path):
        """测试完整工作流"""
        # 1. 创建测试 Skills
        builtin_path = tmp_path / "builtin"
        builtin_path.mkdir()
        skill_dir = builtin_path / "test-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text('''---
name: test-skill
description: 测试技能
keywords:
  - 测试
  - 集成
---
# 测试技能
测试内容
''')

        # 2. 初始化 Registry
        registry = SkillRegistry(
            builtin_skills_path=builtin_path,
            user_skills_path=tmp_path / "user"
        )
        registry.reload_all()

        # 3. 验证加载
        skill = registry.get_skill("test-skill")
        assert skill is not None
        assert skill.name == "test-skill"

        # 4. 测试路由
        router = SkillRouter(registry.get_all_skills())
        matched = router.match_skill(
            query="这是一个集成测试",
            book_metadata={}
        )
        assert matched.name == "test-skill"
```

**Step 2: Run test**

```bash
cd backend/deeppdf-api && uv run pytest tests/test_skills_integration.py -v
```

Expected: PASS

**Step 3: Commit**

```bash
git add backend/deeppdf-api/tests/test_skills_integration.py
git commit -m "test(skills): add integration test for full workflow"
```

---

## 执行检查清单

完成所有任务后，确认：

- [ ] 所有单元测试通过: `uv run pytest tests/ -v`
- [ ] 后端启动正常: `uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio`
- [ ] API 文档可访问: http://localhost:6088/docs
- [ ] Skills API 可用: `curl http://localhost:6088/api/skills`

---

*本实现计划基于 2026-03-07 的头脑风暴设计文档。*
