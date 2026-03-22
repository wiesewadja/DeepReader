---
name: DeepReader-dr-backend-api
description: Use when working with the backend-api module of DeepReader — the FastAPI REST API layer that exposes PDF/EPUB indexing, querying, file management, configuration, and export capabilities.
---

# DeepReader Backend API Module

## Module Purpose & Capabilities

This module is the **FastAPI REST API layer** for DeepReader, providing the HTTP interface for all frontend-backend communication. It exposes the following core capabilities:

1. **Indexing**: Create, list, query, and delete PDF/EPUB document indexes (async background tasks with progress tracking)
2. **Querying**: Search indexed documents using vector search, BM25, or LLM-powered tree search
3. **File Management**: Upload, list, and manage PDF/EPUB source files with deduplication support
4. **Configuration**: CRUD operations for user-defined LLM and indexing configurations
5. **Export**: Export node data for Markdown generation, extract book covers
6. **Reading**: Retrieve table of contents, chapter summaries, and book summaries
7. **Chat Sessions**: Persist and manage conversation history per index
8. **EPUB Images**: Serve extracted images from EPUB files

### Public API Surface

All endpoints are mounted under `/api` prefix. The main router is exported from `routes.py` and re-exported via `__init__.py`.

| Route Prefix | File | Purpose |
|-------------|------|---------|
| `/api` | `routes.py` | Core indexing, querying, task management, summaries |
| `/api/files` | `file_routes.py` | File upload and management |
| `/api/config` | `config_routes.py` | User configuration CRUD |
| `/api/reading` | `reading_routes.py` | Table of contents and book summaries |
| `/api/epub-images` | `epub_image_routes.py` | EPUB image serving |

---

## Core Design Logic

### Why This Architecture?

1. **Separation of Routes by Domain**: Each `*_routes.py` file handles a specific domain (files, config, reading), making the codebase modular and easier to maintain. The main `routes.py` handles core indexing/querying.

2. **Corresponding Model Files**: Each routes file has a matching `*_models.py` file for Pydantic request/response models, ensuring type safety and automatic OpenAPI schema generation.

3. **Async Background Tasks**: Indexing is CPU/IO-intensive. The `POST /api/index` endpoint returns immediately with a `task_id`, while the actual indexing runs in a background `asyncio.Task`. This prevents HTTP timeout issues and enables progress tracking.

4. **Rate Limiting**: In-memory rate limiting (`RateLimiter` class) prevents abuse of the indexing endpoint (20 requests per 10 minutes per IP).

5. **Task Cleanup**: A background coroutine (`_cleanup_completed_tasks`) runs hourly to remove stale task records, preventing memory leaks.

6. **Caching**: `TTLCache` is used for index lists (30-second TTL) to reduce redundant file system scans during frontend polling.

7. **Security Validations**: Path traversal prevention, file type validation, and index_id sanitization are implemented throughout.

### Key Trade-offs

- **In-memory task storage**: `_running_tasks` is a module-level dict. This works for single-instance deployments but won't scale to multi-worker/multi-node setups without external state (Redis).
- **In-memory rate limiting**: Same limitation — not distributed.
- **No authentication**: The API assumes a trusted frontend; no JWT or API key validation.

---

## State Flow

### Index Creation Flow

```
POST /api/index
    │
    ├─► Rate limit check (RateLimiter.check_rate_limit)
    │
    ├─► Validate file_id or path
    │   ├─► If file_id: look up in FileStorage
    │   └─► If path: import file via FileStorage.import_from_path
    │       └─► If reuse_info exists: return "instant index" response
    │
    ├─► Extract LLM config (from saved config or request params)
    │
    ├─► Create task_id, store in _running_tasks
    │
    ├─► Create asyncio.Task → _run_index_task()
    │   │
    │   ├─► Set status = "processing"
    │   │
    │   ├─► Call index_pdf() from services/indexer.py
    │   │   (passes progress_callback to update _running_tasks)
    │   │
    │   ├─► On success:
    │   │   ├─► Set status = "completed"
    │   │   └─► Clear _index_list_cache
    │   │
    │   └─► On failure: Set status = "failed"
    │
    └─► Return IndexResponse(status="pending", index_id=task_id)
```

### Query Flow

```
POST /api/query
    │
    ├─► Validate query not empty
    │
    ├─► Validate index exists (check metadata file)
    │
    └─► Call query_pdf() from services/querier.py
        └─► Returns QueryResponse with results, search_method, thinking, etc.
```

### Task Status Tracking

```
GET /api/indexes/{task_id}
    │
    ├─► If task_id starts with "task_":
    │   └─► Return _running_tasks[task_id] with progress info
    │
    └─► Else: Look up in completed indexes list
```

---

## Core Data Structures

See `reference.md` for complete type definitions. Key structures:

### Task State (`_running_tasks`)

```python
_running_tasks: Dict[str, Dict] = {}
# Each entry:
{
    "task": asyncio.Task,
    "status": "pending" | "processing" | "completed" | "failed" | "cancelled",
    "message": str,
    "pdf_path": str,
    "file_id": str,
    "original_filename": str,
    "created_at": str,
    "cancelled": bool,
    "current_step": str,
    "progress_percent": int,
    "result": dict,  # On completion
    "error": str,    # On failure
}
```

### Rate Limiter State

```python
# RateLimiter._requests: Dict[str, list]
# Each list contains (timestamp, count) tuples
```

### Key Pydantic Models

- `IndexRequest`: File reference + LLM config overrides
- `IndexResponse`: Task status + optional index metadata
- `QueryRequest`: Query text + index_id + search options
- `QueryResponse`: Results + search metadata (method, weights, thinking)
- `TaskProgressResponse`: Detailed task progress

---

## Common Modification Scenarios

### 1. Add a New API Endpoint

**Files to modify**:
- `routes.py` (for core functionality)
- `models.py` (for request/response models)

**Example**: Adding a batch delete endpoint

```python
# In models.py
class BatchDeleteRequest(BaseModel):
    index_ids: List[str]

class BatchDeleteResponse(BaseModel):
    status: str
    deleted: List[str]
    failed: List[dict]

# In routes.py
@router.post("/indexes/batch-delete", response_model=BatchDeleteResponse)
async def batch_delete_indexes(body: BatchDeleteRequest):
    # Implementation
```

### 2. Change Rate Limiting Policy

**File**: `routes.py`

**Location**: `create_index()` function (line ~309-314)

```python
is_allowed, rate_info = _rate_limiter.check_rate_limit(
    client_ip,
    max_requests=20,  # Change this
    window_seconds=600,  # Change this
)
```

### 3. Add New Configuration Options

**Files to modify**:
- `config_models.py`: Add fields to `LLMConfig` or `IndexingConfig`
- `config_routes.py`: No changes needed if using Pydantic model validation
- `routes.py`: Update `create_index()` to extract and pass new options to `index_pdf()`

### 4. Add Progress Callback for New Indexing Steps

**File**: `routes.py`

**Location**: `_run_index_task()` function

The `progress_callback` function updates `_running_tasks[task_id]` with `current_step`, `progress_percent`, and `message`. If `index_pdf()` adds new steps, ensure it calls the callback with appropriate values.

### 5. Add New Export Format

**Files to modify**:
- `export_handlers.py`: Add new async function for export logic
- `export_models.py`: Add response model
- `routes.py`: Add new endpoint

### 6. Change Caching Strategy

**File**: `routes.py`

**Locations**:
- `_index_list_cache` initialization (line ~55)
- Cache invalidation in `_run_index_task()` (line ~281)
- Cache usage in `list_all_indexes()` (line ~599-606)

### 7. Add Authentication/Authorization

**Approach**: Create a FastAPI `Depends` function that validates auth tokens, then add it to endpoints:

```python
from fastapi import Depends

async def get_current_user(token: str = Header(...)):
    # Validate token
    return user

@router.post("/index", dependencies=[Depends(get_current_user)])
async def create_index(...):
```

---

## File Path Index

| File | Purpose |
|------|---------|
| `/Users/lizhao/workspace/DeepReader/backend/deeppdf-api/src/deeppdf/api/__init__.py` | Module exports |
| `/Users/lizhao/workspace/DeepReader/backend/deeppdf-api/src/deeppdf/api/routes.py` | Core API routes (index, query, tasks, sessions, summaries) |
| `/Users/lizhao/workspace/DeepReader/backend/deeppdf-api/src/deeppdf/api/models.py` | Core request/response models |
| `/Users/lizhao/workspace/DeepReader/backend/deeppdf-api/src/deeppdf/api/file_routes.py` | File management routes |
| `/Users/lizhao/workspace/DeepReader/backend/deeppdf-api/src/deeppdf/api/file_models.py` | File models |
| `/Users/lizhao/workspace/DeepReader/backend/deeppdf-api/src/deeppdf/api/config_routes.py` | Configuration CRUD routes |
| `/Users/lizhao/workspace/DeepReader/backend/deeppdf-api/src/deeppdf/api/config_models.py` | Configuration models |
| `/Users/lizhao/workspace/DeepReader/backend/deeppdf-api/src/deeppdf/api/reading_routes.py` | Reading/TOC routes |
| `/Users/lizhao/workspace/DeepReader/backend/deeppdf-api/src/deeppdf/api/export_handlers.py` | Export logic (index data, cover) |
| `/Users/lizhao/workspace/DeepReader/backend/deeppdf-api/src/deeppdf/api/export_models.py` | Export models |
| `/Users/lizhao/workspace/DeepReader/backend/deeppdf-api/src/deeppdf/api/export_utils.py` | Export utilities |
| `/Users/lizhao/workspace/DeepReader/backend/deeppdf-api/src/deeppdf/api/epub_image_routes.py` | EPUB image serving |

---

## Dependencies on Other Modules

This API module depends on:

- `..services.indexer` → `index_pdf()` for document indexing
- `..services.querier` → `query_pdf()` for document querying
- `..services.manager` → `list_indexes()`, `delete_index()`, `update_index_metadata()`, `load_index_metadata()`
- `..services.config_storage` → `ConfigStorage` for user configuration persistence
- `..services.file_storage` → `FileStorage` for file management
- `..services.chat_storage` → `chat_storage` for conversation persistence
- `..services.book_summary` → `generate_full_summary()` for book summary generation
- `..services.cover_extractor` → Cover extraction functions
- `..services.text_formatter` → `TextFormatter` for text processing
- `..services.markdown_exporter` → Paragraph fetching and text building
- `..config` → `settings` for configuration
- `..utils.cache` → `TTLCache` for caching
- `..utils.llm_client` → `get_llm_client` for LLM operations
