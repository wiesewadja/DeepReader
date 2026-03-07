# src/deeppdf/skills/models.py
"""
Skills 数据模型定义

使用 Pydantic 定义 Skill 的结构化数据模型。
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
    """

    # 必填字段
    name: str = Field(..., description="Skill 唯一标识符，如 academic-reading")
    description: str = Field(..., description="Skill 简短描述")

    # 工具配置
    tools: Optional[List[str]] = Field(
        default=None,
        description="允许使用的工具列表，None 表示使用所有工具",
    )

    # 默认参数
    default_params: Optional[Dict[str, Dict[str, Any]]] = Field(
        default=None,
        description="工具默认参数配置，如 {'hybrid_search': {'top_k': 10}}",
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

    # Prompt 内容（Markdown body 部分）
    prompt_content: Optional[str] = Field(
        default=None,
        description="Skill 专属的 Prompt 内容（Markdown 格式）",
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

    SkillRouter 的返回结果。
    """

    skill: Skill = Field(..., description="匹配到的 Skill")
    match_type: str = Field(
        ...,
        description="匹配类型: manual, book_type, keyword, default",
    )
    confidence: float = Field(
        default=1.0,
        description="匹配置信度 (0-1)",
    )
    matched_keywords: Optional[List[str]] = Field(
        default=None,
        description="匹配到的关键词（仅 keyword 匹配时有值）",
    )
