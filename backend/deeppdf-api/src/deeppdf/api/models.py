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


class ReportType(str, Enum):
    """报告类型"""

    EXPLORATORY = "exploratory"
    COMPARATIVE = "comparative"
    PRACTICAL = "practical"


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
    use_llm_tree_search: bool = Field(
        False, description="是否使用 LLM 树搜索（深度思考模式）"
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


# ========== 跨书籍搜索模型 ==========


class CrossBookSearchRequest(BaseModel):
    """跨书籍搜索请求"""

    query: str = Field(..., description="搜索关键词", min_length=1)
    index_ids: Optional[List[str]] = Field(
        None, description="指定索引 ID 列表，不传则搜索全部"
    )
    top_k: int = Field(5, description="每本书返回的结果数量", ge=1, le=20)


class CrossBookSearchResult(BaseModel):
    """跨书籍搜索结果项"""

    text: str = Field(..., description="匹配的文本内容")
    book_name: str = Field(..., description="来源书籍名称")
    index_id: str = Field(..., description="索引 ID")
    section: str = Field(..., description="章节名称")
    page: int = Field(..., description="页码")
    obsidian_link: str = Field(..., description="Obsidian wiki 链接")


class CrossBookSearchResponse(BaseModel):
    """跨书籍搜索响应"""

    status: str = Field(..., description="状态: success 或 error")
    results: List[CrossBookSearchResult] = Field(
        default_factory=list, description="搜索结果列表"
    )
    books_searched: int = Field(0, description="搜索的书籍数量")
    total_results: int = Field(0, description="总结果数量")
    error: Optional[str] = Field(None, description="错误信息")


# ========== 主题报告模型 ==========


class BookPerspective(BaseModel):
    """单本书的观点"""

    book_name: str = Field(..., description="书籍名称")
    book_link: str = Field(..., description="Obsidian wiki link")
    key_points: List[str] = Field(default_factory=list, description="核心观点列表")
    related_chapter: str = Field("", description="最相关的章节")
    related_chapter_link: str = Field("", description="章节的 wiki link")


class DifferencePosition(BaseModel):
    """单个立场"""

    book_name: str = Field(..., description="书籍名称")
    book_link: str = Field(..., description="Obsidian wiki link")
    position: str = Field(..., description="该书的立场")


class DifferencePoint(BaseModel):
    """分歧点"""

    topic: str = Field(..., description="分歧主题")
    positions: List[DifferencePosition] = Field(
        default_factory=list, description="各书立场"
    )


class ThemeReportRequest(BaseModel):
    """主题报告请求"""

    theme: str = Field(..., description="主题/问题", min_length=1, max_length=500)
    index_ids: Optional[List[str]] = Field(
        None, description="指定索引 ID 列表，不传则搜索全部"
    )
    top_k_per_book: int = Field(3, description="每本书取多少条结果", ge=1, le=10)


class EnhancedThemeReportRequest(BaseModel):
    """增强版主题报告请求"""

    theme: str = Field(..., description="主题/问题", min_length=1, max_length=500)
    index_ids: Optional[List[str]] = Field(
        None, description="指定索引 ID 列表，不传则搜索全部"
    )
    top_k_per_book: int = Field(3, description="每本书取多少条结果", ge=1, le=10)

    # 增强选项
    enable_query_expansion: bool = Field(True, description="启用查询扩展")
    enable_comparison: bool = Field(True, description="生成对比矩阵")
    enable_role_play: bool = Field(False, description="启用角色扮演分析（P1）")
    enable_reflection: bool = Field(False, description="启用自我反思（P1）")
    max_sub_queries: int = Field(5, description="最大子问题数", ge=1, le=10)
    report_type: Optional[ReportType] = Field(
        None, description="报告类型：exploratory/comparative/practical，不传则自动分类"
    )


class ThemeReportResponse(BaseModel):
    """主题报告响应"""

    status: str = Field(..., description="状态: success 或 error")
    theme: str = Field(..., description="主题")
    unified_summary: str = Field(..., description="整合摘要")
    book_perspectives: List[BookPerspective] = Field(
        default_factory=list, description="各书观点"
    )
    books_searched: int = Field(0, description="搜索的书籍数量")
    markdown_content: Optional[str] = Field(
        None, description="生成的完整 Markdown 内容"
    )
    suggested_filename: Optional[str] = Field(None, description="建议的文件名")
    error: Optional[str] = Field(None, description="错误信息")


class EnhancedThemeReportResponse(BaseModel):
    """增强版主题报告响应"""

    status: str = Field(..., description="状态: success 或 error")
    theme: str = Field(..., description="主题")

    # 核心内容
    unified_summary: str = Field(..., description="整合摘要")
    book_perspectives: List[BookPerspective] = Field(
        default_factory=list, description="各书观点"
    )
    comparison_matrix: Optional[str] = Field(None, description="对比矩阵 Markdown 表格")

    # 元信息
    expanded_queries: List[str] = Field(
        default_factory=list, description="扩展的子问题"
    )
    report_type: ReportType = Field(..., description="实际使用的报告类型")
    books_searched: int = Field(0, description="搜索的书籍数量")
    total_sources: int = Field(0, description="总引用数")

    # 质量指标（P1 功能启用时才有值）
    coverage_score: Optional[float] = Field(None, description="覆盖评分 (1-10)")
    accuracy_score: Optional[float] = Field(None, description="准确性评分 (1-10)")

    # 输出
    markdown_content: Optional[str] = Field(
        None, description="生成的完整 Markdown 内容"
    )
    suggested_filename: Optional[str] = Field(None, description="建议的文件名")

    # 错误处理
    error: Optional[str] = Field(None, description="错误信息")


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
