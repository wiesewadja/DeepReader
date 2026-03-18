"""
API 请求/响应模型
"""

from enum import Enum
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Literal


# ========== 枚举类型 ==========


class TaskStatus(str, Enum):
    """任务状态"""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ConfidenceLevel(str, Enum):
    """置信度级别"""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


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
    # 文本格式化配置
    enable_text_formatting: bool = Field(
        True, description="启用文本格式化（合并软换行、规范化段落等）"
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
            # 前端支持的 provider：deepseek, kimi, zhipu, openai, custom
            # 后端兼容所有前端支持的 provider
            valid_providers = [
                "deepseek", "openai", "google", "custom", "anthropic",
                "kimi", "zhipu"  # 前端支持的国内 LLM 服务商
            ]
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
    use_llm_tree_search: bool = Field(
        False, description="是否使用 LLM 树搜索（深度思考模式）"
    )
    scope_node_ids: Optional[List[str]] = Field(
        None, description="范围锁定的节点 ID 列表（只在这些节点范围内搜索）"
    )


# ========== 响应模型 ==========


class IndexResponse(BaseModel):
    """创建索引响应"""

    status: str
    task_id: Optional[str] = None
    message: Optional[str] = None
    file_id: Optional[str] = None
    pdf_path: Optional[str] = None
    index_id: Optional[str] = None
    doc_type: Optional[Literal["pdf", "epub"]] = None
    node_count: Optional[int] = None
    pdf_name: Optional[str] = None
    indexing_method: Optional[str] = None
    reused: Optional[bool] = None  # 是否复用了已有数据
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
    thinking: Optional[str] = None  # 新增: LLM 推理过程
    fallback: Optional[bool] = None  # 新增: 是否发生降级
    fallback_reason: Optional[str] = None  # 新增: 降级原因


class IndexListItem(BaseModel):
    """索引列表项"""

    id: str
    pdf_name: str
    author: Optional[str] = None  # 作者（EPUB 特有）
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
    status: TaskStatus  # 使用枚举类型
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


# ========== 书籍摘要模型 ==========


class ChapterSummary(BaseModel):
    """章节摘要"""

    node_id: str = Field(..., description="节点 ID")
    title: str = Field(..., description="章节标题")
    summary: str = Field("", description="一句话摘要")
    key_questions: List[str] = Field(
        default_factory=list, description="该章节要解决的问题"
    )


class BookSummary(BaseModel):
    """书籍摘要"""

    index_id: str = Field(..., description="索引 ID")
    core_thesis: str = Field("", description="核心主旨（1-2句话）")
    author_intents: List[str] = Field(
        default_factory=list, description="作者意图（3-5个问题）"
    )
    book_type: Literal["theoretical", "practical", "fiction", "mixed"] = Field(
        "mixed", description="书籍分类"
    )
    chapter_summaries: List[ChapterSummary] = Field(
        default_factory=list, description="章节摘要列表"
    )
    generated_at: Optional[str] = Field(None, description="生成时间")
    model_used: Optional[str] = Field(None, description="使用的模型")


class GenerateSummaryRequest(BaseModel):
    """生成摘要请求"""

    index_id: str = Field(..., description="索引 ID")
    force_regenerate: bool = Field(False, description="是否强制重新生成")


class GenerateSummaryResponse(BaseModel):
    """生成摘要响应"""

    status: str = Field(..., description="状态: success 或 error")
    summary: Optional[BookSummary] = Field(None, description="书籍摘要")
    error: Optional[str] = Field(None, description="错误信息")
