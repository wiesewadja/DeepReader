# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

**DeepPDF** 是一个基于 MCP (Model Context Protocol) 的 PDF 智能索引和问答系统，为 Obsidian 提供强大的 PDF 文档管理和语义搜索能力。

项目采用 Python 后端 + TypeScript 前端的分离架构，通过 MCP 协议（stdio 传输层）进行通信。

## 常用命令

### 后端开发 (Python)

```bash
# 进入后端目录
cd mcp-server

# 安装依赖（使用 uv 包管理器）
uv sync

# 运行 MCP 服务器
uv run python -m deeppdf.server

# 运行所有测试
uv run pytest -v

# 运行单个测试文件
uv run pytest tests/test_pdf_indexer.py -v

# 代码格式化
uv run black src/

# 代码检查
uv run ruff check src/

# 类型检查
uv run mypy src/
```

### 前端开发 (TypeScript)

```bash
# 进入前端目录
cd obsidian-plugin

# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 生产构建
npm run build

# 运行测试
npm run test:run       # 命令行测试
npm run test:ui        # UI 测试界面

# 部署到 Obsidian vault
npm run deploy
```

### 集成测试

```bash
cd mcp-server
python scripts/test_integration.py
```

## 项目架构

### 目录结构

```
DeepPDF/
├── mcp-server/                    # Python MCP 服务器（后端）
│   ├── packages/
│   │   ├── deeppdf/              # 核心 MCP 服务器包
│   │   │   └── src/deeppdf/
│   │   │       ├── server.py     # MCP 服务器主入口
│   │   │       ├── config.py     # 配置管理
│   │   │       ├── tools/        # MCP 工具实现
│   │   │       │   ├── pdf_indexer.py    # PDF 索引工具
│   │   │       │   ├── pdf_query.py      # PDF 查询工具
│   │   │       │   └── index_manager.py  # 索引管理工具
│   │   │       └── storage/      # 向量存储层
│   │   │           ├── chroma_store.py    # ChromaDB 封装
│   │   │           └── embeddings.py      # 中文嵌入模型
│   │   └── pageindex/            # PageIndex 独立包
│   │       └── src/pageindex/    # PDF 章节解析库
│   ├── tests/                     # 后端测试套件
│   ├── scripts/                   # 集成测试和辅助脚本
│   ├── data/                      # 数据存储目录（ChromaDB、索引元数据）
│   └── pyproject.toml            # uv 工作空间配置
│
└── obsidian-plugin/               # Obsidian 前端插件
    ├── src/
    │   ├── main.ts               # 插件入口
    │   ├── mcp/                  # MCP 客户端实现
    │   │   ├── client.ts         # 核心客户端（连接管理、工具调用）
    │   │   ├── stdio-transport.ts # Stdio 传输层
    │   │   ├── json-rpc.ts       # JSON-RPC 协议实现
    │   │   └── types.ts          # TypeScript 类型定义
    │   ├── views/                # 视图组件
    │   │   └── sidebar-view.ts   # 侧边栏视图
    │   └── ui/                   # UI 组件
    │       └── index-manager-modal.ts  # 索引管理模态框
    ├── manifest.json             # Obsidian 插件清单
    ├── package.json              # npm 配置
    ├── tsconfig.json             # TypeScript 配置
    └── esbuild.config.mjs        # 构建配置
```

### 核心组件

1. **MCP Server** ([server.py](mcp-server/packages/deeppdf/src/deeppdf/server.py))
   - 实现 MCP 协议服务器
   - 注册 4 个核心工具：`index_pdf`、`query_pdf`、`list_indexes`、`delete_index`
   - 使用 stdio 传输层与 Obsidian 插件通信

2. **PDF Indexer** ([pdf_indexer.py](mcp-server/packages/deeppdf/src/deeppdf/tools/pdf_indexer.py))
   - 使用 PageIndex 解析 PDF 章节结构
   - 支持 LLM 驱动的章节摘要生成
   - 向量化并存储到 ChromaDB

3. **ChromaStore** ([chroma_store.py](mcp-server/packages/deeppdf/src/deeppdf/storage/chroma_store.py))
   - 封装 ChromaDB 客户端
   - 使用中文嵌入模型：BAAI/bge-small-zh-v1.5（512 维度）
   - 持久化存储到 `data/chroma/`

4. **PageIndex** ([pageindex/](mcp-server/packages/pageindex/src/pageindex/))
   - PDF 和 Markdown 文档结构分析
   - LLM 驱动的章节摘要生成
   - 支持多种 LLM Provider（DeepSeek、OpenAI 等）

5. **MCP Client** ([client.ts](obsidian-plugin/src/mcp/client.ts))
   - 管理与 MCP Server 的连接
   - 实现工具调用（`indexPDF`、`queryPDF`、`listIndexes`、`deleteIndex`）
   - 自动重试机制（指数退避策略）

### 通信架构

```
┌─────────────────────────────────────────┐
│         Obsidian Plugin (TS)            │
│  ┌────────────────────────────────────┐ │
│  │      MCP Client (JSON-RPC)         │ │
│  └────────────┬───────────────────────┘ │
└───────────────┼──────────────────────────┘
                │ Stdio Transport (stdin/stdout)
┌───────────────▼──────────────────────────┐
│          MCP Server (Python)             │
│  ┌────────────────────────────────────┐ │
│  │  index_pdf │ query_pdf │ list...   │ │
│  └────────────┬───────────────────────┘ │
│               │                            │
│  ┌────────────▼───────────────────────┐ │
│  │    PageIndex + ChromaDB + LLM      │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 环境变量配置

后端使用以下环境变量（可在 `mcp-server/.env` 中配置）：

- `PDF_INDEX_LLM_PROVIDER`: LLM provider（默认 deepseek）
- `PDF_INDEX_MODEL`: 模型名称（默认 deepseek-chat）
- `PDF_INDEX_TOC_CHECK_PAGES`: 目录检查页数（默认 20）
- `PDF_INDEX_MAX_PAGES_PER_NODE`: 每节点最大页数（默认 10）
- `PDF_INDEX_IF_ADD_NODE_SUMMARY`: 是否添加摘要（默认 yes）

## 测试框架

### 后端测试

- **框架**: pytest + pytest-asyncio
- **测试位置**: [mcp-server/tests/](mcp-server/tests/)
- **配置**: [pyproject.toml](mcp-server/pyproject.toml) 中的 `[tool.pytest.ini_options]`

### 前端测试

- **框架**: Vitest
- **配置文件**: [vitest.config.ts](obsidian-plugin/vitest.config.ts)
- **命令**: `npm run test:run` 或 `npm run test:ui`

## Python 工作空间配置

项目使用 **uv** 作为包管理器，配置为多包工作空间：

- **根配置**: [mcp-server/pyproject.toml](mcp-server/pyproject.toml)
- **成员包**: `packages/pageindex`、`packages/deeppdf`
- **内部依赖**: deeppdf 依赖 pageindex（通过 `workspace = true` 引用）

## TypeScript 配置

- **编译器目标**: ES2020
- **模块系统**: ESNext
- **配置文件**: [tsconfig.json](obsidian-plugin/tsconfig.json)
- **构建工具**: esbuild（[esbuild.config.mjs](obsidian-plugin/esbuild.config.mjs)）

## 代码风格

### Python

- **行长度**: 100 字符
- **目标版本**: Python 3.10+
- **格式化工具**: black
- **检查工具**: ruff

### TypeScript

- **构建时**: 使用 TypeScript 编译器检查类型（`tsc -noEmit -skipLibCheck`）

## VS Code 配置

项目包含 [VS Code 设置](.vscode/settings.json)：
- Python 解释析器路径：`${workspaceFolder}/mcp-server/.venv/bin/python`
- 额外分析路径：包括 `packages/pageindex/src` 和 `packages/deeppdf/src`
- 保存时自动格式化 Python 文件
- pytest 集成测试配置

## 开发注意事项

1. **MCP 通信**: 插件与服务器通过 stdio 通信，调试时注意进程管理和消息格式
2. **向量数据库**: ChromaDB 数据存储在 `mcp-server/data/chroma/`，清理索引时需删除此目录
3. **中文嵌入**: 项目使用 bge-small-zh-v1.5 模型，首次运行会自动下载
4. **LLM API**: PageIndex 需要配置 LLM API（默认 DeepSeek），确保 `~/.openai/` 或环境变量中有正确的 API 密钥
5. **热重载**: 前端使用 `npm run dev` 可启用热重载，后端修改需重启 MCP 服务器

## 相关文档

- [项目 README](README.md)
- [MVP 架构设计](docs/MVP/mvp-architecture-design.md)
- [实施进度](docs/MVP/implementation-progress.md)
