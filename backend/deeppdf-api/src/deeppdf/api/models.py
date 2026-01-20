"""
API 请求/响应模型
"""
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional


# ========== 请求模型 ==========

class IndexRequest(BaseModel):
    """创建索引请求"""
    # 文件路径和文件 ID 二选一
    file_id: Optional[str] = Field(None, description="已上传文件的 ID（通过 /api/files 上传获取）")
    path: Optional[str] = Field(None, description="PDF 文件路径（绝对路径）")
    # 配置名称（可选，用于使用已保存的配置）
    config_name: Optional[str] = Field(None, description="使用已保存的配置名称，优先级高于单独参数")
    # LLM 配置（可选，用于覆盖全局配置）
    llm_provider: Optional[str] = Field(None, description="LLM provider (deepseek/openai/google/custom)")
    llm_model: Optional[str] = Field(None, description="LLM model name")
    deepseek_api_key: Optional[str] = Field(None, description="DeepSeek API key")
    openai_api_key: Optional[str] = Field(None, description="OpenAI API key")
    api_url: Optional[str] = Field(None, description="Custom API base URL")
    max_pages_per_node: Optional[int] = Field(None, description="Max pages per section node")
    max_tokens_per_node: Optional[int] = Field(None, description="Max tokens per section node")
    if_add_node_summary: Optional[bool] = Field(None, description="Add node summary using LLM")

    @field_validator('path')
    @classmethod
    def validate_pdf_path(cls, v: Optional[str]) -> Optional[str]:
        """验证 PDF 路径，防止路径遍历攻击"""
        if v is None:
            return v
        # 检查是否为 .pdf 文件
        if not v.lower().endswith('.pdf'):
            raise ValueError('Path must point to a PDF file')
        # 防止路径遍历攻击
        if '..' in v:
            raise ValueError('Path traversal detected: ".." is not allowed')
        # 检查路径长度
        if len(v) > 500:
            raise ValueError('Path too long (maximum 500 characters)')
        return v

    @field_validator('llm_provider')
    @classmethod
    def validate_llm_provider(cls, v: Optional[str]) -> Optional[str]:
        """验证 LLM provider"""
        if v is not None:
            valid_providers = ['deepseek', 'openai', 'google', 'custom', 'anthropic']
            if v.lower() not in valid_providers:
                raise ValueError(f'llm_provider must be one of: {", ".join(valid_providers)}')
        return v


class QueryRequest(BaseModel):
    """查询请求"""
    query: str = Field(..., description="查询文本")
    index_id: str = Field(..., description="索引 ID")
    max_results: Optional[int] = Field(5, description="最大结果数")


# ========== 响应模型 ==========

class IndexResponse(BaseModel):
    """创建索引响应"""
    status: str
    index_id: Optional[str] = None
    node_count: Optional[int] = None
    pdf_name: Optional[str] = None
    indexing_method: Optional[str] = None
    error: Optional[str] = None


class QueryResultItem(BaseModel):
    """查询结果项"""
    text: str
    metadata: dict


class QueryResponse(BaseModel):
    """查询响应"""
    status: str
    results: Optional[List[QueryResultItem]] = None
    error: Optional[str] = None
    index_info: Optional[dict] = None
    search_method: Optional[str] = None


class IndexListItem(BaseModel):
    """索引列表项"""
    id: str
    pdf_name: str
    node_count: int
    created_at: str
    status: Optional[str] = None
    message: Optional[str] = None
    progress_percent: Optional[int] = None  # 索引进度 0-100


class ListIndexesResponse(BaseModel):
    """索引列表响应"""
    status: str
    indexes: List[IndexListItem]


class DeleteIndexResponse(BaseModel):
    """删除索引响应"""
    status: str
    message: Optional[str] = None


class HealthResponse(BaseModel):
    """健康检查响应"""
    status: str
    version: str


# ========== 进度相关模型 ==========

class TaskProgressResponse(BaseModel):
    """任务进度响应"""
    id: str
    status: str  # pending, processing, completed, failed, cancelled
    message: str
    pdf_path: Optional[str] = None
    created_at: Optional[str] = None

    # 进度信息
    current_step: Optional[str] = None
    progress_percent: Optional[int] = None  # 0-100
    total_steps: Optional[int] = None
    completed_steps: Optional[int] = None

    # 完成后的信息
    index_id: Optional[str] = None
    node_count: Optional[int] = None
    pdf_name: Optional[str] = None

    # 错误信息
    error: Optional[str] = None
