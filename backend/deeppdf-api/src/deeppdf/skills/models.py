# src/deeppdf/skills/models.py
"""
Skills 数据模型定义

使用 Pydantic 定义 Skill 的结构化数据模型。

设计哲学:
    Skill 是知识，不是配置
    - 知识告诉模型"怎么做"（通过 prompt_content）
    - 工具让模型自己选择（不限制可用工具）
    - 参数让模型自己填写（不预设默认参数）

    这样设计的好处:
    1. Skill 更轻量，专注于传递领域知识
    2. 模型有更大的自主权，可以根据实际情况灵活选择工具和参数
    3. 减少"配置地狱"，让 Skill 更易于编写和维护
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class SkillMeta(BaseModel):
    """Skill 元数据（可选）"""

    version: Optional[str] = Field(default="1.0", description="版本号")
    author: Optional[str] = Field(default=None, description="作者")
    tags: Optional[List[str]] = Field(default=None, description="标签列表")
    created_at: Optional[str] = Field(default=None, description="创建时间")
    updated_at: Optional[str] = Field(default=None, description="更新时间")


class Skill(BaseModel):
    """
    Skill 定义模型

    对应一个 Markdown + YAML frontmatter 格式的 skill 文件。

    核心设计: Skill 是知识载体，不是工具配置
    - 移除了 tools 字段: 让模型根据 prompt_content 自主选择合适的工具
    - 移除了 default_params 字段: 让模型根据上下文自主决定参数值
    """

    # 必填字段
    name: str = Field(..., description="Skill 唯一标识符，如 academic-reading")
    description: str = Field(..., description="Skill 简短描述")

    # Prompt 内容（Markdown body 部分）- Skill 的核心
    prompt_content: Optional[str] = Field(
        default=None,
        description="Skill 专属的 Prompt 内容（Markdown 格式），告诉模型'怎么做'",
    )

    # 自动路由相关
    keywords: Optional[List[str]] = Field(
        default=None,
        description="触发关键词列表，用于自动路由匹配",
    )
    book_types: Optional[List[str]] = Field(
        default=None,
        description="适用的书籍类型列表，如 ['academic_paper', 'fiction']",
    )

    # 元数据
    meta: Optional[SkillMeta] = Field(
        default=None,
        description="可选的元数据",
    )

    # 来源路径（运行时填充）
    source_path: Optional[str] = Field(
        default=None,
        description="Skill 文件的来源路径",
    )
    is_builtin: bool = Field(
        default=False,
        description="是否为内置 Skill",
    )


class SkillConfig(BaseModel):
    """
    Skill 配置模型

    用于 API 请求中的 Skill 配置。
    """

    active_skill: Optional[str] = Field(
        default=None,
        description="当前激活的 Skill ID",
    )
    override_params: Optional[Dict[str, Any]] = Field(
        default=None,
        description="覆盖的参数配置",
    )

    # 路由上下文
    query: Optional[str] = Field(
        default=None,
        description="用户查询（用于自动路由）",
    )
    book_type: Optional[str] = Field(
        default=None,
        description="书籍类型（用于自动路由）",
    )


class RoutingResult(BaseModel):
    """
    路由结果模型

    SkillRouter 和 IntentRouter 的返回结果。
    """

    skill: Skill = Field(..., description="匹配到的 Skill")
    match_type: str = Field(
        ...,
        description="匹配类型: manual, book_type, keyword, llm_intent, default",
    )
    confidence: float = Field(
        default=1.0,
        description="匹配置信度 (0-1)",
    )
    matched_keywords: Optional[List[str]] = Field(
        default=None,
        description="匹配到的关键词（仅 keyword 匹配时有值）",
    )
    extracted_params: Optional[Dict[str, Any]] = Field(
        default=None,
        description="从用户问题中提取的参数（仅 LLM 路由时有值）",
    )
    reason: Optional[str] = Field(
        default=None,
        description="选择原因（仅 LLM 路由时有值）",
    )
