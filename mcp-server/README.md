# DeepPDF MCP Server

MCP 服务器，提供 PDF 索引和查询功能。

## 功能

- PDF 文档解析和索引
- 语义搜索
- 向量存储（ChromaDB）
- PageIndex 集成

## 安装

```bash
cd mcp-server
uv sync
```

## 使用

### 作为独立服务器

```bash
uv run python -m deeppdf.server
```

### 环境变量

见 `.env.example` 文件。

## API

### 工具

- `index_pdf`: 索引 PDF 文档
- `query_pdf`: 查询 PDF 内容
- `list_indexes`: 列出所有索引
- `delete_index`: 删除索引

## 开发

```bash
# 运行测试
uv run pytest

# 代码格式化
uv run black src/
uv run ruff check src/
```
