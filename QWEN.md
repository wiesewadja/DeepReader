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
| **LLM Providers** | DeepSeek, OpenAI, custom (OpenAI-compatible API) | Summary generation, intelligent Q&A |
| **Package Management** | uv (backend), npm (frontend) | Dependency management |

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
└─────────────────────────────────────────────────────────────────┘
```

## Agent System

### Cognitive Engine (State Machine)

The frontend implements a state machine based on Adler's "How to Read a Book" methodology:

```
┌─────────┐    ┌──────────────┐    ┌─────────────┐    ┌───────────┐
│  S0     │    │     S1       │    │     S2      │    │    S4     │
│ Router  │───▶│ Inspectional │───▶│ Analytical  │───▶│ Formatter │
│         │    │              │    │             │    │           │
│ Intent  │    │ Scope Lock   │    │ Deep Read   │    │ Output    │
│ Detect  │    │ (get_toc)    │    │ (search_doc)│    │ Format    │
└─────────┘    └──────────────┘    └─────────────┘    └───────────┘
```

| State | Purpose | Tools | Model |
|-------|---------|-------|-------|
| **S0 Router** | Intent detection, depth assessment | None | fast |
| **S1 Inspectional** | Lock chapter scope (1-3 chapters) | `get_toc` | fast |
| **S2 Analytical** | Deep content analysis within scope | `search_doc`, `get_chapter` | main |
| **S3 Syntopical** | Cross-book synthesis (deferred) | `search_read_books` | main |
| **S4 Formatter** | Format output with citations | None | fast |

### Agent Tools

| Tool | Purpose | Parameters |
|------|---------|------------|
| `search_doc` | Semantic + keyword search in indexed PDF | `query`, `index_id`, `scopeNodeIds?`, `top_k?` |
| `get_toc` | Get table of contents with summaries | `index_id` |
| `get_chapter` | Get full chapter content | `index_id`, `node_id` |
| `analyze_chapter` | Combined term + argument analysis | `index_id`, `node_id`, `query` |
| `search_read_books` | Cross-book search across all indexed docs | `query`, `top_k?` |
| `write_note` | Write content to Obsidian note | `path`, `content`, `mode?` |
| `add_memory` | Add memory entry | `content`, `tags?` |
| `search_memory` | Search memory entries | `query`, `limit?` |
| `update_profile` | Update user profile | `updates` |
| `create_sub_agent` | Create sub-agent for complex tasks | `task`, `tools` |
| `check_sub_agent` | Check sub-agent status | `task_id` |
| `canvas` | Create Obsidian Canvas file | `nodes`, `edges` |
| `excalidraw` | Create Excalidraw diagram | `elements` |

### Tool Interceptor

The `scope-interceptor` physically locks search scope to prevent LLM from accessing chapters outside the locked scope:

```typescript
// When scopeNodeIds is empty, no scope filtering is applied (global search)
export function createScopeInterceptor(scopeNodeIds: string[]): ToolInterceptor
```

## Key Directories

### `/backend/deeppdf-api/src/deeppdf/`

```
├── api/
│   ├── routes.py              # FastAPI endpoints
│   ├── models.py              # Pydantic request/response models
│   ├── export_handlers.py     # Markdown export API logic
│   ├── config_routes.py       # Configuration management
│   ├── file_routes.py         # File upload and management
│   └── reading_routes.py      # Reading session endpoints
├── services/
│   ├── indexer.py             # PDF/EPUB indexing
│   ├── querier.py             # Search with hybrid/LLM tree search
│   ├── manager.py             # Index listing/deletion
│   ├── chat_storage.py        # Session storage
│   └── config_storage.py      # User config storage
├── storage/
│   ├── chroma_store.py        # ChromaDB wrapper
│   └── embeddings.py          # Embedding model config
└── main.py                    # FastAPI app entry point
```

### `/frontend/src/agent/`

```
├── cognitive-engine/          # State machine implementation
│   ├── states/                # State nodes (Router, Inspectional, etc.)
│   ├── prompts/               # System prompts for each state
│   ├── interceptor/           # Tool interceptors
│   └── integration/           # Backend adapters
├── tools/                     # Tool implementations
│   ├── search-doc.ts          # Semantic search
│   ├── get-toc.ts             # TOC retrieval
│   ├── get-chapter.ts         # Chapter content
│   └── ...                    # Other tools
├── router/                    # Intent routing
├── memory/                    # Memory management
├── session/                   # Chat session storage
└── debug/                     # Debug logging
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

Backend uses rotating log files for troubleshooting:

| Config | Value |
|--------|-------|
| Log file | `backend/logs/deeppdf.log` |
| Max size | 100MB |
| Backup count | 5 |
| Time format | Local time `YYYY-MM-DD HH:MM:SS` |

**Troubleshooting commands:**
```bash
# View latest logs
tail -100 backend/logs/deeppdf.log

# Real-time monitoring
tail -f backend/logs/deeppdf.log

# Search errors
grep -i "error\|exception\|failed" backend/logs/deeppdf.log
```

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

### Query Flow (Agent)

```
User query 
  → S0 Router: Detect intent, assess depth
  → S1 Inspectional: Lock scope (1-3 chapters)
  → S2 Analytical: Deep analysis within scope
  → S4 Formatter: Format output with citations
```

## API Documentation

Once backend is running, visit:
- **Swagger UI**: http://localhost:6088/docs
- **ReDoc**: http://localhost:6088/redoc

Key endpoints:
- `POST /api/index` - Create PDF index
- `POST /api/query` - Search PDF
- `GET /api/indexes` - List all indexes
- `GET /api/export/{index_id}` - Export Markdown data
- `POST /api/session` - Create chat session

## Important Notes for AI Assistants

1. **Async Strategy**: Always use `asyncio.to_thread()` for I/O and `ThreadPoolExecutor` for CPU-bound operations in the backend.

2. **Nest Asyncio**: Never remove `nest_asyncio.apply()` from `main.py` - PageIndex requires it.

3. **Loop Type**: Backend **must** use `--loop asyncio` with uvicorn, not uvloop.

4. **Scope Interceptor**: Empty `scopeNodeIds` array means global search (no scope filtering).

5. **Agent Routing**: The state machine routes queries based on Adler's reading methodology.

6. **Rate Limiting**: Backend implements per-IP rate limiting for indexing (20 requests per 10 minutes).

7. **LLM Provider**: Supports DeepSeek, OpenAI, and custom OpenAI-compatible APIs.

8. **Testing**: Always run tests after code changes. Backend uses pytest + pytest-asyncio; frontend uses Vitest.

9. **Code Quality**: Run `ruff check` and `black` on Python; ensure TypeScript compiles before committing.

---

**Version**: v0.9.1  
**Last Updated**: 2026-03-19  
**Status**: Production-ready