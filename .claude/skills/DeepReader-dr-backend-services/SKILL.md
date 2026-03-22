---
name: DeepReader-dr-backend-services
description: Use when working with the backend-services module of DeepReader — 核心业务逻辑层，包含 PDF/EPUB 索引、智能检索、查询处理、主题报告生成等完整功能
---

# DeepReader Backend Services 模块技能文档

## 1. 模块概述与能力

### 1.1 模块定位

`deeppdf/services` 是 DeepReader 的核心业务逻辑层，封装了所有与 PDF/EPUB 文档处理相关的服务。该模块采用异步架构设计，通过 `asyncio.to_thread()` 将 CPU 密集型操作（如 PDF 解析、向量化）隔离到线程池中执行。

### 1.2 核心能力

| 服务 | 文件 | 核心功能 |
|------|------|----------|
| **文档索引** | `indexer.py` | PDF/EPUB 文档解析、PageIndex 树结构生成、段落切分、向量存储 |
| **智能查询** | `querier.py` | 混合检索（向量+BM25）、LLM 树搜索、范围锁定查询 |
| **索引管理** | `manager.py` | 索引列表、删除、元数据更新、阅读进度跟踪 |
| **智能检索** | `smart_search.py` | 多路召回、加权 RRF 融合、查询类型自适应 |
| **BM25 索引** | `bm25_indexer.py` | 中文分词、BM25 全文索引构建与检索 |
| **跨书搜索** | `cross_book_search.py` | 多书籍并行检索、Obsidian 链接生成 |
| **主题报告** | `theme_report/` | 查询扩展、深度搜索、观点分析、报告生成流水线 |
| **文件存储** | `file_storage.py` | 文件上传、去重、内容 hash 检测 |
| **配置存储** | `config_storage.py` | LLM 配置 CRUD、默认配置管理 |
| **会话存储** | `chat_storage.py` | 对话历史持久化 |
| **封面提取** | `cover_extractor.py` | PDF/EPUB 封面提取、默认封面生成 |
| **文本格式化** | `text_formatter.py` | 规则+LLM 混合文本清洗 |
| **Markdown 导出** | `markdown_exporter.py` | 分片导出、block_id 映射、Obsidian 兼容 |

### 1.3 公共 API 入口

```python
# deeppdf/services/__init__.py
from deeppdf.services import (
    index_pdf,      # 异步索引 PDF/EPUB
    query_pdf,      # 异步查询
    list_indexes,   # 列出所有索引
    delete_index,   # 删除索引
    hybrid_search,  # 智能混合检索
)
```

---

## 2. 核心设计逻辑

### 2.1 异步架构模式

所有服务采用统一的异步封装模式：

```python
# 同步核心逻辑（在线程池执行）
def _do_work_sync(...) -> Dict[str, Any]:
    # CPU 密集型操作
    ...

# 异步包装器（供 API 层调用）
async def do_work(...) -> Dict[str, Any]:
    return await asyncio.to_thread(_do_work_sync, ...)
```

**设计原因**：
- `pageindex-lib` 内部使用 asyncio，但不能直接在 FastAPI 的事件循环中运行
- 通过 `ThreadPoolExecutor` 隔离，每个线程创建独立的事件循环
- 避免阻塞 FastAPI 主事件循环

### 2.2 多路召回 + RRF 融合检索策略

```
用户查询
    │
    ├── 向量检索 (ChromaDB) ──┐
    │                         │
    ├── BM25 检索 (jieba3) ──┼── 加权 RRF 融合 ── 排序输出
    │                         │
    └── 标题匹配 (可选) ──────┘
```

**RRF 公式**：
```
RRF_Score = w_v * 1/(k + rank_Vector) + w_b * 1/(k + rank_BM25)
```

**查询类型自适应权重**（`smart_search.py:46-51`）：
- `how_to`: 向量 0.8, BM25 0.2（语义理解优先）
- `definition`: 向量 0.4, BM25 0.6（精确匹配优先）
- `fact`: 向量 0.3, BM25 0.7（事实查询）
- `general`: 向量 0.5, BM25 0.5（均衡）

### 2.3 段落切分策略

**切分参数**（`indexer.py:125-128`）：
```python
PARAGRAPH_CHUNK_MIN = 300      # 目标最小字数
PARAGRAPH_CHUNK_TARGET = 400   # 理想目标字数
PARAGRAPH_CHUNK_MAX = 500      # 硬性上限
PARAGRAPH_MIN_KEEP = 100       # 小于此值不切分
```

**切分逻辑**：
1. 短文本（<100字）：不切分
2. 中等文本（<=500字）：不切分
3. 长文本：按句子边界（。！？\n）切分，贪心合并到目标字数
4. 超长句子：优先在逗号处切分，否则硬切分

### 2.4 主题报告流水线架构

```
ThemeReportPipeline (theme_report/pipeline.py)
    │
    ├── Stage 1: QueryExpander ───── 查询扩展（主题 → 子问题）
    │
    ├── Stage 2: DeepSearcher ────── 多策略并行搜索
    │
    ├── Stage 3: PerspectiveAnalyzer ─ 观点提取（每本书）
    │
    ├── Stage 4: ComparisonMatrix ── 对比矩阵生成（可选）
    │
    ├── Stage 5: RoleAnalysis ────── 角色扮演分析（可选）
    │
    ├── Stage 6: ReportGenerator ─── 动态结构报告生成
    │
    └── Stage 7: ReflectionEngine ── 自我反思与修订（可选）
```

---

## 3. 核心数据结构

### 3.1 索引元数据（`{storage_dir}/indexes/{index_id}.json`）

```python
{
    "id": "idx_abc123",
    "doc_type": "pdf" | "epub",
    "pdf_name": "书籍名称",
    "file_name": "原始文件名.pdf",
    "pdf_path": "/absolute/path/to/file.pdf",
    "cover_path": "/path/to/covers/idx_abc123.png",
    "created_at": "2024-01-15 10:30:00",
    "node_count": 42,
    "total_pages": 300,

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

    # Markdown 导出映射
    "markdown_files": {
        "node_id": "DeepPDF/书名/01-章节名.md"
    },
    "block_mapping": {
        "node_id": {
            "^ch0-p0": "DeepPDF/书名/01-章节名.md",
            "^ch0-p1": "DeepPDF/书名/01-章节名-2.md"
        }
    }
}
```

### 3.2 ChromaDB 文档结构

**段落类型**（向量化存储）：
```python
{
    "id": "0001_p0-c0",  # {node_id}_p{para_idx}-c{chunk_idx}
    "text": "段落文本内容...",
    "metadata": {
        "type": "paragraph",
        "block_id": "^ch0-p0",      # Obsidian 引用标识
        "chunk_index": 0,
        "total_chunks": 1,
        "full_paragraph": "完整段落原文",
        "parent_node_id": "0001",
        "parent_section": "第一章 > 1.1 概述",
        "page": 15,
        "paragraph_index": 0,
        "char_start": 0,
        "char_end": 450,
        "pdf_name": "书名"
    }
}
```

### 3.3 主题报告数据流结构

```python
# 搜索结果
@dataclass
class SearchResult:
    text: str
    book_name: str
    index_id: str
    section: str
    page: int
    obsidian_link: str
    score: float = 0.0
    query: str = ""

# 书籍观点
@dataclass
class BookPerspective:
    book_name: str
    core_claim: str = ""
    key_arguments: List[str] = field(default_factory=list)
    unique_angle: str = ""
    quotes: List[Dict[str, Any]] = field(default_factory=list)
    confidence: str = "medium"

# 报告类型
class ReportType(str, Enum):
    EXPLORATORY = "exploratory"  # 探索性
    COMPARATIVE = "comparative"  # 对比性
    PRACTICAL = "practical"      # 实践性
```

---

## 4. 状态流转

### 4.1 索引流程

```
index_pdf(file_path, storage_dir)
    │
    ├─[1] 验证文件 (_validate_pdf_file)
    │       └─ 检查文件存在、大小
    │
    ├─[2] 检测文档类型 (_get_doc_type)
    │       └─ PDF vs EPUB
    │
    ├─[3] 检测视觉类型 (仅 PDF)
    │       └─ detect_pdf_type → is_visual_heavy
    │
    ├─[4] 初始化 PageIndex 配置
    │       └─ LLM Provider、模型参数
    │
    ├─[5] 解析文档结构 (_parse_pdf_structure)
    │       ├─ page_index_main(pdf_path, opt, llm_client)
    │       ├─ 检测目录、分割章节
    │       └─ LLM 生成摘要（可选）
    │
    ├─[6] 提取节点 (_extract_nodes_from_tree)
    │       └─ 递归遍历树结构
    │
    ├─[7] 提取段落 (_extract_all_paragraphs)
    │       ├─ 按双换行分割物理段落
    │       ├─ 生成 block_id (^ch{N}-p{M})
    │       └─ 切分长段落
    │
    ├─[8] 存储向量 (_store_to_chromadb)
    │       └─ store.add_documents(index_id, chunks)
    │
    ├─[9] 构建 BM25 索引 (build_bm25_index_from_paragraphs)
    │
    ├─[10] 提取封面 (extract_or_generate_cover)
    │
    └─[11] 保存元数据 (_save_metadata)
            └─ 写入 {storage_dir}/indexes/{index_id}.json
```

### 4.2 查询流程

```
query_pdf(query, index_id, storage_dir)
    │
    ├─[1] 加载索引元数据 (get_index_metadata)
    │       └─ TTL 缓存（5分钟，50个条目）
    │
    ├─[2] 判断检索模式
    │       ├─ use_llm_tree_search=True → LLM 树搜索
    │       └─ 默认 → 混合检索
    │
    ├─[3a] 混合检索流程
    │       ├─ 向量检索 (store.query)
    │       ├─ BM25 检索 (bm25_search)
    │       ├─ 智能融合 (hybrid_search)
    │       │       ├─ 检测查询类型
    │       │       ├─ 获取自适应权重
    │       │       ├─ 计算 RRF 分数
    │       │       └─ 排序去重
    │       └─ 获取相邻段落上下文
    │
    ├─[3b] LLM 树搜索流程
    │       ├─ 格式化树结构 (format_tree_structure)
    │       ├─ 构建 Prompt (build_tree_prompt)
    │       ├─ 调用 LLM (llm_tree_search)
    │       ├─ 解析响应 (parse_llm_response)
    │       └─ 提取节点内容 (extract_nodes_by_ids)
    │
    └─[4] 格式化返回结果
            └─ 添加 markdown_path、相邻段落
```

### 4.3 主题报告流程

```
generate_theme_report(theme, storage_dir)
    │
    ├─[1] 创建流水线配置 (PipelineConfig)
    │
    ├─[2] 查询扩展 (QueryExpander.expand)
    │       └─ 主题 → [原始主题, 子问题1, 子问题2, ...]
    │
    ├─[3] 深度搜索 (DeepSearcher.search)
    │       ├─ 并行执行多个查询
    │       ├─ 结果去重合并
    │       └─ 按书籍分组
    │
    ├─[4] 观点提取 (PerspectiveAnalyzer.extract_all_perspectives)
    │       └─ 并行提取每本书的观点
    │
    ├─[5] 对比矩阵 (ReportGenerator.generate_comparison_matrix)
    │       └─ 生成 Markdown 表格
    │
    ├─[6] 报告生成 (ReportGenerator.generate_report)
    │       ├─ 自动分类主题类型
    │       ├─ 选择报告模板
    │       └─ LLM 生成内容
    │
    ├─[7] 自我反思 (ReflectionEngine.reflect) [可选]
    │       └─ 评分 + 修订
    │
    └─[8] 添加参考文献 (generate_references)
```

---

## 5. 常见修改场景

### 5.1 添加新的 LLM Provider

**修改文件**：`indexer.py`

**关键位置**：`_setup_pageindex_config()` 函数（约 567 行）

```python
# 添加新的 Provider 配置
if llm_provider == "new_provider":
    from pageindex.llm import UnifiedLLM, get_provider
    provider = get_provider({
        "type": "new_provider",
        "api_key": llm_api_key,
        "base_url": config.get("base_url"),
    })
    llm_client_instance = UnifiedLLM(provider=provider, model=config["model"])
```

**同时修改**：`_parse_llm_config()` 添加新 Provider 的 API Key 环境变量

### 5.2 调整段落切分参数

**修改文件**：`indexer.py`

**关键位置**：模块级常量（约 125-128 行）

```python
PARAGRAPH_CHUNK_MIN = 300      # 调小 → 更细粒度
PARAGRAPH_CHUNK_TARGET = 400   # 目标字数
PARAGRAPH_CHUNK_MAX = 500      # 调大 → 允许更长段落
PARAGRAPH_MIN_KEEP = 100       # 调小 → 更积极切分
```

### 5.3 添加新的查询类型权重

**修改文件**：`smart_search.py`

**关键位置**：`QUERY_TYPE_WEIGHTS` 字典（约 46-51 行）

```python
QUERY_TYPE_WEIGHTS = {
    "how_to": {"vector": 0.8, "bm25": 0.2},
    "definition": {"vector": 0.4, "bm25": 0.6},
    "fact": {"vector": 0.3, "bm25": 0.7},
    "general": {"vector": 0.5, "bm25": 0.5},
    # 添加新类型
    "temporal": {"vector": 0.3, "bm25": 0.7},  # 时间相关查询
}
```

**同时修改**：`detect_query_type()` 函数添加识别规则

### 5.4 自定义主题报告模板

**修改文件**：`theme_report/prompts.py`

**关键位置**：`REPORT_TEMPLATES` 字典（约 229-336 行）

```python
REPORT_TEMPLATES = {
    "exploratory": """...""",
    "comparative": """...""",
    "practical": """...""",
    # 添加新模板
    "academic": """# {theme} - 学术分析报告
    ...
    """,
}
```

**同时修改**：`theme_report/report_generator.py` 的 `ThemeClassifier` 添加分类规则

### 5.5 添加新的检索策略

**修改文件**：`smart_search.py`

**步骤**：
1. 在 `hybrid_search()` 函数中添加新的检索分支
2. 实现 RRF 分数计算的权重参数
3. 更新 `SCORE_FUSION_WEIGHTS` 配置

```python
# 示例：添加标题匹配检索
def _title_match(query: str, tree_structure: Dict) -> List[Dict]:
    """标题精确匹配"""
    results = []
    # 实现匹配逻辑
    return results

# 在 hybrid_search() 中集成
title_results = _title_match(query, tree_structure)
# 合并到 RRF 计算
```

### 5.6 修改 Markdown 导出格式

**修改文件**：`markdown_exporter.py`

**关键位置**：
- `_create_markdown_content_partial()` - 分片内容格式（约 245 行）
- `REPORT_TEMPLATES` frontmatter 格式（约 297 行）

```python
# 修改 Front Matter
front_matter = f"""---
pdf_name: {pdf_name}
node_id: {node_id}
custom_field: {custom_value}  # 添加自定义字段
---
"""
```

### 5.7 添加新的存储后端

**步骤**：
1. 在 `deeppdf/storage/` 创建新的存储模块
2. 在 `indexer.py` 的 `_store_to_chromadb()` 中添加条件分支
3. 在 `querier.py` 的 `_query_pdf_sync()` 中添加查询分支

---

## 6. 依赖关系图

```
services/
    │
    ├── indexer.py
    │       ├── → pageindex (外部库)
    │       ├── → deeppdf/storage/chroma_store
    │       ├── → deeppdf/services/text_formatter
    │       └── → deeppdf/services/bm25_indexer
    │
    ├── querier.py
    │       ├── → deeppdf/storage/chroma_store
    │       ├── → deeppdf/services/smart_search
    │       ├── → deeppdf/services/llm_tree_search
    │       └── → deeppdf/services/bm25_indexer
    │
    ├── smart_search.py
    │       └── (无内部依赖)
    │
    ├── theme_report/
    │       ├── pipeline.py
    │       │       ├── → query_expander
    │       │       ├── → deep_searcher
    │       │       ├── → perspective_analyzer
    │       │       ├── → report_generator
    │       │       └── → citation_validator
    │       │
    │       ├── deep_searcher.py
    │       │       └── → cross_book_search
    │       │
    │       └── perspective_analyzer.py
    │               └── → report_generator (BookPerspective)
    │
    └── cross_book_search.py
            └── → deeppdf/storage/chroma_store
```

---

## 7. 关键配置项

| 配置项 | 位置 | 说明 |
|--------|------|------|
| `cpu_workers` | `settings.cpu_workers` | 线程池大小 |
| `pdf_index_model` | `settings.pdf_index_model` | PageIndex LLM 模型 |
| `pdf_index_llm_provider` | `settings.pdf_index_llm_provider` | LLM Provider |
| `pdf_index_max_pages_per_node` | `settings.pdf_index_max_pages_per_node` | 每节点最大页数 |
| `pdf_index_max_tokens_per_node` | `settings.pdf_index_max_tokens_per_node` | 每节点最大 token |
| `visual_detect_sample_pages` | `settings.visual_detect_sample_pages` | 视觉检测采样页数 |
| `RECALL_TOP_K` | `smart_search.py:32` | 每路召回数量 (20) |
| `RRF_K` | `smart_search.py:35` | RRF 平滑常数 (40) |
| `MAX_LLM_FORMAT_LENGTH` | `text_formatter.py:15` | LLM 格式化最大长度 (80000) |
