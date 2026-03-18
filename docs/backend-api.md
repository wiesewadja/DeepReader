# DeepReader 后端 API 文档

> 更新时间: 2026-03-18
> 基础 URL: `http://localhost:6088`

---

## 目录

- [健康检查](#健康检查)
- [索引管理 API (/api)](#索引管理-api-api)
- [阅读进度 API (/api/reading)](#阅读进度-api-apireading)
- [配置管理 API (/api/config)](#配置管理-api-apiconfig)
- [文件管理 API (/api/files)](#文件管理-api-apifiles)
- [EPUB 图片 API (/api/epub-images)](#epub-图片-api-apiepub-images)

---

## 健康检查

### GET /health

健康检查端点

**响应:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

---

## 索引管理 API (/api)

### POST /api/index

创建 PDF/EPUB 索引

**请求体:**
```json
{
  "file_id": "string",
  "pdf_index_toc_check_pages": 20,
  "pdf_index_max_pages_per_node": 10,
  "pdf_index_max_tokens_per_node": 20000,
  "pdf_index_if_add_node_summary": true,
  "force_rebuild": false
}
```

**响应:**
```json
{
  "status": "success|error",
  "task_id": "string",
  "message": "string"
}
```

---

### POST /api/query

搜索文档内容

**请求体:**
```json
{
  "query": "string",
  "index_id": "string",
  "top_k": 5,
  "use_llm_tree_search": false
}
```

**响应:**
```json
{
  "status": "success",
  "results": [
    {
      "text": "string",
      "metadata": {
        "type": "section|paragraph",
        "node_id": "string",
        "block_id": "string",
        "page": 1,
        "section": "string"
      }
    }
  ]
}
```

---

### GET /api/indexes

列出所有索引

**响应:**
```json
{
  "status": "success",
  "indexes": [
    {
      "id": "string",
      "pdf_name": "string",
      "author": "string",
      "node_count": 100,
      "created_at": "2024-01-01 12:00:00",
      "status": "completed|building|error",
      "message": null
    }
  ]
}
```

---

### GET /api/indexes/{index_id}

获取索引详情

**响应:**
```json
{
  "status": "success",
  "index": {
    "id": "string",
    "pdf_name": "string",
    "author": "string",
    "total_pages": 300,
    "node_count": 100,
    "created_at": "string",
    "status": "completed"
  }
}
```

---

### GET /api/tasks/{task_id}/progress

获取任务进度

**响应:**
```json
{
  "status": "success",
  "task_id": "string",
  "state": "PENDING|STARTED|SUCCESS|FAILURE",
  "progress": 50,
  "message": "正在处理..."
}
```

---

### GET /api/tasks

列出所有任务

---

### DELETE /api/indexes/{index_id}

删除索引

**响应:**
```json
{
  "status": "success",
  "message": "索引已删除"
}
```

---

### DELETE /api/tasks/{task_id}

取消任务

---

### GET /api/export/{index_id}

导出索引数据（Markdown 格式）

**响应:**
```json
{
  "status": "success",
  "index_id": "string",
  "pdf_name": "string",
  "total_pages": 300,
  "created_at": "string",
  "nodes": [
    {
      "node_id": "string",
      "node_name": "string",
      "section": "string",
      "page_range": "1-10",
      "text": "string",
      "summary": "string"
    }
  ]
}
```

---

### GET /api/export/{index_id}/cover

获取书籍封面

**响应:**
```json
{
  "status": "success",
  "index_id": "string",
  "pdf_name": "string",
  "cover_data": "base64...",
  "mime_type": "image/png",
  "has_custom_cover": true
}
```

---

### POST /api/markdown-mapping/{index_id}

保存 Markdown 文件映射

**请求体:**
```json
{
  "mapping": {
    "node_id": "path/to/file.md"
  }
}
```

---

### GET /api/chat/history/{index_id}/{session_id}

获取聊天历史

---

### GET /api/chat/sessions/{index_id}

列出聊天会话

---

### DELETE /api/chat/sessions/{index_id}/{session_id}

删除聊天会话

---

### POST /api/cross-book/search

跨书搜索

**请求体:**
```json
{
  "query": "string",
  "index_ids": ["id1", "id2"],
  "top_k": 5
}
```

---

### POST /api/theme/report

主题报告生成

**请求体:**
```json
{
  "index_id": "string",
  "theme": "string",
  "depth": "brief|normal|deep"
}
```

---

### POST /api/theme/report/enhanced

增强主题报告生成

---

### POST /api/agent/query

Agent 查询（LLM Tree Search）

**请求体:**
```json
{
  "query": "string",
  "index_id": "string",
  "mode": "auto|fast|section|slow"
}
```

---

## 阅读进度 API (/api/reading)

### GET /api/reading/{index_id}/toc

获取书籍章节目录

**响应:**
```json
{
  "index_id": "string",
  "book_name": "string",
  "total_pages": 300,
  "chapters": [
    {
      "title": "string",
      "start_page": 1,
      "end_page": 10,
      "level": 0,
      "summary": "string",
      "obsidian_link": "string"
    }
  ]
}
```

---

### GET /api/reading/{index_id}/toc/flat

获取扁平化章节目录（2 级结构）

**响应:**
```json
{
  "status": "success",
  "book_title": "string",
  "toc": [
    {
      "level_1": "第一部分：...",
      "node_id": "string",
      "obsidian_link": "书籍名/01-章节.md",
      "summary": "string",
      "sub_chapters": [
        {
          "title": "第1章：...",
          "node_id": "string",
          "obsidian_link": "书籍名/01-第1章：....md"
        }
      ]
    }
  ]
}
```

---

### GET /api/reading/{index_id}/summary

获取书籍摘要

**响应:**
```json
{
  "index_id": "string",
  "book_name": "string",
  "summary": "string"
}
```

---

## 配置管理 API (/api/config)

### GET /api/config

获取所有配置

---

### GET /api/config/default

获取默认配置

---

### POST /api/config

创建配置

**请求体:**
```json
{
  "name": "string",
  "value": "string"
}
```

---

### PUT /api/config/{name}

更新配置

---

### DELETE /api/config/{name}

删除配置

---

## 文件管理 API (/api/files)

### POST /api/files

上传文件

**请求体:** multipart/form-data

---

### GET /api/files

列出文件

---

### GET /api/files/{file_id}

获取文件详情

---

### GET /api/files/{file_id}/cover

获取文件封面

---

### DELETE /api/files/{file_id}

删除文件

---

## EPUB 图片 API (/api/epub-images)

### GET /api/epub-images/{index_id}/{image_name}

获取 EPUB 图片

---

## 错误响应

所有 API 错误返回以下格式:

```json
{
  "detail": "错误描述"
}
```

或

```json
{
  "status": "error",
  "error": "错误描述"
}
```