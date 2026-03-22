---
name: DeepReader-dr-api
description: Use when working with the api module of DeepReader — HTTP client and API facade for communicating with DeepPDF backend services, including file management, indexing, querying, agent chat, and reading progress tracking.
---

# DeepReader API Module

## 1. Module Purpose & Capabilities

### Overview

The `api` module provides a complete TypeScript HTTP client layer for communicating with the DeepPDF backend server. It abstracts all backend API calls into a clean, typed interface with three layers:

1. **`DeepPDFClient`** (`http-client.ts`) — The core HTTP client class containing all API methods
2. **`ServerManager`** (`server-manager.ts`) — Process management for spawning and controlling the FastAPI backend server
3. **API Facades** (`index.ts`) — Category-organized convenience objects (`fileAPI`, `configAPI`, `indexAPI`, `queryAPI`, `agentAPI`, `baseAPI`, `readingAPI`)

### Key Capabilities Exposed

| Capability | Description |
|------------|-------------|
| File Management | Upload PDF/EPUB files, list files, get file details, delete files |
| Configuration Management | CRUD operations for indexing configurations, set default config |
| Index Management | Create indexes from uploaded files or local paths, list/delete indexes, track task progress |
| Semantic Query | Search indexed documents with optional LLM tree search mode |
| Agent Chat | Synchronous and streaming chat with AI agent, session management |
| Reading Progress | Track and retrieve reading progress, table of contents, book summaries |
| Export | Export index data, book covers, markdown mappings |
| Server Control | Spawn and manage the backend server process |

### Public API Surface

**Core Classes:**
- `DeepPDFClient` — Main HTTP client (constructor accepts optional port number)
- `ServerManager` — Backend process manager (constructor accepts optional port number)

**Pre-configured Instances:**
- `deeppdfClient` — Default `DeepPDFClient` instance using port 6088

**API Facade Objects (from `index.ts`):**
```typescript
fileAPI.upload(file, onProgress?)    // Upload PDF with progress callback
fileAPI.list()                        // List all uploaded files
fileAPI.get(fileId)                   // Get file details
fileAPI.delete(fileId)                // Delete file

configAPI.list()                      // List all configurations
configAPI.getDefault()                // Get default configuration
configAPI.create(config)              // Create new configuration
configAPI.update(name, update)        // Update configuration
configAPI.delete(name)                // Delete configuration
configAPI.setDefault(name)            // Set as default configuration

indexAPI.createWithFile(fileId, configName?, overrides?)  // Index uploaded file
indexAPI.createWithPath(path, llmConfig?)                 // Index local file
indexAPI.list()                       // List all indexes
indexAPI.getStatus(indexId)           // Get index/task status
indexAPI.getProgress(taskId)          // Get detailed task progress
indexAPI.poll(taskId, onProgress?, interval?)  // Poll until complete
indexAPI.delete(indexId)              // Delete index
indexAPI.cancel(taskId)               // Cancel running task

queryAPI.search(query, indexId)       // Semantic search

agentAPI.chat(query, indexId, sessionId?, keepHistory?)   // Sync chat
agentAPI.chatStream(query, indexId, onChunk, ...)         // Streaming chat
agentAPI.getHistory(indexId, sessionId)  // Get chat history
agentAPI.listSessions(indexId)           // List all sessions
agentAPI.deleteSession(indexId, sessionId)  // Delete session

baseAPI.healthCheck()                 // Server health check
baseAPI.getInfo()                     // Get API info

readingAPI.updateProgress(client, indexId, pages)  // Update reading progress
readingAPI.getProgress(client, indexId)            // Get reading progress
```

---

## 2. Core Design Logic

### Why This Module Is Designed This Way

**1. Three-Layer Architecture**

The module separates concerns into three distinct layers:
- **Transport Layer** (`http-client.ts`): Handles raw HTTP communication, error handling, request/response logging
- **Process Layer** (`server-manager.ts`): Manages the backend server lifecycle (spawn, health check, kill)
- **Facade Layer** (`index.ts`): Provides ergonomic, domain-organized API surfaces for UI components

This separation allows:
- Independent testing of each layer
- Clear responsibility boundaries
- Easy migration if transport mechanism changes (e.g., from fetch to axios)

**2. Single Client Instance Pattern**

The `deeppdfClient` singleton ensures:
- Consistent base URL across the application
- Single source of truth for server port configuration
- Easy dependency injection in tests

**3. Request Abstraction with Debug Logging**

The private `request<T>()` method in `DeepPDFClient` centralizes:
- URL construction
- Performance timing
- Debug logging via `getDebugLogger()`
- Error normalization

All API methods delegate to this single method, ensuring consistent behavior.

**4. Streaming-First Agent Chat**

The `agentChatStream()` method uses Server-Sent Events (SSE) protocol with:
- `AbortController` for cancellable requests
- Buffer management for incomplete lines
- Metadata passing (citations, status) alongside content chunks

**5. Progress-Polling Pattern**

The `pollTaskStatus()` method implements a common async pattern:
```typescript
while (true) {
  const progress = await this.getTaskProgress(taskId);
  if (completed/failed/cancelled) return/throw;
  await sleep(interval);
}
```

This allows UI components to show real-time progress without managing polling logic.

### Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Default port 6088 | Avoids common port conflicts (8000 often used by dev servers) |
| XMLHttpRequest for file upload | Native progress event support, fetch lacks upload progress |
| SSE for streaming | Simpler than WebSocket for unidirectional server-to-client data |
| Type-only exports | Keeps bundle size small, enables tree-shaking |
| Deprecated `indexPDF()` | Unified into `indexPDFWithFile()` and `indexPDFWithPath()` for clarity |

### Trade-offs Made

1. **No Request Retry Logic** — Simpler implementation, relies on caller to retry if needed
2. **Synchronous Error Handling** — All errors thrown as `Error` objects, requires try-catch
3. **No Request Caching** — Each call hits the network, appropriate for dynamic data
4. **Tight Coupling to Backend API Structure** — Types mirror backend exactly, changes require coordination

---

## 3. Core Data Structures

### Request/Response Types (defined in `http-client.ts`)

**Base Types:**
```typescript
// File: /Users/lizhao/workspace/DeepReader/frontend/src/api/http-client.ts
// Lines: 14-18

type DocumentType = "pdf" | "epub"

interface APIResponse {
  status: string;
  message?: string;
}

interface HealthResponse {
  status: string;
  version: string;
}
```

**File Management Types:**
```typescript
// Lines: 27-67

interface FileInfo {
  file_id: string;
  file_name: string;
  file_size: number;
  file_path: string;
  uploaded_at: string;
  status: string;
  indexed: boolean;
  indexes?: string[];
}

interface FileUploadResponse {
  file_id: string;
  file_name: string;
  file_size: number;
  file_path: string;
  uploaded_at: string;
  status: string;
  indexed: boolean;
  reused?: boolean;      // File was reused (hash match)
  has_result?: boolean;  // Has pre-existing index result
  cover_url?: string;    // Book cover URL
}
```

**Configuration Types:**
```typescript
// Lines: 70-109

interface LLMConfig {
  provider: string;
  model: string;
  api_key?: string;
  base_url?: string;
}

interface IndexingConfig {
  toc_check_pages: number;
  max_pages_per_node: number;
  max_tokens_per_node: number;
  if_add_node_summary: boolean;
  if_add_node_text: boolean;
}

interface UserConfig {
  name: string;
  description?: string;
  is_default: boolean;
  llm: LLMConfig;
  indexing: IndexingConfig;
}
```

**Index/Task Types:**
```typescript
// Lines: 112-182

interface IndexPDFRequest {
  file_id?: string;
  path?: string;
  config_name?: string;
  llm_provider?: string;
  llm_model?: string;
  deepseek_api_key?: string;
  openai_api_key?: string;
  api_url?: string;
  max_pages_per_node?: number;
  max_tokens_per_node?: number;
  if_add_node_summary?: boolean;
}

interface TaskProgress {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  message: string;
  pdf_path?: string;
  created_at?: string;
  current_step?: string;
  progress_percent?: number;
  total_steps?: number;
  completed_steps?: number;
  index_id?: string;
  node_count?: number;
  pdf_name?: string;
  error?: string;
  markdown_files?: Record<string, string>;
}

interface IndexListItem {
  id: string;
  pdf_name: string;
  author?: string;
  node_count: number;
  created_at: string;
  status?: string;
  message?: string;
  progress_percent?: number;
  current_step?: string;
}
```

**Query Types:**
```typescript
// Lines: 200-241

interface QueryResultItem {
  text: string;
  metadata: {
    section?: string;
    page?: number;
    distance?: number;
    start_index?: number;
    end_index?: number;
    node_name?: string;
    node_id?: string;
    type?: 'section' | 'paragraph';
    block_id?: string;
    full_paragraph?: string;
    parent_section?: string;
    markdown_path?: string;
    prev_paragraph?: string;
    next_paragraph?: string;
  };
}

interface QueryPDFResult {
  status: string;
  query?: string;
  results: QueryResultItem[];
  index_info?: QueryIndexInfo;
  error?: string;
  search_method?: string;
  thinking?: string;
  fallback?: boolean;
  fallback_reason?: string;
}
```

**Agent Types:**
```typescript
// Lines: 305-356

interface AgentRequest {
  query: string;
  index_id: string;
  session_id?: string;
  keep_history?: boolean;
  context_docs?: ContextDoc[];
}

interface ContextDoc {
  path: string;
  name: string;
  content: string;
}

interface CitationInfo {
  node_id: string;
  obsidian_link: string;
  page?: number;
  anchor: string;
}

interface AgentResponse {
  status: string;
  answer?: string;
  error?: string;
  iterations?: number;
  citations?: CitationInfo[];
}

interface AgentStreamChunk {
  content?: string;
  status?: 'streaming' | 'done' | 'error' | 'citations_done';
  error?: string;
  citations?: CitationInfo[];
}
```

**Reading Progress Types:**
```typescript
// Lines: 243-296

interface ReadingProgress {
  index_id: string;
  read_pages: number[];
  total_pages: number;
  progress: number;
  status: string;
  last_read_at: string | null;
  chat_rounds: number;
}

interface TocSection {
  level_1: string;
  node_id?: string;
  obsidian_link?: string;
  summary?: string;
  sub_chapters: SubChapter[];
}

interface TableOfContentsFlat {
  status: string;
  book_title: string;
  toc: TocSection[];
}
```

### ServerManager Internal State

```typescript
// File: /Users/lizhao/workspace/DeepReader/frontend/src/api/server-manager.ts
// Lines: 8-14

class ServerManager {
  private process: ChildProcess | null = null;
  private readonly port: number;

  constructor(port: number = 8000) { ... }
}
```

---

## 4. State Flow

### Request Flow (Synchronous APIs)

```
UI Component
    |
    v
API Facade (e.g., fileAPI.list())
    |
    v
DeepPDFClient.listFiles()
    |
    v
DeepPDFClient.request<T>('/api/files')
    |
    +---> Log request start
    +---> fetch(url, options)
    |         |
    |         v
    |     Response.ok?
    |     /        \
    |   Yes        No
    |    |          |
    |    v          v
    |  JSON     Parse error body
    |  parse        |
    |    |          v
    |    v      Throw Error
    |  Log success
    |    |
    +----+
    |
    v
Return typed result
```

### Streaming Flow (Agent Chat)

```
UI Component
    |
    v
agentAPI.chatStream(query, indexId, onChunk, onComplete, onError, ...)
    |
    v
DeepPDFClient.agentChatStream(...)
    |
    +---> Create AbortController
    +---> fetch('/api/chat/agent/stream', { signal })
    |         |
    |         v
    |     Get ReadableStream reader
    |         |
    |         v
    |     Loop: reader.read()
    |         |
    |         v
    |     Decode chunk -> buffer
    |         |
    |         v
    |     Split by '\n', parse SSE format
    |         |
    |         v
    |     Parse JSON from 'data: {...}'
    |         |
    |    /-----+-----\
    |   |           |
    |   v           v
    | onChunk()  onComplete() / onError()
    |
    v
Return AbortController (for cancellation)
```

### Server Startup Flow

```
Application Init
    |
    v
new ServerManager(port)
    |
    v
serverManager.start(backendPath)
    |
    +---> Check if already running (this.process !== null)
    |         |
    |        Yes -> return immediately
    |         |
    v
spawn('uv', ['--directory', backendPath, 'run', 'uvicorn', ...])
    |
    +---> Attach stdout/stderr listeners
    +---> Attach 'close' listener (cleanup this.process)
    |
    v
waitForReady(timeout: 10000ms)
    |
    v
Loop: fetch('/health') every 500ms
    |
    +---> Success -> return true
    +---> Timeout -> throw Error
```

### Error Handling Paths

1. **Network Error**: `fetch()` throws -> caught in `request()` -> re-thrown with message
2. **HTTP Error (4xx/5xx)**: `response.ok === false` -> parse error body -> throw `Error(detail)`
3. **Parse Error**: JSON.parse fails -> fallback error message -> throw `Error('Request failed')`
4. **Stream Abort**: User calls `controller.abort()` -> catch `AbortError` -> log, no error thrown

### Side Effects

| Method | Side Effects |
|--------|--------------|
| `uploadFile()` | Writes file to backend storage |
| `createConfig()` | Persists configuration to backend |
| `indexPDFWithFile/Path()` | Creates background indexing task |
| `deleteFile/Index/Config/Session()` | Removes data from backend |
| `updateReadingProgress()` | Persists read pages to backend |
| `agentChat/Stream()` | May create/update chat session |
| `ServerManager.start()` | Spawns child process |
| `ServerManager.stop()` | Kills child process |

---

## 5. Common Modification Scenarios

### Scenario 1: Add a New API Endpoint

**Goal**: Add support for a new backend endpoint `/api/books/recommend`

**Steps**:
1. Define types in `http-client.ts` (around line 400):
   ```typescript
   interface BookRecommendation {
     book_id: string;
     title: string;
     relevance_score: number;
   }

   interface RecommendResponse {
     status: string;
     recommendations: BookRecommendation[];
   }
   ```

2. Add method to `DeepPDFClient` class (around line 800):
   ```typescript
   async getRecommendations(indexId: string): Promise<RecommendResponse> {
     return this.request<RecommendResponse>(`/api/books/recommend/${indexId}`);
   }
   ```

3. Add to facade in `index.ts`:
   ```typescript
   export const bookAPI = {
     getRecommendations: (indexId: string) =>
       deeppdfClient.getRecommendations(indexId)
   };
   ```

**Key files to modify**:
- `/Users/lizhao/workspace/DeepReader/frontend/src/api/http-client.ts` — Types and client method
- `/Users/lizhao/workspace/DeepReader/frontend/src/api/index.ts` — Facade export

### Scenario 2: Add Request Timeout Configuration

**Goal**: Allow configurable request timeout per-call

**Key logic location**: `DeepPDFClient.request()` method at line 450-511

**Modification approach**:
```typescript
// Add timeout parameter to request method
private async request<T>(
  endpoint: string,
  options: RequestInit = {},
  timeout?: number  // Add this
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    // ... rest of method
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
```

**File to modify**: `/Users/lizhao/workspace/DeepReader/frontend/src/api/http-client.ts`

### Scenario 3: Add Batch File Upload

**Goal**: Support uploading multiple files at once

**Key logic location**: `uploadFile()` method at line 536-574

**Modification approach**:
```typescript
async uploadFiles(
  files: File[],
  onProgress?: (fileIndex: number, progress: number) => void
): Promise<FileUploadResponse[]> {
  return Promise.all(
    files.map((file, index) =>
      this.uploadFile(file, onProgress ? (p) => onProgress(index, p) : undefined)
    )
  );
}
```

**File to modify**: `/Users/lizhao/workspace/DeepReader/frontend/src/api/http-client.ts`

### Scenario 4: Change Default Server Port

**Goal**: Change default port from 6088 to 8080

**Key location**: Line 442 in `http-client.ts`

```typescript
private readonly DEFAULT_PORT = 8080;  // Change from 6088
```

**File to modify**: `/Users/lizhao/workspace/DeepReader/frontend/src/api/http-client.ts`

### Scenario 5: Add Request/Response Interceptor

**Goal**: Add authentication header to all requests

**Key location**: `request()` method, around line 460

```typescript
private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  // Add auth header
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${this.authToken}`,  // Add this
  };

  const response = await fetch(url, { ...options, headers });
  // ...
}
```

You would also need to add `authToken` property to the class and a setter method.

**File to modify**: `/Users/lizhao/workspace/DeepReader/frontend/src/api/http-client.ts`

### Scenario 6: Add WebSocket Support for Real-Time Updates

**Goal**: Replace polling with WebSocket for task progress

**New file needed**: `websocket-client.ts` in the same directory

**Integration point**: `pollTaskStatus()` method (line 900-922) could be replaced with WebSocket subscription

**Current polling logic**:
```typescript
async pollTaskStatus(taskId, onProgress, interval = 2000) {
  while (true) {
    const progress = await this.getTaskProgress(taskId);
    if (onProgress) onProgress(progress);
    if (progress.status === 'completed') return progress;
    if (progress.status === 'failed' || progress.status === 'cancelled') {
      throw new Error(progress.error || progress.message);
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}
```

---

## Quick Reference

### File Paths

| File | Purpose |
|------|---------|
| `/Users/lizhao/workspace/DeepReader/frontend/src/api/http-client.ts` | Core HTTP client class, all types |
| `/Users/lizhao/workspace/DeepReader/frontend/src/api/server-manager.ts` | Backend process management |
| `/Users/lizhao/workspace/DeepReader/frontend/src/api/index.ts` | Public API exports and facades |
| `/Users/lizhao/workspace/DeepReader/frontend/src/api/__tests__/http-client.test.ts` | HTTP client unit tests |
| `/Users/lizhao/workspace/DeepReader/frontend/src/api/__tests__/server-manager.test.ts` | Server manager unit tests |

### Dependencies

| Dependency | Usage |
|------------|-------|
| `../utils/logger.js` | `apiLog` for API call logging, `error` for error logging |
| `../agent/debug/index.js` | `getDebugLogger()` for detailed request/response tracing |
| `child_process` | `spawn()` for launching backend server |

### Backend API Endpoints (as called by this module)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/api/files` | GET/POST | List/upload files |
| `/api/files/:id` | GET/DELETE | Get/delete file |
| `/api/config` | GET/POST | List/create configs |
| `/api/config/default` | GET | Get default config |
| `/api/config/:name` | PUT/DELETE | Update/delete config |
| `/api/config/:name/set-default` | PATCH | Set default config |
| `/api/index` | POST | Create index |
| `/api/indexes` | GET | List indexes |
| `/api/indexes/:id` | GET/DELETE | Get/delete index |
| `/api/tasks/:id` | DELETE | Cancel task |
| `/api/tasks/:id/progress` | GET | Get task progress |
| `/api/query` | POST | Semantic search |
| `/api/chat/agent` | POST | Sync agent chat |
| `/api/chat/agent/stream` | POST | Stream agent chat |
| `/api/chat/sessions/:indexId` | GET | List sessions |
| `/api/chat/sessions/:indexId/:sessionId` | DELETE | Delete session |
| `/api/chat/history/:indexId/:sessionId` | GET | Get chat history |
| `/api/reading/:indexId/progress` | GET/POST | Reading progress |
| `/api/reading/:indexId/toc` | GET | Table of contents |
| `/api/reading/:indexId/toc/flat` | GET | Flat TOC |
| `/api/reading/:indexId/summary` | GET | Book summary |
| `/api/export/:indexId` | GET | Export index |
| `/api/export/:indexId/cover` | GET | Export cover |
| `/api/markdown-mapping/:indexId` | POST | Save markdown mapping |
| `/api/epub-images/:indexId` | GET | List EPUB images |
| `/api/epub-images/:indexId/:name` | GET | Get EPUB image |
| `/api/translate` | POST | Translate text |
| `/api/summary/generate` | POST | Generate structured summary |
| `/api/summary/:indexId` | GET | Get structured summary |
