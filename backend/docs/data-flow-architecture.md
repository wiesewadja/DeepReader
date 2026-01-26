# DeepPDF 数据流架构

## 概述

本文档描述 DeepPDF 从 PDF 解析到 Markdown 导出的完整数据流，包括各阶段的数据结构和字段定义。

## 架构原则

1. **分离关注点**：原文与摘要分离，各自服务于不同场景
2. **向量化优化**：使用摘要进行语义向量化，获得更好的检索效果
3. **导出保真**：Markdown 导出使用原文，保持 PDF 原始内容

---

## 数据流

```
┌─────────────┐
│   PDF 文件   │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────┐
│  阶段 1: PageIndex 解析      │
│  - PDF 文本提取              │
│  - 目录结构识别              │
│  - LLM 摘要生成              │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  阶段 2: Indexer 提取节点    │
│  - 构建节点数据结构          │
│  - 组装向量化文本            │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  阶段 3: ChromaDB 存储       │
│  - 向量化嵌入                │
│  - 语义索引                  │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  阶段 4: 元数据持久化        │
│  - JSON 文件存储             │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  阶段 5: Export API 导出     │
│  - 读取元数据                │
│  - 返回原文数据              │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  阶段 6: Markdown 生成       │
│  - 前端生成 Markdown 文件    │
└─────────────────────────────┘
```

---

## 各阶段数据结构

### 阶段 1: PageIndex 解析

**文件**: `pageindex_lib/src/pageindex/page_index.py`

**输出结构** (`tree_result`):
```python
{
    "structure": [
        {
            "title": "Preface",
            "node_id": "0000",
            "start_index": 1,
            "end_index": 26,
            "text": "PDF 原始文本内容...",          # 原文
            "summary": "LLM 生成的摘要内容...",     # 摘要
            "nodes": [...]
        }
    ]
}
```

**关键修改**: 生成摘要后，**不再移除** `text` 字段（原文和摘要同时保留）

---

### 阶段 2: Indexer 提取节点

**文件**: `deeppdf-api/src/deeppdf/services/indexer.py:38-95`

**函数**: `_extract_nodes_from_tree()`

**输出结构** (`section_nodes`):
```python
[
    {
        "id": "0000",
        "text": "【Preface】\nLLM 生成的摘要内容...",  # 用于向量化
        "metadata": {
            "section": "Preface",
            "level": 0,
            "page": 1,
            "start_index": 1,
            "end_index": 26,
            "node_name": "Preface",
            "node_id": "0000",
            "summary": "LLM 生成的摘要...",           # 摘要
            "original_text": "PDF 原始文本内容..."    # 原文
        }
    }
]
```

---

### 阶段 3: ChromaDB 存储

**文件**: `deeppdf-api/src/deeppdf/services/indexer.py:286-367`

**存储内容**:
```python
documents = [
    {
        "id": node["id"],
        "text": node["text"],  # "【Preface】\n摘要..."
        "metadata": {
            **node["metadata"],
            "pdf_name": pdf_name
        }
    }
]
```

**向量嵌入**: 基于 `text` 字段（摘要+章节标题）进行向量化

---

### 阶段 4: 元数据持久化

**文件**: `deeppdf-api/src/deeppdf/services/indexer.py:370-420`

**保存路径**: `storage/indexes/{index_id}.json`

**结构**:
```json
{
  "id": "idx_cbfce581e930",
  "pdf_name": "纳瓦尔宝典.pdf",
  "pdf_path": "/path/to/纳瓦尔宝典.pdf",
  "created_at": "2026-01-21 12:00:00",
  "node_count": 95,
  "indexing_method": "pageindex_tree",
  "llm_enabled": true,
  "tree_structure": {...},
  "sections": [
    {
      "id": "0000",
      "text": "【Preface】\n摘要...",        # 向量化用的摘要
      "metadata": {
        "section": "Preface",
        "level": 0,
        "node_name": "Preface",
        "node_id": "0000",
        "start_index": 1,
        "end_index": 26,
        "summary": "LLM 生成的摘要...",
        "original_text": "PDF 原始文本..."
      }
    }
  ]
}
```

---

### 阶段 5: Export API 导出

**文件**: `deeppdf-api/src/deeppdf/api/export_handlers.py:48-72`

**端点**: `GET /api/export/{index_id}`

**逻辑**:
```python
# 返回原文，而非用于向量化的摘要
original_text = node_metadata.get("original_text", section.get("text", ""))
```

**返回结构**:
```json
{
  "status": "success",
  "index_id": "idx_cbfce581e930",
  "pdf_name": "纳瓦尔宝典.pdf",
  "total_pages": 26,
  "created_at": "2026-01-21T12:00:00Z",
  "nodes": [
    {
      "node_id": "0000",
      "node_name": "Preface",
      "section": "Preface",
      "page_range": "1-26",
      "start_index": 1,
      "end_index": 26,
      "level": 0,
      "parent_id": null,
      "text": "PDF 原始文本内容..."  # 来自 metadata["original_text"]
    }
  ]
}
```

---

### 阶段 6: Markdown 生成

**文件**: `deeppdf-api/src/deeppdf/services/markdown_exporter.py`

**函数**: `create_markdown_content()`

**输入**: 导出的节点数据

**输出**: Markdown 文件内容
```markdown
---
pdf_name: 纳瓦尔宝典.pdf
node_id: 0000
section: Preface
page_range: 1-26
level: 0
tags: [DeepPDF, 纳瓦尔宝典.pdf]
---

# Preface

### 第 1 页 ^page-1

PDF 原始文本内容...

---
**来源**: [[纳瓦尔宝典.pdf#page=1]] (第 1-26 页)
```

---

## 字段定义对照表

| 位置 | 字段 | 类型 | 内容 | 用途 |
|------|------|------|------|------|
| PageIndex tree | `text` | string | 原文 | 中间数据 |
| PageIndex tree | `summary` | string | 摘要 | 中间数据 |
| section_nodes | `text` | string | `【章节】\n摘要` | ChromaDB 向量化 |
| section_nodes | `metadata.summary` | string | 摘要 | 存档/备用 |
| section_nodes | `metadata.original_text` | string | 原文 | Markdown 导出 |
| JSON sections | `text` | string | `【章节】\n摘要` | 存档 |
| JSON sections | `metadata.summary` | string | 摘要 | 存档 |
| JSON sections | `metadata.original_text` | string | 原文 | 导出使用 |
| Export API | `nodes[i].text` | string | 原文 | 返回前端 |

---

## 架构决策记录

### 决策 1: 向量化使用摘要而非原文

**背景**: 需要决定向量嵌入使用什么内容

**选择**: 使用摘要（`【章节】\n{summary}`）进行向量化

**理由**:
- 摘要是经过 LLM 提炼的核心内容，语义更聚焦
- 减少无关信息对向量检索的干扰
- 提高检索准确度

**权衡**: 丧失了原文的细粒度语义信息，但通过导出原文保持内容完整性

---

### 决策 2: 原文与摘要同时保存

**背景**: 需要决定是否保留原文

**选择**: 同时保存 `summary` 和 `original_text`

**理由**:
- 导出 Markdown 需要原文，不能只有摘要
- 摘要可能丢失重要细节
- 用户可能需要引用原文

**实现**: 修改 PageIndex 不再移除 `text` 字段

---

### 决策 3: 后端导出数据，前端生成文件

**背景**: 需要决定 Markdown 文件由谁生成

**选择**: 后端提供 JSON 数据，前端生成文件

**理由**:
- 后端不应直接写入用户文件系统（安全原则）
- Obsidian 插件可以更好地集成到用户 vault
- 前端可以灵活控制文件位置和命名

**相关文件**:
- 后端: `export_handlers.py`
- 前端: Obsidian Plugin

---

## 相关文件

| 文件 | 作用 |
|------|------|
| `pageindex_lib/src/pageindex/page_index.py` | PDF 解析，生成树结构 |
| `deeppdf-api/src/deeppdf/services/indexer.py` | 节点提取，存储到 ChromaDB |
| `deeppdf-api/src/deeppdf/services/markdown_exporter.py` | Markdown 内容生成 |
| `deeppdf-api/src/deeppdf/api/export_handlers.py` | 导出 API 处理逻辑 |
| `deeppdf-api/src/deeppdf/api/export_utils.py` | 导出工具函数 |
| `deeppdf-api/src/deeppdf/api/routes.py` | API 路由定义 |

---

## 版本历史

| 日期 | 变更 |
|------|------|
| 2026-01-21 | 初始版本，定义数据流架构 |
| 2026-01-21 | 字段重命名：`text` → `original_text`，新增 `summary` |
