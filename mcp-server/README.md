# DeepPDF MCP Server

MCP 服务器，提供 PDF 索引和查询功能。

## 功能

- PDF 文档解析和索引
- 语义搜索
- 向量存储（ChromaDB）
- PageIndex 集成

## 安装

### 方式一：使用设置脚本（推荐）

```bash
cd mcp-server
./scripts/setup_mcp_server.sh
```

### 方式二：手动安装

```bash
cd mcp-server
uv sync
uv pip install -e packages/pageindex
uv pip install -e packages/deeppdf
```

## 配置

复制 `.env.example` 到 `.env` 并配置你的 API Key：

```bash
cp .env.example .env
# 编辑 .env 文件，填入你的 DEEPSEEK_API_KEY 或 OPENAI_API_KEY
```

详细配置说明请查看 [CONFIGURATION.md](CONFIGURATION.md)。

## 使用

### 作为独立服务器

```bash
uv run python -m deeppdf.server
```

### 测试安装

```bash
# 测试环境变量
.venv/bin/python scripts/test_env.py

# 测试 asyncio 嵌套事件循环
.venv/bin/python scripts/test_nest_asyncio.py

# 测试 PDF 索引功能
.venv/bin/python scripts/test_pdf_indexing.py
```

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

## 故障排除

### MCP 服务器无法连接

如果遇到 "MCP 服务器无法连接" 错误，请运行：

```bash
./scripts/setup_mcp_server.sh
```

这将确保所有依赖都以 editable 模式正确安装。

### asyncio 事件循环错误

如果遇到 `asyncio.run() cannot be called from a running event loop` 错误，说明 `nest-asyncio` 没有正确安装。运行设置脚本即可解决。

详细说明请查看 [docs/asyncio-fix.md](docs/asyncio-fix.md)。
