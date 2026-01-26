# DeepPDF 后端 API 参考文档

> **版本**: v1.0
> **最后更新**: 2026-01-22
> **基础路径**: `/api`

---

## 目录

1. [概述](#概述)
2. [通用规范](#通用规范)
3. [索引管理](#索引管理)
4. [查询接口](#查询接口)
5. [任务管理](#任务管理)
6. [导出功能](#导出功能)
7. [Agent 智能体](#agent-智能体)
8. [错误码](#错误码)

---

## 概述

DeepPDF API 提供完整的 PDF 智能索引与检索服务，支持：

- **后台索引任务**：异步创建 PDF 向量索引
- **混合检索**：结合语义搜索和关键词匹配
- **Agent 智能体**：基于 ReAct 模式的智能问答
- **进度跟踪**：实时监控索引和任务进度
- **流式响应**：支持 SSE 流式输出

---

## 通用规范

### 请求格式

- **Content-Type**: `application/json`
- **字符编码**: `UTF-8`

### 响应格式

所有响应遵循统一格式：

```json
{
  "status": "success | error | pending",
  "data": { ... },
  "error": "错误信息（仅 error 状态）"
}
```

### 速率限制

| 端点 | 限制 | 窗口 |
|------|------|------|
| POST /api/index | 20 次 | 10 分钟 |

超出限制时返回 `429 Too Many Requests`：

```json
{
  "error": "Rate limit exceeded",
  "message": "索引创建过于频繁，请在 X 秒后重试",
  "limit": 20,
  "window": 600,
  "reset_after": 120
}
```

---

## 索引管理

### 1. 创建索引

**端点**: `POST /api/index`

**描述**: 创建 PDF 索引（后台异步任务），立即返回任务 ID

**请求参数**:

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| file_id | string | 条件必填* | 已上传文件的 ID（通过 /api/files 上传获取） |
| path | string | 条件必填* | PDF 文件绝对路径 |
| config_name | string | 否 | 使用已保存的配置名称（优先级最高） |
| llm_provider | string | 否 | LLM provider (deepseek/openai/google/custom/anthropic) |
| llm_model | string | 否 | LLM model name |
| deepseek_api_key | string | 否 | DeepSeek API key |
| openai_api_key | string | 否 | OpenAI/SiliconFlow API key |
| api_url | string | 否 | Custom API base URL |
| max_pages_per_node | int | 否 | Max pages per section node |
| max_tokens_per_node | int | 否 | Max tokens per section node |
| if_add_node_summary | bool | 否 | Add node summary using LLM |

*注：file_id 和 path 二选一

**请求示例**:

```bash
curl -X POST "http://localhost:8000/api/index" \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/path/to/document.pdf",
    "llm_provider": "deepseek",
    "llm_model": "deepseek-chat",
    "deepseek_api_key": "sk-xxx",
    "max_pages_per_node": 5
  }'
```

**响应示例**:

```json
{
  "status": "pending",
  "index_id": "task_a1b2c3d4e5f6",
  "message": "索引任务已创建，使用 GET /api/indexes/task_a1b2c3d4e5f6 查询进度"
}
```

**状态说明**:

| 状态 | 描述 |
|------|------|
| pending | 任务已创建，等待执行 |
| processing | 正在索引 |
| completed | 索引完成 |
| failed | 索引失败 |
| cancelled | 任务已取消 |

---

### 2. 列出所有索引

**端点**: `GET /api/indexes`

**描述**: 列出所有索引（包括正在进行的任务）

**响应示例**:

```json
{
  "status": "success",
  "indexes": [
    {
      "id": "idx_a1b2c3d4",
      "pdf_name": "document.pdf",
      "node_count": 42,
      "created_at": "2026-01-22 10:30:00",
      "status": "completed"
    },
    {
      "id": "task_e5f6g7h8",
      "pdf_name": "another.pdf",
      "node_count": 0,
      "created_at": "2026-01-22 11:00:00",
      "status": "processing",
      "message": "正在索引 PDF...",
      "progress_percent": 45
    }
  ]
}
```

---

### 3. 获取索引状态

**端点**: `GET /api/indexes/{index_id}`

**描述**: 查询索引或任务状态

**路径参数**:

| 参数 | 类型 | 描述 |
|------|------|------|
| index_id | string | 索引 ID (idx_*) 或任务 ID (task_*) |

**响应示例（已完成索引）**:

```json
{
  "id": "idx_a1b2c3d4",
  "pdf_name": "document.pdf",
  "node_count": 42,
  "created_at": "2026-01-22 10:30:00",
  "status": "completed"
}
```

**响应示例（进行中任务）**:

```json
{
  "id": "task_e5f6g7h8",
  "status": "processing",
  "pdf_path": "/path/to/document.pdf",
  "created_at": "2026-01-22 11:00:00",
  "message": "正在索引 PDF...",
  "current_step": "chunking",
  "progress_percent": 45,
  "total_steps": 5,
  "completed_steps": 2
}
```

**响应示例（失败任务）**:

```json
{
  "id": "task_failed",
  "status": "failed",
  "error": "PDF 文件损坏或格式不支持"
}
```

---

### 4. 删除索引

**端点**: `DELETE /api/indexes/{index_id}`

**描述**: 删除索引或取消任务

**路径参数**:

| 参数 | 类型 | 描述 |
|------|------|------|
| index_id | string | 索引 ID 或任务 ID |

**响应示例（删除索引）**:

```json
{
  "status": "success",
  "message": "索引 idx_a1b2c3d4 已成功删除（包括向量数据和元数据）"
}
```

**响应示例（取消任务）**:

```json
{
  "status": "success",
  "message": "任务 task_e5f6g7h8 已取消"
}
```

---

## 查询接口

### 5. 查询 PDF 内容

**端点**: `POST /api/query`

**描述**: 使用混合检索查询 PDF 内容

**请求参数**:

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| query | string | 是 | 查询文本 |
| index_id | string | 是 | 索引 ID |
| max_results | int | 否 | 最大结果数（默认 10） |

**请求示例**:

```bash
curl -X POST "http://localhost:8000/api/query" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "乔布斯什么时候发布的 iPhone？",
    "index_id": "idx_a1b2c3d4",
    "max_results": 5
  }'
```

**响应示例**:

```json
{
  "status": "success",
  "results": [
    {
      "text": "2007年1月9日，史蒂夫·乔布斯在Macworld大会上发布了第一代iPhone...",
      "metadata": {
        "file_name": "jobs_biography.pdf",
        "page_label": "245",
        "node_id": "node_42",
        "section_title": "iPhone 发布",
        "score": 0.89
      }
    }
  ],
  "index_info": {
    "index_id": "idx_a1b2c3d4",
    "pdf_name": "jobs_biography.pdf",
    "node_count": 42
  },
  "search_method": "hybrid_search"
}
```

---

## 任务管理

### 6. 获取任务进度

**端点**: `GET /api/tasks/{task_id}/progress`

**描述**: 获取任务的详细进度信息

**路径参数**:

| 参数 | 类型 | 描述 |
|------|------|------|
| task_id | string | 任务 ID (task_*) |

**响应示例**:

```json
{
  "id": "task_a1b2c3d4",
  "status": "processing",
  "message": "正在索引 PDF...",
  "pdf_path": "/path/to/document.pdf",
  "created_at": "2026-01-22 11:00:00",
  "current_step": "embedding",
  "progress_percent": 60,
  "total_steps": 5,
  "completed_steps": 3
}
```

**进度步骤**:

| 步骤 | 描述 |
|------|------|
| start | 开始处理 |
| parsing | 解析 PDF |
| chunking | 分块处理 |
| embedding | 生成向量 |
| indexing | 构建索引 |

---

### 7. 取消任务

**端点**: `DELETE /api/tasks/{task_id}`

**描述**: 专门用于取消任务的接口

**路径参数**:

| 参数 | 类型 | 描述 |
|------|------|------|
| task_id | string | 任务 ID |

**响应示例**:

```json
{
  "status": "success",
  "message": "任务 task_a1b2c3d4 已取消",
  "task_id": "task_a1b2c3d4",
  "current_status": "cancelled"
}
```

---

## 导出功能

### 8. 导出索引数据

**端点**: `GET /api/export/{index_id}`

**描述**: 导出索引的节点数据，供前端生成 Markdown 文件

**路径参数**:

| 参数 | 类型 | 描述 |
|------|------|------|
| index_id | string | 索引 ID |

**响应示例**:

```json
{
  "status": "success",
  "index_id": "idx_a1b2c3d4",
  "nodes": [
    {
      "node_id": "node_1",
      "text": "这是第一章的内容...",
      "metadata": {
        "page_range": "1-10",
        "section_title": "第一章",
        "file_name": "document.pdf"
      }
    }
  ],
  "total_pages": 500,
  "node_count": 42
}
```

---

### 9. 保存 Markdown 映射

**端点**: `POST /api/markdown-mapping/{index_id}`

**描述**: 保存 Markdown 文件映射到索引元数据

**路径参数**:

| 参数 | 类型 | 描述 |
|------|------|------|
| index_id | string | 索引 ID |

**请求体**:

```json
{
  "file_mapping": {
    "node_1": "/output/doc.md#第一章",
    "node_2": "/output/doc.md#第二章"
  }
}
```

**响应示例**:

```json
{
  "status": "success",
  "index_id": "idx_a1b2c3d4"
}
```

---

## Agent 智能体

### 10. Agent 对话（同步）

**端点**: `POST /api/chat/agent`

**描述**: 使用 ReAct 模式的 Agent 进行智能问答

**请求参数**:

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| query | string | 是 | 用户查询（1-2000 字符） |
| index_id | string | 是 | 索引 ID（1-100 字符） |

**请求示例**:

```bash
curl -X POST "http://localhost:8000/api/chat/agent" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "分析乔布斯管理风格的演变",
    "index_id": "idx_a1b2c3d4"
  }'
```

**响应示例**:

```json
{
  "status": "success",
  "answer": "<thought>\n1. 这是一个复杂分析任务\n2. 先查看目录结构\n</thought>\n\n根据目录，相关章节有...\n\n[[童年#^page-15]] 乔布斯早期经历...\n\n[[管理哲学#^page-120]] 他的管理风格...",
  "iterations": 3
}
```

**Agent 能力**:

| 工具 | 描述 | 使用场景 |
|------|------|----------|
| inspect_toc | 查看目录结构 | 复杂分析、跨章节问题 |
| read_page | 按页读取内容 | 深度阅读、细节验证 |
| hybrid_search | 混合检索 | 简单事实查询 |

---

### 11. Agent 对话（流式）

**端点**: `POST /api/chat/agent/stream`

**描述**: Agent 流式响应（Server-Sent Events）

**请求参数**: 同同步端点

**响应格式** (SSE):

```
data: {"content": "<thought>", "status": "streaming"}

data: {"content": "正在查看目录...", "status": "streaming"}

data: {"content": "根据分析...", "status": "streaming"}

data: {"status": "done"}
```

**错误响应**:

```
data: {"status": "error", "error": "索引不存在"}
```

**客户端示例**:

```javascript
const response = await fetch('/api/chat/agent/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: '分析乔布斯管理风格',
    index_id: 'idx_a1b2c3d4'
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  const lines = chunk.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      if (data.status === 'done') break;
      if (data.content) console.log(data.content);
    }
  }
}
```

---

## 错误码

### HTTP 状态码

| 状态码 | 描述 |
|--------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 404 | 资源不存在 |
| 429 | 速率限制超出 |
| 500 | 服务器内部错误 |

### 错误响应格式

```json
{
  "status": "error",
  "error": "错误详细信息"
}
```

### 常见错误

| 错误信息 | 原因 | 解决方案 |
|----------|------|----------|
| "Either 'file_id' or 'path' must be provided" | 缺少文件参数 | 提供 file_id 或 path |
| "File 'xxx' not found" | 文件不存在 | 检查文件路径 |
| "PDF file not found" | PDF 文件不存在 | 确认 PDF 路径正确 |
| "Configuration 'xxx' not found" | 配置不存在 | 检查配置名称 |
| "索引 xxx 不存在" | 索引不存在 | 确认索引 ID 正确 |
| "Path traversal detected" | 路径遍历攻击 | 不要使用 ".." 在路径中 |
| "Rate limit exceeded" | 超出速率限制 | 等待后重试 |

---

## 附录

### A. 请求/响应模型定义

#### IndexRequest

```python
class IndexRequest(BaseModel):
    file_id: Optional[str]           # 已上传文件的 ID
    path: Optional[str]               # PDF 文件路径
    config_name: Optional[str]        # 配置名称
    llm_provider: Optional[str]       # LLM provider
    llm_model: Optional[str]          # LLM model
    deepseek_api_key: Optional[str]   # DeepSeek API key
    openai_api_key: Optional[str]     # OpenAI API key
    api_url: Optional[str]            # Custom API URL
    max_pages_per_node: Optional[int] # Max pages per node
    max_tokens_per_node: Optional[int] # Max tokens per node
    if_add_node_summary: Optional[bool] # Add node summary
```

#### QueryRequest

```python
class QueryRequest(BaseModel):
    query: str              # 查询文本
    index_id: str           # 索引 ID
    max_results: int = 10   # 最大结果数
```

#### AgentRequest

```python
class AgentRequest(BaseModel):
    query: str                    # 用户查询 (1-2000 字符)
    index_id: str                 # 索引 ID (1-100 字符)
    stream: bool = False          # 是否流式输出
```

---

### B. 状态值说明

#### 任务/索引状态

| 状态 | 描述 |
|------|------|
| pending | 等待执行 |
| processing | 正在执行 |
| completed | 执行完成 |
| failed | 执行失败 |
| cancelled | 已取消 |

#### API 响应状态

| 状态 | 描述 |
|------|------|
| success | 操作成功 |
| error | 操作失败 |
| pending | 异步任务已创建 |

---

### C. 分页与筛选

当前版本不支持分页，所有结果一次性返回。

建议：
- 使用 `max_results` 参数限制查询结果数量
- 对于大量索引，使用前端筛选功能

---

### D. WebSocket 支持（计划中）

未来版本将支持 WebSocket 实时推送任务进度和 Agent 响应。

---

## 更新日志

| 版本 | 日期 | 更新内容 |
|------|------|----------|
| v1.0 | 2026-01-22 | 初始版本，包含索引、查询、Agent 等核心功能 |
