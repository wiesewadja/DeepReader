# Markdown 导出 API 设计

## 概述

为 DeepPDF 后端实现 Markdown 导出接口，允许前端获取索引节点数据，用于在 Obsidian vault 中本地生成 Markdown 文件。

## 架构

```
┌─────────────┐                    ┌─────────────┐
│  前端插件   │                    │   后端 API   │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │  GET /export/{index_id}         │
       │  ──────────────────────────────>│
       │                                  │
       │  返回节点数据 + 元信息             │
       │  <─────────────────────────────│
       │                                  │
       │  前端生成 Markdown 并写入 vault    │
```

**核心原则**：
- 后端只负责数据导出，不涉及文件操作
- 支持部分导出（处理中状态）
- 保持节点结构完整性
- 所有索引默认包含文本内容（`if_add_node_text=yes`）

## 数据模型

```python
class ExportNodeData(BaseModel):
    """单个节点的导出数据"""
    node_id: str
    node_name: str
    section: str              # 章节路径 "1.1.1 小节"
    page_range: str           # "1-5"
    start_index: int
    end_index: int
    level: int                # 层级 1,2,3...
    text: str                 # 原始文本（含 <physical_index_N> 标记）
    parent_id: str | None     # 父节点 ID（用于生成层级目录）


class ExportIndexResponse(BaseModel):
    """导出索引响应"""
    status: str               # "ready" | "processing" | "failed"
    index_id: str
    pdf_name: str
    total_pages: int          # PDF 总页数（用于进度显示）
    created_at: str           # ISO 8601 格式（用于文件命名）
    nodes: List[ExportNodeData]
```

## 核心实现逻辑

```python
async def export_index_data(index_id: str):
    """导出索引的节点数据"""

    # 1. 读取索引元数据
    metadata_path = storage_dir / "indexes" / f"{index_id}.json"
    metadata = json.load(metadata_path)

    # 2. 提取并转换节点数据
    nodes = []
    for section in metadata["sections"]:
        node_data = {
            "node_id": section["id"],
            "node_name": section["metadata"].get("node_name", ""),
            "section": section["metadata"]["section"],
            "page_range": f"{start_index}-{end_index}",
            "start_index": start_index,
            "end_index": end_index,
            "level": section["metadata"]["level"],
            "text": section["text"],
            "parent_id": _find_parent_id(section, metadata["tree_structure"])
        }
        nodes.append(node_data)

    # 3. 构建响应
    return {
        "status": "ready",
        "index_id": index_id,
        "pdf_name": metadata["pdf_name"],
        "total_pages": _count_pdf_pages(metadata),
        "created_at": metadata["created_at"],
        "nodes": nodes
    }
```

## 错误处理

| 错误场景 | 处理方式 |
|----------|----------|
| 索引不存在 | 404 Not Found |
| JSON 损坏 | 500 Internal Server Error |
| sections 为空 | 返回空数组，status="ready" |
| 节点缺少字段 | 使用默认值（空字符串、0等） |
| PDF 文件丢失 | total_pages = 0（降级处理） |

## 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `export_models.py` | 添加 `parent_id`, `total_pages`, `created_at` 字段 |
| `export_handlers.py` | 实现新逻辑：parent_id 查找、total_pages 计算 |
| `export_utils.py` | 新建：辅助函数（find_parent_id, get_pdf_page_count） |

## 数据来源

数据来自 `{base_dir}/indexes/{index_id}.json`：

```json
{
  "id": "abc123",
  "pdf_name": "sample.pdf",
  "created_at": "2026-01-21 10:00:00",
  "sections": [
    {
      "id": "node_1",
      "text": "<physical_index_1>内容...",
      "metadata": {
        "section": "1 Introduction",
        "start_index": 1,
        "end_index": 3,
        "level": 1
      }
    }
  ]
}
```

## 测试方案

1. **完整流程测试**：创建索引 → 导出 → 验证字段
2. **边界测试**：空 sections、缺失 PDF、损坏的 JSON
3. **前端集成测试**：验证生成的 Markdown 可用
