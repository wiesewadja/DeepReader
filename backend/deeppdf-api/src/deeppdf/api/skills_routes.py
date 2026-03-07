# src/deeppdf/api/skills_routes.py
"""
Skills API 路由

提供 Skills 的查询和选择接口。
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..skills import Skill, SkillRegistry, SkillLoader, SkillRouter, RoutingResult, get_skill_registry
from ..skills.models import SkillMeta

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/skills", tags=["skills"])


# ========== 请求/响应模型 ==========


class SkillInfo(BaseModel):
    """Skill 信息（用于 API 响应）"""

    name: str = Field(..., description="Skill 唯一标识符")
    description: str = Field(..., description="Skill 描述")
    tools: Optional[List[str]] = Field(None, description="允许使用的工具列表")
    keywords: Optional[List[str]] = Field(None, description="触发关键词")
    book_types: Optional[List[str]] = Field(None, description="适用的书籍类型")
    is_builtin: bool = Field(False, description="是否为内置 Skill")
    has_prompt: bool = Field(False, description="是否有自定义 Prompt")

    @classmethod
    def from_skill(cls, skill: Skill) -> "SkillInfo":
        """从 Skill 对象创建 SkillInfo"""
        return cls(
            name=skill.name,
            description=skill.description,
            tools=skill.tools,
            keywords=skill.keywords,
            book_types=skill.book_types,
            is_builtin=skill.is_builtin,
            has_prompt=bool(skill.prompt_content),
        )


class SkillListResponse(BaseModel):
    """Skills 列表响应"""

    skills: List[SkillInfo] = Field(..., description="Skill 列表")
    total: int = Field(..., description="总数")
    default_skill: Optional[str] = Field(None, description="默认 Skill 名称")


class SkillRouteRequest(BaseModel):
    """Skill 路由请求"""

    query: Optional[str] = Field(None, description="用户查询")
    book_type: Optional[str] = Field(None, description="书籍类型")
    skill_name: Optional[str] = Field(None, description="手动指定的 Skill 名称")


class SkillRouteResponse(BaseModel):
    """Skill 路由响应"""

    skill: SkillInfo = Field(..., description="匹配到的 Skill")
    match_type: str = Field(
        ..., description="匹配类型: manual, book_type, keyword, default"
    )
    confidence: float = Field(..., description="匹配置信度 (0-1)")
    matched_keywords: Optional[List[str]] = Field(None, description="匹配到的关键词")


class SkillDetailResponse(BaseModel):
    """Skill 详情响应"""

    name: str
    description: str
    tools: Optional[List[str]] = None
    default_params: Optional[dict] = None
    keywords: Optional[List[str]] = None
    book_types: Optional[List[str]] = None
    prompt_content: Optional[str] = None
    meta: Optional[SkillMeta] = None
    is_builtin: bool = False
    source_path: Optional[str] = None


# ========== API 端点 ==========


@router.get("", response_model=SkillListResponse)
async def list_skills():
    """
    列出所有可用的 Skills

    Returns:
        Skills 列表，包括内置和用户 Skills
    """
    registry = get_skill_registry()
    skills = [SkillInfo.from_skill(s) for s in registry.list_all()]

    return SkillListResponse(
        skills=skills,
        total=len(skills),
        default_skill=registry.get_default().name if registry.get_default() else None,
    )


@router.get("/builtin", response_model=SkillListResponse)
async def list_builtin_skills():
    """
    列出所有内置 Skills

    Returns:
        内置 Skills 列表
    """
    registry = get_skill_registry()
    skills = [SkillInfo.from_skill(s) for s in registry.list_builtin()]

    return SkillListResponse(
        skills=skills,
        total=len(skills),
        default_skill=None,
    )


@router.get("/user", response_model=SkillListResponse)
async def list_user_skills():
    """
    列出所有用户自定义 Skills

    Returns:
        用户 Skills 列表
    """
    registry = get_skill_registry()
    skills = [SkillInfo.from_skill(s) for s in registry.list_user()]

    return SkillListResponse(
        skills=skills,
        total=len(skills),
        default_skill=None,
    )


@router.get("/{skill_name}", response_model=SkillDetailResponse)
async def get_skill_detail(skill_name: str):
    """
    获取 Skill 详情

    Args:
        skill_name: Skill 名称

    Returns:
        Skill 详细信息

    Raises:
        404: Skill 不存在
    """
    registry = get_skill_registry()
    skill = registry.get(skill_name)

    if skill is None:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")

    return SkillDetailResponse(
        name=skill.name,
        description=skill.description,
        tools=skill.tools,
        default_params=skill.default_params,
        keywords=skill.keywords,
        book_types=skill.book_types,
        prompt_content=skill.prompt_content,
        meta=skill.meta,
        is_builtin=skill.is_builtin,
        source_path=skill.source_path,
    )


@router.post("/route", response_model=SkillRouteResponse)
async def route_skill(request: SkillRouteRequest):
    """
    根据查询内容自动路由到合适的 Skill

    优先级：手动指定 > book_type 匹配 > keyword 评分 > 默认

    Args:
        request: 路由请求参数

    Returns:
        路由结果

    Raises:
        400: 无匹配且无默认 Skill
    """
    registry = get_skill_registry()
    skill_router = SkillRouter(registry)

    try:
        result = skill_router.route(
            skill_name=request.skill_name,
            query=request.query,
            book_type=request.book_type,
        )

        return SkillRouteResponse(
            skill=SkillInfo.from_skill(result.skill),
            match_type=result.match_type,
            confidence=result.confidence,
            matched_keywords=result.matched_keywords,
        )

    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/reload")
async def reload_skills():
    """
    重新加载所有 Skills

    清空当前注册表并重新加载内置和用户 Skills。
    用户添加新的 Skill 文件后，调用此接口即可生效，无需重启服务。

    Returns:
        重载结果
    """
    from .. import skills as skills_module

    # 重置全局注册表
    skills_module._skill_registry = None

    # 重新加载
    registry = get_skill_registry()

    return {
        "success": True,
        "message": f"Reloaded {len(registry.list_all())} skills",
        "skills": [s.name for s in registry.list_all()],
    }
