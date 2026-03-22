# DeepReader Backend Services 参考文档

## 文件路径索引

| 文件 | 路径 | 主要职责 |
|------|------|----------|
| `__init__.py` | `deeppdf/services/__init__.py` | 模块入口，导出公共 API |
| `indexer.py` | `deeppdf/services/indexer.py` | PDF/EPUB 索引服务 |
| `querier.py` | `deeppdf/services/querier.py` | 查询服务 |
| `manager.py` | `deeppdf/services/manager.py` | 索引管理服务 |
| `smart_search.py` | `deeppdf/services/smart_search.py` | 智能混合检索 |
| `bm25_indexer.py` | `deeppdf/services/bm25_indexer.py` | BM25 全文索引 |
| `reranker.py` | `deeppdf/services/reranker.py` | BGE Reranker 重排序 |
| `llm_tree_search.py` | `deeppdf/services/llm_tree_search.py` | LLM 树搜索 |
| `cross_book_search.py` | `deeppdf/services/cross_book_search.py` | 跨书籍搜索 |
| `file_storage.py` | `deeppdf/services/file_storage.py` | 文件存储管理 |
| `chat_storage.py` | `deeppdf/services/chat_storage.py` | 会话存储 |
| `config_storage.py` | `deeppdf/services/config_storage.py` | 配置存储 |
| `text_formatter.py` | `deeppdf/services/text_formatter.py` | 文本格式化 |
| `cover_extractor.py` | `deeppdf/services/cover_extractor.py` | 封面提取 |
| `book_summary.py` | `deeppdf/services/book_summary.py` | 书籍摘要生成 |
| `markdown_exporter.py` | `deeppdf/services/markdown_exporter.py` | Markdown 导出 |
| `theme_report.py` | `deeppdf/services/theme_report.py` | 主题报告（兼容层） |
| `theme_report/__init__.py` | `deeppdf/services/theme_report/__init__.py` | 子模块入口 |
| `theme_report/pipeline.py` | `deeppdf/services/theme_report/pipeline.py` | 报告流水线 |
| `theme_report/query_expander.py` | `deeppdf/services/theme_report/query_expander.py` | 查询扩展 |
| `theme_report/deep_searcher.py` | `deeppdf/services/theme_report/deep_searcher.py` | 深度搜索 |
| `theme_report/perspective_analyzer.py` | `deeppdf/services/theme_report/perspective_analyzer.py` | 观点分析 |
| `theme_report/report_generator.py` | `deeppdf/services/theme_report/report_generator.py` | 报告生成 |
| `theme_report/citation_validator.py` | `deeppdf/services/theme_report/citation_validator.py` | 引用验证 |
| `theme_report/prompts.py` | `deeppdf/services/theme_report/prompts.py` | Prompt 模板 |

---

## 核心函数签名

### indexer.py

```python
# 主入口函数
async def index_pdf(
    pdf_path: str,
    storage_dir: str,
    progress_callback: Optional[Callable[[str, int, str], None]] = None,
    **kwargs
) -> Dict[str, Any]:
    """
    异步索引 PDF/EPUB 文件

    Args:
        pdf_path: 文件路径
        storage_dir: 存储目录
        progress_callback: 进度回调 (step, percent, message)
        **kwargs:
            - model: LLM 模型名
            - llm_provider: Provider 类型
            - api_key: API 密钥
            - base_url: 自定义 API URL
            - toc_check_pages: 目录检测页数
            - max_pages_per_node: 每节点最大页数
            - max_tokens_per_node: 每节点最大 token
            - if_add_node_summary: 是否生成摘要
            - if_add_node_text: 是否保留原文
            - if_add_node_id: 是否添加节点 ID
            - original_filename: 原始文件名

    Returns:
        {
            "status": "success" | "error",
            "index_id": "idx_xxx",
            "pdf_name": "书名",
            "node_count": 42,
            "paragraph_count": 500,
            "parse_time": 120.5,
            "vector_time": 30.2,
            "total_time": 150.7,
            "tree_structure": {...},
            "error": "错误信息（如果失败）"
        }
    """

# 内部函数
def _extract_nodes_from_tree(
    tree: Dict[str, Any],
    parent_section: str = "",
    level: int = 0,
    doc_type: str = "pdf",
    formatter: Optional[TextFormatter] = None,
) -> List[Dict]:
    """从 PageIndex 树提取章节节点"""

def _split_text_to_chunks(text: str) -> List[Dict[str, Any]]:
    """将长文本切分成 300-400 字的 chunk"""

def _extract_paragraphs_from_tree(
    tree: Dict[str, Any],
    doc_type: str,
    pdf_name: str,
    chapter_index: int,
    parent_section: str = "",
) -> List[Dict[str, Any]]:
    """从树节点提取物理段落"""
```

### querier.py

```python
async def query_pdf(
    query: str,
    index_id: str,
    storage_dir: str,
    max_results: int = 10,
    use_llm_tree_search: bool = False,
    scope_node_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    异步查询 PDF

    Args:
        query: 查询文本
        index_id: 索引 ID
        storage_dir: 存储目录
        max_results: 最大结果数
        use_llm_tree_search: 是否使用 LLM 树搜索
        scope_node_ids: 范围锁定的节点 ID 列表

    Returns:
        {
            "status": "success" | "error",
            "results": [
                {
                    "text": "段落文本",
                    "metadata": {
                        "type": "paragraph" | "section",
                        "node_id": "0001",
                        "block_id": "^ch0-p0",
                        "section": "第一章 > 1.1",
                        "page": 15,
                        "markdown_path": "DeepPDF/书名/01-章节.md",
                        "match_type": "hybrid" | "vector" | "bm25",
                        "rrf_score": 0.0123,
                    }
                }
            ],
            "index_info": {...},
            "search_method": "weighted_hybrid" | "llm_tree_search",
            "query_type": "how_to" | "definition" | "fact" | "general",
            "weights": {"vector": 0.5, "bm25": 0.5}
        }
    """

def get_index_metadata(storage_dir: Path, index_id: str) -> Dict[str, Any]:
    """获取索引元数据（带 TTL 缓存）"""

def invalidate_index_metadata(storage_dir: Path, index_id: str) -> bool:
    """使索引元数据缓存失效"""
```

### manager.py

```python
async def list_indexes(storage_dir: str) -> Dict[str, Any]:
    """列出所有索引"""

async def delete_index(index_id: str, storage_dir: str) -> Dict[str, Any]:
    """删除索引"""

async def update_index_metadata(
    index_id: str,
    storage_dir: str,
    updates: Dict[str, Any]
) -> Dict[str, Any]:
    """更新索引元数据"""

async def load_index_metadata(index_id: str, storage_dir: str) -> Dict[str, Any]:
    """加载索引元数据"""

async def update_reading_progress(
    index_id: str,
    storage_dir: str,
    pages: List[int],
) -> Dict[str, Any]:
    """更新阅读进度"""
```

### smart_search.py

```python
def hybrid_search(
    query: str,
    index_metadata: Dict[str, Any],
    vector_results: List[Dict[str, Any]],
    bm25_results: Optional[List[Dict[str, Any]]] = None,
    max_results: int = 10,
    scope_node_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    混合检索：合并向量检索和 BM25 检索结果

    Returns:
        {
            "method": "weighted_hybrid" | "vector_only" | "bm25_only",
            "results": [...],
            "query_type": "how_to" | "definition" | "fact" | "general",
            "weights": {"vector": float, "bm25": float}
        }
    """

def detect_query_type(query: str) -> str:
    """检测查询类型"""

def get_query_weights(query: str) -> Tuple[float, float]:
    """获取查询权重 (vector_weight, bm25_weight)"""
```

### bm25_indexer.py

```python
class BM25Index:
    """BM25 索引对象"""

    def build(self, documents: List[Dict[str, Any]]) -> None:
        """构建索引"""

    def search(self, query: str, top_k: int = 20) -> List[Dict[str, Any]]:
        """BM25 检索"""

    def to_dict(self) -> Dict[str, Any]:
        """序列化"""

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "BM25Index":
        """反序列化"""

def build_bm25_index_from_paragraphs(
    paragraphs: List[Dict[str, Any]],
    storage_dir: str,
    index_id: str,
) -> Optional[BM25Index]:
    """从段落列表构建 BM25 索引"""

def bm25_search(
    query: str,
    storage_dir: str,
    index_id: str,
    top_k: int = 20,
) -> List[Dict[str, Any]]:
    """BM25 独立检索"""
```

### llm_tree_search.py

```python
@dataclass
class LLMTreeSearchResult:
    """LLM 树搜索结果"""
    node_ids: List[str] = field(default_factory=list)
    thinking: str = ""
    success: bool = True
    error: Optional[str] = None

class LLMTreeSearchError(Exception):
    """LLM 树搜索错误"""
    def __init__(self, message: str, error_type: str = "unknown"):
        # error_type: timeout, parse_error, invalid_node, no_api_key

async def llm_tree_search(
    query: str,
    tree_structure: Dict[str, Any],
    llm_client,
    model: str,
    doc_name: str = "",
    max_results: int = 5,
    timeout: int = 30,
    max_retries: int = 3,
) -> LLMTreeSearchResult:
    """使用 LLM 在文档树结构上进行推理检索"""

def extract_nodes_by_ids(
    tree_structure: Dict[str, Any],
    node_ids: List[str],
    max_text_length: int = 12000,
) -> List[Dict[str, Any]]:
    """根据 node_id 列表从 tree_structure 中提取节点内容"""
```

### cross_book_search.py

```python
def cross_book_search(
    query: str,
    storage_dir: str,
    index_ids: Optional[List[str]] = None,
    top_k: int = 5
) -> Dict[str, Any]:
    """
    在多本书籍中搜索相关内容

    Returns:
        {
            "status": "success" | "error",
            "results": [
                {
                    "text": "...",
                    "book_name": "书名",
                    "index_id": "idx_xxx",
                    "section": "章节名",
                    "page": 15,
                    "obsidian_link": "DeepPDF/书名/01-章节.md#^page-15"
                }
            ],
            "books_searched": 3,
            "total_results": 15
        }
    """

def get_all_indexes(storage_dir: str) -> List[Dict[str, Any]]:
    """获取所有已索引的书籍列表"""
```

### theme_report/pipeline.py

```python
@dataclass
class PipelineConfig:
    """流水线配置"""
    llm_client: OpenAI
    llm_model: str = "deepseek-chat"
    storage_dir: str = ""
    max_sub_queries: int = 5
    top_k_per_query: int = 5
    top_k_per_book: int = 3
    enable_query_expansion: bool = True
    enable_comparison_matrix: bool = True
    enable_role_play: bool = False
    enable_reflection: bool = False
    report_type: Optional[ReportType] = None

@dataclass
class ReportOptions:
    """报告生成选项"""
    enable_query_expansion: bool = True
    enable_role_play: bool = False
    enable_reflection: bool = False
    include_comparison: bool = True
    max_sub_queries: int = 5
    report_type: Optional[str] = None

@dataclass
class ThemeReportResponse:
    """主题报告响应"""
    status: str
    theme: str
    unified_summary: str
    book_perspectives: List[Dict[str, Any]]
    comparison_matrix: Optional[str] = None
    expanded_queries: List[str] = field(default_factory=list)
    report_type: str = ""
    books_searched: int = 0
    total_sources: int = 0
    coverage_score: Optional[float] = None
    accuracy_score: Optional[float] = None
    markdown_content: str = ""
    suggested_filename: str = ""
    error: Optional[str] = None

class ThemeReportPipeline:
    """主题报告流水线"""

    def __init__(self, config: PipelineConfig):
        """初始化流水线"""

    async def run(
        self,
        theme: str,
        index_ids: Optional[List[str]] = None,
        options: Optional[ReportOptions] = None,
    ) -> ThemeReportResponse:
        """执行流水线"""
```

### theme_report/report_generator.py

```python
class ReportType(str, Enum):
    """报告类型"""
    EXPLORATORY = "exploratory"  # 探索性
    COMPARATIVE = "comparative"  # 对比性
    PRACTICAL = "practical"      # 实践性

@dataclass
class BookPerspective:
    """书籍观点"""
    book_name: str
    core_claim: str = ""
    key_arguments: List[str] = field(default_factory=list)
    unique_angle: str = ""
    quotes: List[Dict[str, Any]] = field(default_factory=list)
    confidence: str = "medium"
    source_excerpts: List[SearchResult] = field(default_factory=list)

@dataclass
class ComparisonMatrix:
    """对比矩阵"""
    markdown_table: str
    consensus_points: List[str]
    divergence_points: List[str]
    dimensions: List[str]

class ReportGenerator:
    """报告生成器"""

    def classify_theme(self, theme: str) -> ReportType:
        """分类主题类型"""

    def generate_comparison_matrix(
        self,
        theme: str,
        perspectives: List[BookPerspective],
    ) -> Optional[ComparisonMatrix]:
        """生成对比矩阵"""

    def generate_report(
        self,
        theme: str,
        perspectives: List[BookPerspective],
        report_type: Optional[ReportType] = None,
        comparison_matrix: Optional[ComparisonMatrix] = None,
        role_analyses: Optional[Dict[str, str]] = None,
    ) -> GeneratedReport:
        """生成完整报告"""
```

---

## 数据结构详解

### 段落元数据（ChromaDB）

```python
{
    # 类型标识
    "type": "paragraph",  # 固定值

    # 定位信息
    "block_id": "^ch0-p0",           # Obsidian 引用标识
    "chunk_index": 0,                 # 在段落中的切分索引
    "total_chunks": 1,                # 该段落的总切分数
    "parent_node_id": "0001",         # 父章节节点 ID
    "parent_section": "第一章 > 1.1 概述",  # 完整路径
    "paragraph_index": 0,             # 在章节中的段落序号

    # 页码信息
    "page": 15,
    "start_index": 15,                # 起始页
    "end_index": 15,                  # 结束页

    # 文本位置
    "char_start": 0,                  # 在原段落中的字符起始位置
    "char_end": 450,                  # 在原段落中的字符结束位置

    # 完整段落
    "full_paragraph": "完整的原始段落文本...",

    # 文档信息
    "pdf_name": "书名",
}
```

### 索引元数据完整结构

```python
{
    # 基本信息
    "id": "idx_abc123",
    "doc_type": "pdf" | "epub",
    "pdf_name": "书名（简化后）",
    "file_name": "原始文件名.pdf",
    "pdf_path": "/absolute/path/to/file.pdf",
    "cover_path": "/path/to/covers/idx_abc123.png",
    "created_at": "2024-01-15 10:30:00",

    # 统计信息
    "node_count": 42,
    "total_pages": 300,
    "visual_heavy": False,

    # 索引配置
    "indexing_method": "pageindex_tree",
    "llm_enabled": True,

    # 阅读进度
    "read_pages": [1, 2, 3, 10, 11],
    "chat_rounds": 5,
    "last_read_at": "2024-01-16 14:20:00",

    # 树结构（PageIndex 生成）
    "tree_structure": {
        "structure": [
            {
                "node_id": "0001",
                "title": "第一章",
                "text": "原始文本...",
                "summary": "LLM 生成的摘要",
                "start_index": 1,
                "end_index": 25,
                "nodes": [...]  # 子节点
            }
        ],
        "doc_name": "书名",
        "author": "作者"  # EPUB 特有
    },

    # 章节列表（扁平化）
    "sections": [
        {
            "id": "0001",
            "text": "【第一章】\n摘要或原文...",
            "metadata": {
                "section": "第一章",
                "level": 0,
                "page": 1,
                "node_name": "第一章",
                "node_id": "0001"
            }
        }
    ],

    # Markdown 导出映射
    "markdown_files": {
        "0001": "DeepPDF/书名/01-第一章.md"
    },
    "block_mapping": {
        "0001": {
            "^ch0-p0": "DeepPDF/书名/01-第一章.md",
            "^ch0-p1": "DeepPDF/书名/01-第一章.md"
        }
    },

    # 视觉检测（仅 PDF）
    "visual_detection": {
        "text_density": 1500,
        "image_density": 0.05,
        "reason": "Normal text density"
    }
}
```

---

## 配置常量

### smart_search.py

```python
RECALL_TOP_K = 20              # 每路召回数量
RRF_K = 40                     # RRF 平滑常数

SCORE_FUSION_WEIGHTS = {
    "how_to": {"rrf": 0.6, "vector_score": 0.4},
    "definition": {"rrf": 0.8, "vector_score": 0.2},
    "fact": {"rrf": 0.9, "vector_score": 0.1},
    "general": {"rrf": 0.7, "vector_score": 0.3},
}

QUERY_TYPE_WEIGHTS = {
    "how_to": {"vector": 0.8, "bm25": 0.2},
    "definition": {"vector": 0.4, "bm25": 0.6},
    "fact": {"vector": 0.3, "bm25": 0.7},
    "general": {"vector": 0.5, "bm25": 0.5},
}
```

### indexer.py

```python
PARAGRAPH_CHUNK_MIN = 300
PARAGRAPH_CHUNK_TARGET = 400
PARAGRAPH_CHUNK_MAX = 500
PARAGRAPH_MIN_KEEP = 100
```

### text_formatter.py

```python
MAX_LLM_FORMAT_LENGTH = 80000
CHUNK_SIZE = 30000
```

### markdown_exporter.py

```python
MARKDOWN_CHUNK_TARGET = 4000
MARKDOWN_CHUNK_MAX = 6000
```

### cover_extractor.py

```python
COVER_WIDTH = 200
COVER_HEIGHT = 280
COVER_BG_COLOR = "#2D3748"
COVER_TEXT_COLOR = "#E2E8F0"
```

### bm25_indexer.py

```python
STOP_WORDS = {
    "的", "了", "是", "在", "和", "与", "或", "对于", "关于", "这类",
    "那种", "这个", "那个", "这些", "那些", "等", "吗", "呢", "啊",
    "吧", "哈", "嗯", "有", "没有", "可以", "能够", "应该", "需要",
    "要", "会", "书中", "内容", "是否",
}
```

---

## 错误处理

### 常见错误类型

```python
# indexer.py 错误
{"status": "error", "error": "PDF file not found: /path/to/file.pdf"}
{"status": "error", "error": "PDF file is too small (< 1KB)"}
{"status": "error", "error": "LLM API key is required..."}
{"status": "error", "error": "PageIndex returned empty tree structure"}

# querier.py 错误
{"status": "error", "error": "Query cannot be empty"}
{"status": "error", "error": "Index idx_xxx not found"}

# LLM 树搜索错误类型
LLMTreeSearchError(message, "timeout")
LLMTreeSearchError(message, "parse_error")
LLMTreeSearchError(message, "invalid_node")
LLMTreeSearchError(message, "no_api_key")
```

---

## 缓存机制

### 索引元数据缓存

```python
# querier.py
_index_metadata_cache: TTLCache[str, Dict[str, Any]] = TTLCache(
    ttl_seconds=300.0,  # 5 分钟 TTL
    max_size=50,
)

# 使用
metadata = get_index_metadata(storage_dir, index_id)  # 带缓存
invalidate_index_metadata(storage_dir, index_id)      # 失效缓存
```

### ChromaDB 客户端缓存

```python
# storage/chroma_store.py
# 使用 lru_cache 缓存 ChromaStore 实例
store = get_chroma_store(persist_directory=str(chroma_dir))
```
