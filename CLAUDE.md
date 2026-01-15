# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

**DeepPDF** 是一个基于 FastAPI 的 PDF 智能索引和问答系统，为 Obsidian 提供强大的 PDF 文档管理和语义搜索能力。

项目采用 Python 后端 + TypeScript 前端的分离架构，通过 HTTP REST API 进行通信。

**当前版本**: v1.0.0 (FastAPI 重构版)

## 常用命令

### 后端开发 (Python)

```bash
# 进入后端目录
cd backend

# 安装依赖（使用 uv 包管理器）
uv sync

# 启动 FastAPI 服务器（开发模式）
./scripts/start_server.sh

# 或手动启动
uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio

# 运行所有测试
uv run pytest deeppdf-api/tests/ -v

# 运行单个测试文件
uv run pytest deeppdf-api/tests/test_api.py -v

# 代码格式化
uv run black deeppdf-api/src/

# 代码检查
uv run ruff check deeppdf-api/src/

# 类型检查
uv run mypy deeppdf-api/src/
```

### 前端开发 (TypeScript)

```bash
# 进入前端目录
cd frontend

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

### API 测试

```bash
# 访问 API 文档（服务器启动后）
open http://localhost:6088/docs

# 健康检查
curl http://localhost:6088/health

# 创建索引
curl -X POST http://localhost:6088/api/index \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/file.pdf"}'

# 查询
curl -X POST http://localhost:6088/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "您的问题", "index_id": "索引ID"}'
```

## 项目架构

### 目录结构

```
DeepPDF/
├── backend/                       # FastAPI 后端
│   ├── deeppdf-api/              # FastAPI 应用
│   │   └── src/deeppdf/
│   │       ├── main.py           # FastAPI 应用入口
│   │       ├── config.py         # 配置管理（Pydantic Settings）
│   │       ├── api/              # API 层
│   │       │   ├── routes.py     # REST API 端点
│   │       │   └── models.py     # Pydantic 请求/响应模型
│   │       ├── services/         # 业务逻辑层
│   │       │   ├── indexer.py    # PDF 索引服务（异步）
│   │       │   ├── querier.py    # 查询服务（异步）
│   │       │   └── manager.py    # 索引管理服务（异步）
│   │       ├── storage/          # 向量存储层
│   │       │   ├── chroma_store.py    # ChromaDB 封装
│   │       │   └── embeddings.py      # 中文嵌入模型
│   │       └── utils/           # 工具函数
│   ├── pageindex-lib/            # PageIndex 独立包
│   │   └── src/pageindex/       # PDF 章节解析库
│   ├── tests/                   # 后端测试套件
│   │   └── deeppdf-api/tests/   # FastAPI 应用测试
│   │       ├── test_api.py      # API 端点测试
│   │       └── test_models.py   # 模型验证测试
│   ├── data/                    # 数据存储目录（ChromaDB、索引元数据）
│   ├── scripts/                 # 辅助脚本
│   │   └── start_server.sh      # 服务器启动脚本
│   └── pyproject.toml           # uv 工作空间配置
│
└── frontend/                     # Obsidian 前端插件
    ├── src/
    │   ├── main.ts              # 插件入口
    │   ├── api/                 # HTTP 客户端层
    │   │   ├── http-client.ts   # API 客户端（fetch 封装）
    │   │   └── server-manager.ts # 服务器进程管理
    │   ├── views/               # 视图组件
    │   │   └── sidebar-view.ts  # 侧边栏视图
    │   ├── ui/                  # UI 组件
    │   │   └── index-manager-modal.ts  # 索引管理模态框
    │   └── __tests__/           # 前端测试
    │       ├── http-client.test.ts
    │       └── server-manager.test.ts
    ├── manifest.json            # Obsidian 插件清单
    ├── package.json             # npm 配置
    ├── tsconfig.json            # TypeScript 配置
    ├── vitest.config.ts         # Vitest 测试配置
    └── esbuild.config.mjs       # 构建配置
```

### 核心组件

1. **FastAPI 应用** ([main.py](backend/deeppdf-api/src/deeppdf/main.py))
   - FastAPI 应用入口
   - CORS 中间件配置
   - 自动 API 文档 (Swagger UI + ReDoc)
   - 健康检查端点

2. **API 路由** ([routes.py](backend/deeppdf-api/src/deeppdf/api/routes.py))
   - `/api/index` - 创建 PDF 索引
   - `/api/query` - 查询 PDF 内容
   - `/api/indexes` - 列出所有索引
   - `/api/indexes/{id}` - 删除索引

3. **服务层** ([services/](backend/deeppdf-api/src/deeppdf/services/))
   - 异步服务包装器
   - CPU 密集型任务使用 ThreadPoolExecutor
   - I/O 密集型任务使用 asyncio.to_thread

4. **PDF Indexer** ([indexer.py](backend/deeppdf-api/src/deeppdf/services/indexer.py))
   - 使用 PageIndex 解析 PDF 章节结构
   - 支持 LLM 驱动的章节摘要生成
   - 向量化并存储到 ChromaDB

5. **ChromaStore** ([chroma_store.py](backend/deeppdf-api/src/deeppdf/storage/chroma_store.py))
   - 封装 ChromaDB 客户端
   - 使用中文嵌入模型：BAAI/bge-small-zh-v1.5（512 维度）
   - 持久化存储到 `data/chroma/`

6. **PageIndex** ([pageindex/](backend/pageindex-lib/src/pageindex/))
   - PDF 和 Markdown 文档结构分析
   - LLM 驱动的章节摘要生成
   - 支持多种 LLM Provider（DeepSeek、OpenAI 等）

7. **HTTP 客户端** ([http-client.ts](frontend/src/api/http-client.ts))
   - 封装 fetch API
   - 实现 HTTP 请求方法（indexPDF, queryPDF, listIndexes, deleteIndex）
   - 健康检查和错误处理

8. **服务器管理器** ([server-manager.ts](frontend/src/api/server-manager.ts))
   - 自动启动/停止 FastAPI 服务器
   - 进程监控和重连机制

### 通信架构

```
┌─────────────────────────────────────────┐
│         Obsidian Plugin (TS)            │
│  ┌────────────────────────────────────┐ │
│  │   HTTP Client (fetch API)          │ │
│  └────────────┬───────────────────────┘ │
└───────────────┼──────────────────────────┘
                │ HTTP (localhost:6088)
┌───────────────▼──────────────────────────┐
│         FastAPI Server (Python)          │
│  ┌────────────────────────────────────┐ │
│  │  /api/index │ /api/query │ ...     │ │
│  └────────────┬───────────────────────┘ │
│               │                            │
│  ┌────────────▼───────────────────────┐ │
│  │  Services + PageIndex + ChromaDB   │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 环境变量配置

后端使用以下环境变量（可在 `backend/.env` 中配置）：

```bash
# LLM API 配置
DEEPSEEK_API_KEY=your_api_key_here
# 或
OPENAI_API_KEY=your_api_key_here

# PDF 索引配置
PDF_INDEX_LLM_PROVIDER=deepseek
PDF_INDEX_MODEL=deepseek-chat
PDF_INDEX_TOC_CHECK_PAGES=20
PDF_INDEX_MAX_PAGES_PER_NODE=10
PDF_INDEX_IF_ADD_NODE_SUMMARY=yes

# 并发配置
CPU_WORKERS=2
MAX_CONCURRENT_REQUESTS=10
LLM_CONCURRENT_LIMIT=3
```

### 前端插件配置

Obsidian 插件设置：

- `apiPort`: API 端口（默认：`6088`，需与后端一致）
- `maxResults`: 查询返回的最大结果数（默认：`5`）

## 测试框架

### 后端测试

- **框架**: pytest + pytest-asyncio
- **测试位置**: [backend/deeppdf-api/tests/](backend/deeppdf-api/tests/)
- **当前覆盖**: 23 个测试（API 端点 + Pydantic 模型）
- **运行命令**:
  ```bash
  cd backend
  uv run pytest deeppdf-api/tests/ -v
  ```

### 前端测试

- **框架**: Vitest
- **配置文件**: [vitest.config.ts](frontend/vitest.config.ts)
- **测试位置**: [frontend/src/api/__tests__/](frontend/src/api/__tests__/)
- **当前覆盖**: 20 个测试（HTTP 客户端 + 服务器管理器）
- **运行命令**:
  ```bash
  cd frontend
  npm run test:run
  ```

## Python 工作空间配置

项目使用 **uv** 作为包管理器，配置为多包工作空间：

- **根配置**: [backend/pyproject.toml](backend/pyproject.toml)
- **成员包**: `pageindex-lib`、`deeppdf-api`
- **内部依赖**: deeppdf-api 依赖 pageindex-lib（通过 `workspace = true` 引用）

## TypeScript 配置

- **编译器目标**: ES2020
- **模块系统**: ESNext
- **配置文件**: [tsconfig.json](frontend/tsconfig.json)
- **构建工具**: esbuild（[esbuild.config.mjs](frontend/esbuild.config.mjs)）

## 代码风格

### Python

- **行长度**: 100 字符
- **目标版本**: Python 3.10+
- **格式化工具**: black
- **检查工具**: ruff
- **类型检查**: mypy

### TypeScript

- **构建时**: 使用 TypeScript 编译器检查类型（`tsc -noEmit -skipLibCheck`）
- **测试**: Vitest 运行时类型检查

## VS Code 配置

项目包含 [VS Code 设置](.vscode/settings.json)：
- Python 解释器路径：`${workspaceFolder}/backend/.venv/bin/python`
- 额外分析路径：包括 `pageindex-lib/src/pageindex` 和 `deeppdf-api/src/deeppdf`
- 保存时自动格式化 Python 文件
- pytest 测试配置

## 开发注意事项

1. **FastAPI 服务器**:
   - 使用 `--loop asyncio` 标志避免与 nest_asyncio 冲突
   - 修改代码后自动重载（开发模式）
   - API 文档自动生成于 `/docs`

2. **异步编程**:
   - CPU 密集型任务（PDF 索引）使用 ThreadPoolExecutor
   - I/O 密集型任务（数据库查询）使用 asyncio.to_thread
   - PageIndex 需要 nest_asyncio 支持

3. **向量数据库**: ChromaDB 数据存储在 `backend/data/chroma/`，清理索引时需删除此目录

4. **中文嵌入**: 项目使用 bge-small-zh-v1.5 模型，首次运行会自动下载

5. **LLM API**: PageIndex 需要配置 LLM API（默认 DeepSeek），确保环境变量中有正确的 API 密钥

6. **热重载**:
   - 前端使用 `npm run dev` 可启用热重载
   - 后端使用 `--reload` 标志启用自动重载

7. **CORS 配置**: 开发环境允许所有来源，生产环境应限制为具体域名

8. **端口冲突**: 默认端口 6088，如被占用可在配置中修改

## 相关文档

- [项目 README](README.md)
- [FastAPI 重构总结](docs/MVP/fastapi-refactor-summary.md)
- [迁移指南 (MCP → FastAPI)](docs/MVP/migration-guide.md)
- [MVP 架构设计](docs/MVP/mvp-architecture-design.md)
- [实施进度](docs/MVP/implementation-progress.md)
- [API 文档](http://localhost:6088/docs) - 服务器启动后访问

## 故障排除

### 服务器无法启动

**问题**: `ValueError: Can't patch loop of type <class 'uvloop.Loop'>`

**解决**: 使用 `--loop asyncio` 标志启动服务器
```bash
uv run uvicorn deeppdf.main:app --port 6088 --loop asyncio
```

### Pydantic 验证错误

**问题**: `Extra inputs are not permitted`

**解决**: 检查 `.env` 文件，确保没有未在 Settings 中定义的环境变量，或在 Settings.Config 中设置 `extra = "ignore"`

### 前端无法连接

**问题**: 插件显示 "API 服务器未连接"

**解决**:
1. 确认后端服务器正在运行
2. 确认端口配置（默认 6088）
3. 访问 http://localhost:6088/health 验证服务器

### 测试失败

**问题**: ModuleNotFoundError

**解决**: 确保在 backend 目录下运行测试，并已执行 `uv sync`

---

**版本**: v1.0.0 (FastAPI)
**最后更新**: 2026-01-15
