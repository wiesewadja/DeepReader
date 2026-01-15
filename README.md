# DeepPDF

PDF 智能索引和问答系统，为 Obsidian 提供强大的 PDF 文档管理和查询能力。

## 项目概述

DeepPDF 是一个基于 FastAPI 的 PDF 文档智能索引和问答系统。它由 Python 后端和 Obsidian 插件前端组成，提供：

- 📚 **智能 PDF 索引**: 使用 PageIndex 进行章节级别的文档分割
- 🔍 **语义搜索**: 基于中文优化的向量嵌入模型
- 🎯 **精准问答**: 结合向量检索和 LLM 生成
- 🚀 **Obsidian 集成**: 无缝集成到 Obsidian 笔记工作流
- ⚡ **HTTP API**: RESTful API 接口，易于集成

## 架构

```
DeepPDF/
├── backend/                    # FastAPI 后端
│   ├── deeppdf-api/            # FastAPI 应用
│   │   ├── src/deeppdf/
│   │   │   ├── main.py         # FastAPI 应用入口
│   │   │   ├── config.py       # 配置管理
│   │   │   ├── api/            # API 路由和模型
│   │   │   ├── services/       # 业务逻辑层
│   │   │   ├── storage/        # 向量存储层
│   │   │   └── utils/         # 工具函数
│   │   └── tests/             # 测试文件
│   ├── pageindex-lib/          # PageIndex 库（独立包）
│   ├── data/                   # 数据存储目录
│   └── scripts/                # 辅助脚本
│
└── frontend/                   # Obsidian 前端插件
    ├── src/
    │   ├── main.ts             # 插件入口
    │   ├── api/                # HTTP 客户端
    │   │   ├── http-client.ts  # API 客户端
    │   │   └── server-manager.ts # 服务器进程管理
    │   ├── views/              # 视图组件
    │   └── ui/                 # UI 组件
    └── styles.css              # 样式文件
```

## 技术栈

### 后端 (Python)

- **FastAPI**: 高性能 Web 框架
- **Uvicorn**: ASGI 服务器
- **ChromaDB**: 向量数据库
- **PageIndex**: PDF 章节分割和解析
- **中文嵌入**: BAAI/bge-small-zh-v1.5 (512 维度)
- **PyMuPDF**: PDF 文本提取
- **TikToken**: Token 计数

### 前端 (TypeScript)

- **Obsidian API**: 插件开发
- **fetch API**: HTTP 请求
- **esbuild**: 构建工具

## 快速开始

### 1. 安装后端

```bash
cd backend
uv sync
```

### 2. 启动 FastAPI 服务器

```bash
cd backend
./scripts/start_server.sh
```

服务器将在 http://localhost:8000 启动。

### 3. 安装 Obsidian 插件

```bash
cd frontend
npm install
npm run build
```

复制 `frontend` 目录到 Obsidian vault 的 `.obsidian/plugins/` 目录。

### 4. 配置插件

在 Obsidian 设置中:
1. 启用 DeepPDF 插件
2. 设置 Backend Path 为 `backend` 目录的绝对路径
3. 设置 API Port（默认：8000）
4. 调整 Max Results（默认：5）

### 5. 配置 LLM API

在后端 `.env` 文件中配置：
```bash
DEEPSEEK_API_KEY=your_api_key_here
# 或
OPENAI_API_KEY=your_api_key_here
```

## API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/docs` | GET | API 文档 (Swagger UI) |
| `/api/index` | POST | 创建 PDF 索引 |
| `/api/query` | POST | 查询 PDF 内容 |
| `/api/indexes` | GET | 列出所有索引 |
| `/api/indexes/{id}` | DELETE | 删除索引 |

## 使用方法

### 索引 PDF 文档

1. 打开 DeepPDF 侧边栏 (点击 Ribbon 图标或使用命令面板)
2. 点击"管理索引"按钮
3. 选择要索引的 PDF 文件
4. 等待索引完成

### 查询 PDF 内容

1. 在侧边栏查询框中输入问题
2. 点击"提问"按钮
3. 查看相关文档片段和答案

## 测试

### 后端测试

```bash
cd backend
uv run pytest
```

### 前端测试

```bash
cd frontend
npm run test:run
```

## 开发状态

当前版本: 1.0.0 (FastAPI 重构版)

### 已完成功能

- ✅ FastAPI 应用框架
- ✅ PDF 索引 (PageIndex 集成)
- ✅ 向量存储 (ChromaDB)
- ✅ 语义搜索
- ✅ Obsidian 插件基础框架
- ✅ HTTP 客户端实现
- ✅ 服务器进程管理
- ✅ 设置面板
- ✅ 侧边栏查询界面
- ✅ 索引管理模态框
- ✅ 端到端测试

### 待实现功能

- ⏳ LLM 集成 (RAG 问答生成)
- ⏳ 批量索引
- ⏳ 索引导出/导入
- ⏳ 查询历史记录
- ⏳ 多语言支持

## 从 MCP 迁移

如果您之前使用的是 MCP 版本，请参考[迁移指南](docs/MVP/migration-guide.md)了解变更。

## 文档

- [迁移指南](docs/MVP/migration-guide.md)
- [MVP 架构设计](docs/MVP/mvp-architecture-design.md)
- [实施进度](docs/MVP/implementation-progress.md)

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

---

**开发团队**: DeepPDF Team
**最后更新**: 2026-01-15
