# DeepReader Project Context

## Project Overview

**DeepReader** is an intelligent PDF indexing and retrieval plugin for Obsidian, featuring a two-tier architecture with a FastAPI backend for semantic search and a TypeScript frontend Obsidian plugin.

### Core Purpose

DeepReader enables users to:
- Index PDF and EPUB documents with intelligent chapter-aware structure parsing
- Perform hybrid semantic and keyword search across documents
- Conduct natural language Q&A using LLM-powered agents with multi-tool reasoning
- Generate structured Markdown notes from indexed documents
- Jump directly to PDF pages from AI answer citations

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | TypeScript, Obsidian Plugin API | UI (sidebar, chat interface, index manager) |
| **Backend** | Python 3.10+, FastAPI | PDF indexing, vector search, LLM orchestration |
| **Vector Database** | ChromaDB | Semantic vector storage with bge-small-zh-v1.5 embeddings |
| **PDF Processing** | PyMuPDF, pypdf, pageindex-lib | Chapter structure extraction, text extraction |
| **LLM Providers** | DeepSeek, OpenAI, custom (OpenAI-compatible API) |摘要生成、智能问答 |
| **包管理** | uv (backend), npm (frontend) | Dependency management |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Obsidian Plugin (Frontend)              │
│  - TypeScript • Obsidian Plugin API                             │
│  - Views: Sidebar (chat), Index Manager                         │
│  - Communication: HTTP REST API (port 6088)                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP API
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FastAPI Backend                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  API Layer (deeppdf/api/)                                  │  │
│  │  - routes.py: Endpoints                                    │  │
│  │  - models.py: Pydantic Schemas                             │  │
│  │  - export_handlers.py: Markdown export endpoints           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                               ▼                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Services Layer (deeppdf/services/)                        │  │
│  │  - indexer.py: PDF indexing with PageIndex                 │  │
│  │  - querier.py: Hybrid/LLM tree search                      │  │
│  │  - manager.py: Index lifecycle management                  │  │
│  │  - chat_storage.py: Session management                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                               ▼                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Storage Layer (deeppdf/storage/)                          │  │
│  │  - chroma_store.py: ChromaDB wrapper                       │  │
│  │  - embeddings.py: bge-small-zh-v1.5 configuration          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                               ▼                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Agent Layer (deeppdf/agent/)                              │  │
│  │  - core.py: ReAct Agent with Tool-Calling                  │  │
│  │  - tools.py: Search, PageRead, CrossBook tools             │  │
│  │  - executor.py: Tool execution orchestration               │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Key Directories

### `/backend/deeppdf-api/src/deeppdf/`

```
├── api/
│   ├── routes.py              # FastAPI endpoints (POST /api/index, /api/query, etc.)
│   ├── models.py              # Pydantic request/response models
│   ├── export_models.py       # Markdown export data models
│   ├── export_handlers.py     # Export API logic
│   ├── config_routes.py       # Configuration management endpoints
│   ├── file_routes.py         # File upload and management endpoints
│   └── reading_routes.py      # Reading session endpoints
├── services/
│   ├── indexer.py             # PDF/EPUB indexing (CPU-bound → ThreadPoolExecutor)
│   ├── querier.py             # Search with hybrid/LLM tree search
│   ├── manager.py             # Index listing/deletion
│   ├── chat_storage.py        # Session storage
│   └── config_storage.py      # User config storage
├── storage/
│   ├── chroma_store.py        # ChromaDB wrapper
│   └── embeddings.py          # Embedding model config
├── agent/
│   ├── core.py                # DeepPDFAgent ReAct implementation
│   ├── tools.py               # Tool definitions (HybridSearch, PageRead, etc.)
│   ├── executor.py            # Tool execution orchestration
│   ├── prompt_builder.py      # Prompt engineering
│   └── prompts.py             # System prompts and routing logic
├── knowledge_graph/           # Knowledge graph integration
├── ocr/                       # DeepSeek OCR integration for image-based PDFs
├── utils/                     # Utility functions
├── main.py                    # FastAPI app entry point
└── config.py                  # Global configuration (Settings class)
```

### `/frontend/src/`

```
├── main.ts                    # Plugin entry point, command registration
├── api/
│   ├── http-client.ts         # HTTP client for backend communication
│   └── server-manager.ts      # Backend server management
├── views/
│   └── sidebar-view.ts        # Chat interface sidebar
├── ui/
│   ├── index-manager-modal.ts # Index management UI
│   ├── chat-input.ts          # Chat input component
│   ├── message.ts             # Message display
│   ├── message-list.ts        # Chat history
│   └── ...                    # Other UI components
├── components/                # Reusable React-style components
├── services/                  # Business logic services
├── types/                     # TypeScript type definitions
├── utils/                     # Utility functions
└── styles/                    # CSS styles
```

## Building and Running

### Prerequisites

- **Python 3.10+** with `uv` package manager (backend)
- **Node.js 20+** with npm (frontend)
- **Obsidian** (for frontend testing)

### Backend Setup and Run

```bash
cd backend

# Install dependencies (one-time)
uv sync

# Start development server (critical: --loop asyncio)
uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio

# Server will be available at:
# - API docs: http://localhost:6088/docs
# - Health check: http://localhost:6088/health
```

**Important**: The `--loop asyncio` flag is **required**. Using `uvloop` will cause:
```
ValueError: Can't patch loop of type <class 'uvloop.Loop'>
```

### Frontend Setup and Run

```bash
cd frontend

# Install dependencies (one-time)
npm install

# Development mode with hot reload
npm run dev

# Build for production (includes TypeScript type checking)
npm run build

# Run tests
npm run test:run
npm run test:ui          # Vitest UI
```

### Backend Logging

后端使用滚轮型日志，用于问题排查：

| 配置项 | 值 |
|-------|-----|
| 日志文件 | `backend/logs/deeppdf.log` |
| 最大大小 | 100MB |
| 备份数量 | 5 个 |
| 时间格式 | 本地时间 `YYYY-MM-DD HH:MM:SS` |

**排查命令：**
```bash
# 查看最新日志
tail -100 backend/logs/deeppdf.log

# 实时监控
tail -f backend/logs/deeppdf.log

# 搜索错误
grep -i "error\|exception\|failed" backend/logs/deeppdf.log
```

**常见日志关键词：**
- `[索引]` - PDF 索引相关
- `[查询]` - 搜索查询相关
- `[BM25]` - BM25 索引/检索相关
- `[智能检索]` - 混合搜索相关

### Code Quality Tools

**Backend:**
```bash
cd backend
uv run ruff check .        # Linting
uv run black .            # Formatting
uv run mypy src/          # Type checking
uv run pytest tests/ -v   # Run tests
```

**Frontend:**
```bash
cd frontend
npm run build             # TypeScript check (tsc -noEmit)
npm run test:run          # Unit tests
```

## Development Conventions

### Python Coding Standards

| Aspect | Standard | Tool |
|--------|----------|------|
| Line length | 100 characters | black |
| Target Python | 3.10+ | - |
| Formatting | Black style | `uv run black` |
| Linting | Ruff rules | `uv run ruff check` |
| Type checking | mypy | `uv run mypy` |
| Async | asyncio for I/O, ThreadPoolExecutor for CPU | - |

### TypeScript Coding Standards

| Aspect | Standard | Tool |
|--------|----------|------|
| Target | ES2020 | tsc |
| Module | ESNext | tsc |
| Type checking | Build-time | tsc -noEmit |
| Bundler | esbuild | esbuild |

### Git Commit Convention

```
<type>: <subject>

Types:
  feat:     New feature
  fix:      Bug fix
  refactor: Code refactor (no functional change)
  docs:     Documentation update
  test:     Test-related changes
  chore:    Build/tooling changes

Examples:
  git commit -m "feat: add batch index support"
  git commit -m "fix: resolve empty query results"
```

### Asynchronous Programming Strategy

**I/O-bound tasks** (database queries, API calls):
```python
result = await asyncio.to_thread(io_intensive_function)
```

**CPU-bound tasks** (PDF parsing, indexing):
```python
from concurrent.futures import ThreadPoolExecutor
cpu_executor = ThreadPoolExecutor(max_workers=settings.cpu_workers)
result = await loop.run_in_executor(cpu_executor, cpu_intensive_function)
```

**Critical**: `nest_asyncio.apply()` must be called in `main.py` to support PageIndex's synchronous code.

### Configuration Management

**Environment variables** (store in `backend/.env`):
```bash
# LLM API Keys (at least one required)
DEEPSEEK_API_KEY=your_key
OPENAI_API_KEY=your_key

# LLM Provider
LLM_PROVIDER=deepseek  # or openai, custom

# PDF Indexing Configuration
PDF_INDEX_TOC_CHECK_PAGES=20
PDF_INDEX_MAX_PAGES_PER_NODE=10
PDF_INDEX_MAX_TOKENS_PER_NODE=20000
PDF_INDEX_IF_ADD_NODE_SUMMARY=true

# Concurrency
CPU_WORKERS=2
MAX_CONCURRENT_REQUESTS=10
LLM_CONCURRENT_LIMIT=3
```

**Configuration file**: `deeppdf/config.py` uses `pydantic-settings` with `ConfigDict(extra="ignore")` to ignore unknown variables.

### API Design Patterns

**Error Responses**: Always return structured responses with status field:
```python
# Success
return QueryResponse(status="success", results=[...])

# Error
return QueryResponse(status="error", results=None, error="description")
```

**Rate Limiting**: Implemented per IP address in `routes.py` via `RateLimiter` class.

**Task-based Operations**: Long-running operations (indexing) return immediately with task_id:
```
POST /api/index → Returns task_id
GET /api/indexes/{task_id} → Query status
DELETE /api/indexes/{task_id} → Cancel task
```

## Key Workflows

### Indexing Flow

```
User uploads PDF 
  → API creates background task
  → PageIndex parses PDF structure + generates TOC
  → LLM generates summaries for each chapter
  → Indexer extracts nodes from tree structure
  → ChromaDB embeds and stores vectors
  → Metadata saved to storage/indexes/{index_id}.json
```

### Query Flow (Basic Search)

```
User query 
  → Query embedding (bge-small-zh-v1.5)
  → ChromaDB hybrid search (vector + keyword)
  → Return top-K similar nodes with metadata
  → Format response with citations
```

### Query Flow (Agent/LLM Tree Search)

```
User query 
  → Agent routing decision (fast/section/slow/auto)
  → HybridSearchTool: Retrieve top-20 candidates
  → LLMInferenceTool: Re-rank and extract relevant sections
  → MarkdownLocatorTool: Find exact page locations
  → Format answer with citations and jump links
```

### Agent Tools

| Tool | Purpose | Use Case |
|------|---------|----------|
| `HybridSearchTool` | Fast vector + keyword search | Simple factual queries |
| `LLMInferenceTool` | Two-stage reranking with LLM | Complex reasoning, cross-chapter |
| `MarkdownLocatorTool` | Find exact page ranges | Citation accuracy |
| `PageReadTool` | Read specific PDF pages | Detailed content extraction |
| `CrossBookSearchTool` | Search across multiple indexes | Knowledge graph queries |

### Data Flow: PDF → Vector Database

1. **PageIndex Layer**: `pageindex.py` extracts text, identifies structure, generates summaries
2. **Indexer Layer**: `_extract_nodes_from_tree()` builds node structures with:
   - `text`: `"【Section Title】\n{summary}"` (for embedding)
   - `metadata.original_text`: Original PDF text (for export)
   - `metadata.summary`: LLM-generated summary
3. **Storage Layer**: ChromaDB embeds the `text` field using `bge-small-zh-v1.5`
4. **Persistence**: Full metadata saved to `storage/indexes/{index_id}.json`

**Design principle**: Use summary for vectorization (better semantic results), preserve original text for exports.

## Testing

### Backend Tests

Location: `backend/deeppdf-api/tests/`

```bash
# Run all tests
uv run pytest tests/ -v

# Run specific test file
uv run pytest tests/test_api.py -v

# Run with coverage
uv run pytest tests/ --cov=deeppdf --cov-report=html
```

Test files include:
- `test_api.py`: Endpoint integration tests
- `test_agent_tools.py`: Agent tool logic
- `test_llm_tree_search_tool.py`: Two-stage search
- `test_cross_book_search.py`: Multi-index queries
- `integration/test_*`: End-to-end tests

### Frontend Tests

Location: `frontend/tests/` and `frontend/src/**/__tests__/*.test.ts`

```bash
# Run tests in CI mode
npm run test:run

# Run with UI
npm run test:ui
```

## Deployment

### Frontend to Obsidian

```bash
cd frontend
npm run build
cp main.js manifest.json styles.css /path/to/obsidian/vault/.obsidian/plugins/deeppdf/
```

In Obsidian:
1. Settings → Plugins → Enable "DeepReader"
2. Settings → DeepReader → Configure API port (default: 6088)

### Troubleshooting

| Issue | Root Cause | Solution |
|-------|------------|----------|
| `ValueError: Can't patch loop of type uvloop` | Missing `--loop asyncio` | Use `uv run uvicorn ... --loop asyncio` |
| Pydantic `Extra inputs not permitted` | Unknown env variables | Add `extra="ignore"` or remove from `.env` |
| TypeScript type errors | Missing Obsidian types | Install `@types/obsidian` or use `// @ts-ignore` |
| Plugin can't connect to backend | Port mismatch or backend down | Check `apiPort` setting, verify backend running |

### Debugging

**Backend**: Use Python logging
```python
logger = logging.getLogger(__name__)
logger.info("message")
logger.debug("detailed info")
```

**Frontend**: Use Obsidian Developer Tools
- Mac: `Cmd+Option+I`
- Windows/Linux: `Ctrl+Shift+I`

Access plugin instance:
```javascript
app.plugins.plugins['deeppdf']
```

## Configuration Reference

### Default Settings (Frontend)

```typescript
{
  apiPort: 6088,
  maxResults: 5,
  llmProvider: "deepseek",
  llmModel: "deepseek-chat",
  maxPagesPerNode: 10,
  maxTokensPerNode: 20000,
  ifAddNodeSummary: true,
  forceMode: "auto",  // auto | fast | section | slow
}
```

### Default Settings (Backend)

```python
# deeppdf/config.py
settings.cpu_workers = 2
settings.max_concurrent_requests = 10
settings.llm_concurrent_limit = 3
settings.pdf_index_toc_check_pages = 20
settings.pdf_index_max_pages_per_node = 10
settings.pdf_index_max_tokens_per_node = 20000
settings.base_dir = Path("backend/data")  # ChromaDB storage
```

## API Documentation

Once backend is running, visit:
- **Swagger UI**: http://localhost:6088/docs
- **ReDoc**: http://localhost:6088/redoc

Key endpoints:
- `POST /api/index` - Create PDF index
- `POST /api/query` - Search PDF
- `POST /api/agent/query` - Agent-powered Q&A
- `GET /api/indexes` - List all indexes
- `GET /api/export/{index_id}` - Export Markdown data
- `POST /api/session` - Create chat session
- `POST /api/cross-book-search` - Multi-index search

## Important Notes for AI Assistants

1. **Async Strategy**: Always use `asyncio.to_thread()` for I/O and `ThreadPoolExecutor` for CPU-bound operations in the backend.

2. **Nest Asyncio**: Never remove `nest_asyncio.apply()` from `main.py` - PageIndex requires it.

3. **Loop Type**: Backend **must** use `--loop asyncio` with uvicorn, not uvloop.

4. **Data Flow**: The separation of `text` (for embedding) vs `original_text` (for export) is critical - don't mix them up.

5. **Agent Routing**: The `forceMode` setting in frontend controls agent behavior:
   - `auto`: Automatically choose tool based on query
   - `fast`: Only fast retrieval (HybridSearch)
   - `section`: HybridSearch + PageRead
   - `slow`: Full agent with all tools

6. **Rate Limiting**: Backend implements per-IP rate limiting for indexing (20 requests per 10 minutes).

7. **LLM Provider**: Supports DeepSeek, OpenAI, and custom OpenAI-compatible APIs. API key can be configured per-request or via environment.

8. **Testing**: Always run tests after code changes. Backend tests use pytest + pytest-asyncio; frontend uses Vitest.

9. **Code Quality**: Run `ruff check` and `black` on Python; ensure TypeScript compiles before committing.

10. **Cross-Booking Search**: The agent supports searching across multiple PDF indexes simultaneously for knowledge graph queries.

## Related Documentation

- `README.md` - User-facing documentation (Chinese)
- `USER_GUIDE.md` - User workflow guide
- `CLAUDE.md` - Claude-specific context
- `gemini.md` - Gemini-specific context
- `WARP.md` - WARP-specific context
- `backend/docs/` - Architecture and analysis documents
- `backend/docs/llm-tree-search-guide.md` - Agent search guide
- `frontend/README.md` - Frontend development guide

---

**Version**: v1.0.0  
**Last Updated**: 2026-01-28  
**Status**: Production-ready
