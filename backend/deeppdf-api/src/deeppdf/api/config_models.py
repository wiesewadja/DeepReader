"""
API 配置请求/响应模型
"""

from pydantic import BaseModel, Field
from typing import List, Optional


# ========== 配置管理模型 ==========


class LLMConfig(BaseModel):
    """LLM 配置"""

    provider: str = Field(
        "deepseek", description="LLM provider (deepseek/openai/google/custom/anthropic)"
    )
    model: str = Field("deepseek-chat", description="LLM model name")
    api_key: Optional[str] = Field(None, description="API key")
    base_url: Optional[str] = Field(
        None, description="Custom API base URL (required for custom provider)"
    )


class IndexingConfig(BaseModel):
    """索引配置"""

    toc_check_pages: int = Field(20, description="目录检测页数")
    max_pages_per_node: int = Field(10, description="每节点最大页数")
    max_tokens_per_node: int = Field(20000, description="每节点最大 token 数")
    if_add_node_summary: bool = Field(True, description="是否添加节点摘要")
    if_add_node_text: bool = Field(False, description="是否添加节点原文")


class UserConfig(BaseModel):
    """用户配置"""

    name: str = Field(..., description="配置名称（唯一标识）")
    description: Optional[str] = Field(None, description="配置描述")
    is_default: bool = Field(False, description="是否为默认配置")
    llm: LLMConfig = Field(default_factory=LLMConfig, description="LLM 配置")
    indexing: IndexingConfig = Field(
        default_factory=IndexingConfig, description="索引配置"
    )

    class Config:
        json_schema_extra = {
            "examples": [
                {
                    "name": "default",
                    "description": "默认配置",
                    "is_default": True,
                    "llm": {
                        "provider": "deepseek",
                        "model": "deepseek-chat",
                        "api_key": "sk-xxx",
                    },
                    "indexing": {
                        "toc_check_pages": 20,
                        "max_pages_per_node": 10,
                        "max_tokens_per_node": 20000,
                        "if_add_node_summary": True,
                        "if_add_node_text": False,
                    },
                },
                {
                    "name": "minimal",
                    "description": "极简配置（所有字段使用默认值）",
                    "llm": {},
                    "indexing": {},
                },
            ]
        }


class UserConfigUpdate(BaseModel):
    """用户配置更新（部分字段）"""

    description: Optional[str] = None
    is_default: Optional[bool] = None
    llm: Optional[LLMConfig] = None
    indexing: Optional[IndexingConfig] = None


class UserConfigListResponse(BaseModel):
    """配置列表响应"""

    status: str
    configs: List[UserConfig]


class UserConfigResponse(BaseModel):
    """单个配置响应"""

    status: str
    config: Optional[UserConfig] = None
    message: Optional[str] = None
