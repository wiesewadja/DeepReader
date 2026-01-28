"""
API 请求/响应模型
"""

from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Literal


# ========== 请求模型 ==========


class IndexRequest(BaseModel):
    """创建索引请求"""

    # 文件路径和文件 ID 二选一
    file_id: Optional[str] = Field(
        None, description="已上传文件的 ID（通过 /api/files 上传获取）"
    )
    path: Optional[str] = Field(None, description="PDF 文件路径（绝对路径）")
    # 配置名称（可选，用于使用已保存的配置）
    config_name: Optional[str] = Field(
        None, description="使用已保存的配置名称，优先级高于单独参数"
    )
    # LLM 配置（可选，用于覆盖全局配置）
    llm_provider: Optional[str] = Field(
        None, description="LLM provider (deepseek/openai/google/custom)"
    )
    llm_model: Optional[str] = Field(None, description="LLM model name")
    deepseek_api_key: Optional[str] = Field(None, description="DeepSeek API key")
    openai_api_key: Optional[str] = Field(None, description="OpenAI API key")
    api_url: Optional[str] = Field(None, description="Custom API base URL")
    max_pages_per_node: Optional[int] = Field(
        None, description="Max pages per section node"
    )
    max_tokens_per_node: Optional[int] = Field(
        None, description="Max tokens per section node"
    )
    if_add_node_summary: Optional[bool] = Field(
        None, description="Add node summary using LLM"
    )

    @field_validator("path")
    @classmethod
    def validate_pdf_path(cls, v: Optional[str]) -> Optional[str]:
        """验证 PDF/EPUB 路径，防止路径遍历攻击"""
        if v is None:
            return v
        # 检查是否为 .pdf 或 .epub 文件
        if not (v.lower().endswith(".pdf") or v.lower().endswith(".epub")):
            raise ValueError("Path must point to a PDF or EPUB file")
        # 防止路径遍历攻击
        if ".." in v:
            raise ValueError('Path traversal detected: ".." is not allowed')
        # 检查路径长度
        if len(v) > 500:
            raise ValueError("Path too long (maximum 500 characters)")
        return v

    @field_validator("llm_provider")
    @classmethod
    def validate_llm_provider(cls, v: Optional[str]) -> Optional[str]:
        """验证 LLM provider"""
        if v is not None:
            valid_providers = ["deepseek", "openai", "google", "custom", "anthropic"]
            if v.lower() not in valid_providers:
                raise ValueError(
                    f'llm_provider must be one of: {", ".join(valid_providers)}'
                )
        return v


class QueryRequest(BaseModel):
    """查询请求"""

    query: str = Field(..., description="查询文本")
    index_id: str = Field(..., description="索引 ID")
    max_results: Optional[int] = Field(10, description="最大结果数")


# ========== 响应模型 ==========


class IndexResponse(BaseModel):
    """创建索引响应"""

    status: str
    index_id: Optional[str] = None
    doc_type: Optional[Literal["pdf", "epub"]] = None
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


class MarkdownMappingBody(BaseModel):
    """保存 Markdown 映射请求体"""

    file_mapping: dict = Field(..., description="节点 ID 到 Markdown 路径的映射")


class MarkdownMappingResponse(BaseModel):
    """保存 Markdown 映射响应"""

    status: str
    index_id: str


# ========== Agent 相关模型 ==========


class AgentRequest(BaseModel):
    """Agent 请求"""

    query: str = Field(..., min_length=1, max_length=2000, description="用户查询")
    index_id: str = Field(..., min_length=1, max_length=100, description="索引 ID")
    session_id: Optional[str] = Field(
        None, max_length=100, description="会话 ID，用于多轮对话"
    )
    keep_history: Optional[bool] = Field(
        True, description="是否保留对话历史（支持追问）"
    )
    stream: Optional[bool] = Field(False, description="是否流式输出")
    include_citations: Optional[bool] = Field(False, description="是否返回引用信息")
    enable_llm_tree_search: Optional[bool] = Field(
        False, description="是否启用 LLM 树状结构搜索工具"
    )
    force_mode: Optional[str] = Field(
        None,
        description="强制路由模式：auto(默认自动路由) | fast(只允许hybrid_search) | section(read_page+hybrid_search) | slow(全部工具)",
    )

    @field_validator("force_mode")
    @classmethod
    def validate_force_mode(cls, v: Optional[str]) -> Optional[str]:
        """验证强制模式参数"""
        if v is None or v == "auto":
            return None  # None 表示自动路由
        valid_modes = ["fast", "section", "slow"]
        if v not in valid_modes:
            mode_list = '", "'.join(valid_modes)
            raise ValueError(f'force_mode must be one of: "auto", "{mode_list}"')
        return v


class CitationInfo(BaseModel):
    """单个引用信息"""

    node_id: str = Field(..., description="节点 ID")
    obsidian_link: str = Field(..., description="Obsidian 链接格式 [[file.md#^page-N]]")
    page: Optional[int] = Field(None, description="页码")
    anchor: str = Field("", description="锚点（如 ^page-N）")


class AgentResponse(BaseModel):
    """Agent 响应（旧版本，不包含引用）"""

    status: str
    answer: Optional[str] = None
    error: Optional[str] = None
    iterations: Optional[int] = None


class AgentResponseWithCitations(BaseModel):
    """Agent 响应（带引用）"""

    status: str
    answer: Optional[str] = None
    error: Optional[str] = None
    iterations: Optional[int] = None
    citations: Optional[List[CitationInfo]] = Field(None, description="引用列表")


# ========== 会话管理相关模型 ==========


class SessionInfo(BaseModel):
    """会话信息"""

    sessionId: str = Field(..., description="会话 ID")
    indexId: str = Field(..., description="索引 ID")
    pdfName: str = Field(..., description="PDF 文件名")
    messageCount: int = Field(..., description="消息数量", ge=0)
    createdTime: str = Field(..., description="创建时间（ISO 8601 格式）")
    lastMessageTime: str = Field(..., description="最后消息时间（ISO 8601 格式）")


class SessionsListResponse(BaseModel):
    """会话列表响应"""

    status: str
    sessions: List[SessionInfo]


class DeleteSessionResponse(BaseModel):
    """删除会话响应"""

    status: str
    message: str
