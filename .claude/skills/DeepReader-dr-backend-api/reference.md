# DeepReader Backend API Reference

This document contains detailed type definitions, function signatures, and complete API endpoint specifications.

---

## Enumerations

### TaskStatus
**File**: `models.py` (line 13-20)

```python
class TaskStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
```

### ConfidenceLevel
**File**: `models.py` (line 23-28)

```python
class ConfidenceLevel(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
```

---

## Request Models

### IndexRequest
**File**: `models.py` (line 34-100)

Creates a new document index.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `file_id` | `Optional[str]` | `None` | ID of uploaded file (from `/api/files`) |
| `path` | `Optional[str]` | `None` | Absolute path to PDF/EPUB file |
| `config_name` | `Optional[str]` | `None` | Name of saved configuration to use |
| `llm_provider` | `Optional[str]` | `None` | LLM provider: deepseek/openai/google/custom/anthropic/kimi/zhipu |
| `llm_model` | `Optional[str]` | `None` | Model name |
| `deepseek_api_key` | `Optional[str]` | `None` | DeepSeek API key |
| `openai_api_key` | `Optional[str]` | `None` | OpenAI API key |
| `api_url` | `Optional[str]` | `None` | Custom API base URL |
| `max_pages_per_node` | `Optional[int]` | `None` | Max pages per section node |
| `max_tokens_per_node` | `Optional[int]` | `None` | Max tokens per section node |
| `if_add_node_summary` | `Optional[bool]` | `None` | Add LLM-generated summaries |
| `enable_text_formatting` | `bool` | `True` | Enable text formatting (merge soft breaks, etc.) |

**Validators**:
- `validate_pdf_path`: Ensures path ends with `.pdf` or `.epub`, prevents path traversal (`..`), limits length to 500 chars
- `validate_llm_provider`: Ensures provider is in allowed list

### QueryRequest
**File**: `models.py` (line 103-114)

Queries an indexed document.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | `str` | required | Query text |
| `index_id` | `str` | required | Index ID to query |
| `max_results` | `Optional[int]` | `10` | Maximum number of results |
| `use_llm_tree_search` | `bool` | `False` | Enable LLM tree search (deep thinking mode) |
| `scope_node_ids` | `Optional[List[str]]` | `None` | Restrict search to specific nodes |

### GenerateSummaryRequest
**File**: `models.py` (line 297-301)

Requests book summary generation.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `index_id` | `str` | required | Index ID |
| `force_regenerate` | `bool` | `False` | Force regeneration even if cached |

### MarkdownMappingBody
**File**: `models.py` (line 220-227)

Saves Markdown file mappings.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `file_mapping` | `dict` | required | node_id → Markdown path |
| `block_mapping` | `Optional[dict]` | `None` | node_id → block_id → Markdown path |

---

## Response Models

### IndexResponse
**File**: `models.py` (line 120-134)

| Field | Type | Description |
|-------|------|-------------|
| `status` | `str` | Status string |
| `task_id` | `Optional[str]` | Task ID for background tracking |
| `message` | `Optional[str]` | Status message |
| `file_id` | `Optional[str]` | File ID |
| `pdf_path` | `Optional[str]` | PDF path |
| `index_id` | `Optional[str]` | Index ID (on completion or reuse) |
| `doc_type` | `Optional[Literal["pdf", "epub"]]` | Document type |
| `node_count` | `Optional[int]` | Number of nodes |
| `pdf_name` | `Optional[str]` | Display name |
| `indexing_method` | `Optional[str]` | Method used |
| `reused` | `Optional[bool]` | Whether existing data was reused |
| `error` | `Optional[str]` | Error message |

### QueryResponse
**File**: `models.py` (line 144-156)

| Field | Type | Description |
|-------|------|-------------|
| `status` | `str` | Status string |
| `results` | `Optional[List[QueryResultItem]]` | Search results |
| `error` | `Optional[str]` | Error message |
| `index_info` | `Optional[dict]` | Index metadata |
| `search_method` | `Optional[str]` | Search method used |
| `query_type` | `Optional[str]` | Query type: how_to/definition/fact/general |
| `weights` | `Optional[dict]` | RRF weights: {"vector": 0.7, "bm25": 0.3} |
| `thinking` | `Optional[str]` | LLM reasoning process |
| `fallback` | `Optional[bool]` | Whether fallback occurred |
| `fallback_reason` | `Optional[str]` | Fallback reason |

### TaskProgressResponse
**File**: `models.py` (line 196-218)

| Field | Type | Description |
|-------|------|-------------|
| `id` | `str` | Task ID |
| `status` | `TaskStatus` | Task status (enum) |
| `message` | `str` | Status message |
| `pdf_path` | `Optional[str]` | PDF path |
| `created_at` | `Optional[str]` | Creation timestamp |
| `current_step` | `Optional[str]` | Current processing step |
| `progress_percent` | `Optional[int]` | Progress 0-100 |
| `total_steps` | `Optional[int]` | Total steps |
| `completed_steps` | `Optional[int]` | Completed steps |
| `index_id` | `Optional[str]` | Index ID (on completion) |
| `node_count` | `Optional[int]` | Node count (on completion) |
| `pdf_name` | `Optional[str]` | PDF name (on completion) |
| `error` | `Optional[str]` | Error message (on failure) |

### BookSummary
**File**: `models.py` (line 279-294)

| Field | Type | Description |
|-------|------|-------------|
| `index_id` | `str` | Index ID |
| `core_thesis` | `str` | Core thesis (1-2 sentences) |
| `author_intents` | `List[str]` | Author intents (3-5 questions) |
| `book_type` | `Literal["theoretical", "practical", "fiction", "mixed"]` | Book classification |
| `chapter_summaries` | `List[ChapterSummary]` | Chapter summaries |
| `generated_at` | `Optional[str]` | Generation timestamp |
| `model_used` | `Optional[str]` | Model used for generation |

### ChapterSummary
**File**: `models.py` (line 268-276)

| Field | Type | Description |
|-------|------|-------------|
| `node_id` | `str` | Node ID |
| `title` | `str` | Chapter title |
| `summary` | `str` | One-sentence summary |
| `key_questions` | `List[str]` | Questions the chapter addresses |

---

## File Management Models

**File**: `file_models.py`

### FileUploadResponse
| Field | Type | Description |
|-------|------|-------------|
| `file_id` | `str` | Unique file identifier |
| `file_name` | `str` | Original filename |
| `file_size` | `int` | Size in bytes |
| `file_path` | `str` | Server storage path |
| `uploaded_at` | `str` | Upload timestamp |
| `status` | `str` | File status |
| `indexed` | `bool` | Whether indexed |
| `reused` | `bool` | Whether reused existing file |
| `has_result` | `bool` | Whether parsing results exist |
| `cover_url` | `Optional[str]` | Cover image URL |

### FileInfo
| Field | Type | Description |
|-------|------|-------------|
| `file_id` | `str` | Unique identifier |
| `file_name` | `str` | Original filename |
| `file_size` | `int` | Size in bytes |
| `file_path` | `str` | Server path |
| `uploaded_at` | `str` | Upload timestamp |
| `status` | `str` | Status |
| `indexed` | `bool` | Indexed flag |
| `indexes` | `List[str]` | Associated index IDs |

---

## Configuration Models

**File**: `config_models.py`

### LLMConfig
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | `str` | `"deepseek"` | Provider name |
| `model` | `str` | `"deepseek-chat"` | Model name |
| `api_key` | `Optional[str]` | `None` | API key |
| `base_url` | `Optional[str]` | `None` | Custom base URL |

### IndexingConfig
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `toc_check_pages` | `int` | `20` | Pages to check for TOC |
| `max_pages_per_node` | `int` | `10` | Max pages per node |
| `max_tokens_per_node` | `int` | `20000` | Max tokens per node |
| `if_add_node_summary` | `bool` | `True` | Add summaries |
| `if_add_node_text` | `bool` | `False` | Add original text |

### UserConfig
| Field | Type | Description |
|-------|------|-------------|
| `name` | `str` | Configuration name (unique) |
| `description` | `Optional[str]` | Description |
| `is_default` | `bool` | Is default config |
| `llm` | `LLMConfig` | LLM settings |
| `indexing` | `IndexingConfig` | Indexing settings |

---

## Export Models

**File**: `export_models.py`

### ExportNodeData
| Field | Type | Description |
|-------|------|-------------|
| `node_id` | `str` | Node identifier |
| `node_name` | `str` | Node name |
| `section` | `str` | Section title |
| `page_range` | `str` | Page range string |
| `start_index` | `int \| str` | Start page |
| `end_index` | `int \| str` | End page |
| `level` | `int` | Nesting level |
| `text` | `str` | Formatted text content |
| `summary` | `str \| None` | LLM-generated summary |
| `parent_id` | `str \| None` | Parent node ID |

### ExportIndexResponse
| Field | Type | Description |
|-------|------|-------------|
| `status` | `str` | Status |
| `index_id` | `str` | Index ID |
| `pdf_name` | `str` | Document name |
| `author` | `Optional[str]` | Author (EPUB) |
| `total_pages` | `int` | Total pages |
| `created_at` | `str` | Creation time (ISO 8601) |
| `nodes` | `List[ExportNodeData]` | Node data list |

### CoverResponse
| Field | Type | Description |
|-------|------|-------------|
| `status` | `str` | Status |
| `index_id` | `str` | Index ID |
| `pdf_name` | `str` | Document name |
| `cover_data` | `str` | Base64-encoded image |
| `mime_type` | `str` | MIME type (default: image/png) |
| `has_custom_cover` | `bool` | True if extracted, False if generated |

---

## Reading Models

**File**: `reading_routes.py` (inline definitions)

### ChapterItem
| Field | Type | Description |
|-------|------|-------------|
| `title` | `str` | Chapter title |
| `start_page` | `int` | Start page |
| `end_page` | `int` | End page |
| `level` | `int` | Nesting level |
| `summary` | `Optional[str]` | LLM summary |
| `obsidian_link` | `Optional[str]` | Obsidian link |

### TocSection (2-level flat structure)
| Field | Type | Description |
|-------|------|-------------|
| `level_1` | `str` | Level 1 title |
| `node_id` | `Optional[str]` | Node ID |
| `obsidian_link` | `Optional[str]` | Obsidian link |
| `summary` | `Optional[str]` | Summary |
| `sub_chapters` | `List[SubChapter]` | Level 2 chapters |

### SubChapter
| Field | Type | Description |
|-------|------|-------------|
| `title` | `str` | Title |
| `node_id` | `Optional[str]` | Node ID |
| `obsidian_link` | `Optional[str]` | Obsidian link |

---

## API Endpoints Summary

### Core Routes (`/api`)

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `/index` | `create_index` | Create document index (async) |
| POST | `/query` | `query_index` | Query indexed document |
| GET | `/indexes` | `list_all_indexes` | List all indexes and tasks |
| GET | `/indexes/{index_id}` | `get_index_status` | Get index/task status |
| DELETE | `/indexes/{index_id}` | `delete_index_endpoint` | Delete index or cancel task |
| GET | `/tasks/{task_id}/progress` | `get_task_progress` | Get detailed task progress |
| GET | `/tasks` | `list_running_tasks` | List processing tasks |
| DELETE | `/tasks/{task_id}` | `cancel_task_endpoint` | Cancel running task |
| GET | `/export/{index_id}` | `export_index_endpoint` | Export node data |
| GET | `/export/{index_id}/cover` | `export_cover_endpoint` | Export cover image |
| POST | `/markdown-mapping/{index_id}` | `save_markdown_mapping` | Save Markdown file mapping |
| GET | `/chat/history/{index_id}/{session_id}` | `get_chat_history` | Get chat history |
| GET | `/chat/sessions/{index_id}` | `list_sessions` | List chat sessions |
| DELETE | `/chat/sessions/{index_id}/{session_id}` | `delete_session` | Delete chat session |
| POST | `/summary/generate` | `generate_book_summary_endpoint` | Generate book summary |
| GET | `/summary/{index_id}` | `get_book_summary_endpoint` | Get cached book summary |

### File Routes (`/api/files`)

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| POST | `` | `upload_file` | Upload PDF/EPUB |
| GET | `` | `list_files` | List all files |
| GET | `/{file_id}` | `get_file_info` | Get file details |
| GET | `/{file_id}/cover` | `get_file_cover` | Get file cover image |
| DELETE | `/{file_id}` | `delete_file` | Delete file |

### Config Routes (`/api/config`)

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `` | `list_configs` | List all configs |
| GET | `/default` | `get_default_config` | Get default config |
| POST | `` | `create_config` | Create config |
| PUT | `/{name}` | `update_config` | Update config |
| DELETE | `/{name}` | `delete_config` | Delete config |
| PATCH | `/{name}/set-default` | `set_default_config` | Set as default |

### Reading Routes (`/api/reading`)

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/{index_id}/toc` | `get_table_of_contents` | Get chapter list |
| GET | `/{index_id}/toc/flat` | `get_table_of_contents_flat` | Get flat 2-level TOC |
| GET | `/{index_id}/summary` | `get_or_generate_summary` | Get/generate book summary |

### EPUB Image Routes (`/api/epub-images`)

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/{index_id}/{image_name}` | `get_epub_image` | Get single image |
| GET | `/{index_id}` | `list_epub_images` | List all images |

---

## Key Functions

### RateLimiter.check_rate_limit()
**File**: `routes.py` (line 84-137)

```python
def check_rate_limit(
    self, client_ip: str, max_requests: int, window_seconds: int
) -> Tuple[bool, Dict[str, int]]:
    """
    Check if rate limit is exceeded.

    Returns:
        (is_allowed, info): is_allowed indicates if request is permitted
                           info contains limit, remaining, reset, window
    """
```

### _run_index_task()
**File**: `routes.py` (line 228-291)

```python
async def _run_index_task(
    task_id: str,
    pdf_path: str,
    storage_dir: str,
    original_filename: str = None,
    **kwargs
):
    """Background task runner for PDF indexing.

    Uses progress_callback to update _running_tasks with progress info.
    Handles cancellation via _running_tasks[task_id]["cancelled"] flag.
    """
```

### export_index_data()
**File**: `export_handlers.py` (line 97-252)

```python
async def export_index_data(index_id: str) -> Dict[str, Any]:
    """Export node data for Markdown generation.

    - Loads index metadata
    - Fetches paragraphs from ChromaDB
    - Formats text using TextFormatter
    - Returns nodes with text, summary, page_range, parent_id
    """
```

### export_cover_data()
**File**: `export_handlers.py` (line 255-377)

```python
async def export_cover_data(index_id: str) -> Dict[str, Any]:
    """Export book cover as base64.

    Priority:
    1. Cached cover file (cover_path in metadata)
    2. Extracted from source file
    3. Generated default cover
    """
```

### _extract_chapters()
**File**: `reading_routes.py` (line 76-120)

```python
def _extract_chapters(
    tree_structure: List[dict],
    level: int = 0,
    book_name: str = "",
    markdown_files: Optional[Dict[str, str]] = None,
) -> List[ChapterItem]:
    """Recursively extract chapter list from tree_structure."""
```

### _extract_flat_toc()
**File**: `reading_routes.py` (line 123-231)

```python
def _extract_flat_toc(
    tree_structure: List[dict],
    book_name: str = "",
    markdown_files: Optional[Dict[str, str]] = None,
    level: int = 0,
) -> List[TocSection]:
    """Extract 2-level flat TOC structure (skeleton + leaves)."""
```

---

## Utility Functions

### get_pdf_page_count()
**File**: `export_utils.py` (line 9-23)

```python
def get_pdf_page_count(pdf_path: str) -> int:
    """Get PDF total page count using pypdf."""
```

### build_parent_mapping()
**File**: `export_utils.py` (line 26-57)

```python
def build_parent_mapping(tree_structure: list) -> Dict[str, Optional[str]]:
    """Build node_id → parent_id mapping from tree structure."""
```

### format_created_at()
**File**: `export_utils.py` (line 75-86)

```python
def format_created_at(created_at: str) -> str:
    """Convert 'YYYY-MM-DD HH:MM:SS' to ISO 8601 format."""
```

### get_source_file_path()
**File**: `export_handlers.py` (line 29-94)

```python
def get_source_file_path(
    metadata: Dict[str, Any], storage_dir: Path
) -> Optional[str]:
    """Get source file path from metadata, preferring uploads directory."""
```

---

## Module-Level State

### _running_tasks
**File**: `routes.py` (line 52)

```python
_running_tasks: Dict[str, Dict] = {}
```

Stores all active and recent tasks. Keys are task IDs starting with `task_`.

### _index_list_cache
**File**: `routes.py` (line 55)

```python
_index_list_cache = TTLCache[str, Dict](ttl_seconds=30.0, max_size=10)
```

Caches index list with 30-second TTL.

### _rate_limiter
**File**: `routes.py` (line 141)

```python
_rate_limiter = RateLimiter()
```

Global rate limiter instance.

### _file_storage
**File**: `routes.py` (line 145)

```python
_file_storage = FileStorage(storage_dir=str(_storage_dir))
```

File storage service instance.

### _config_storage
**File**: `config_routes.py` (line 30)

```python
_config_storage = ConfigStorage(storage_dir=str(_storage_dir))
```

Configuration storage service instance.
