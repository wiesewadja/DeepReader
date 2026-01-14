# DeepPDF

PDF 智能索引和问答系统，为 Obsidian 提供强大的 PDF 文档管理和查询能力。

## 项目概述

DeepPDF 是一个基于 MCP (Model Context Protocol) 的 PDF 文档智能索引和问答系统。它由 Python 后端和 Obsidian 插件前端组成，提供：

- 📚 **智能 PDF 索引**: 使用 PageIndex 进行章节级别的文档分割
- 🔍 **语义搜索**: 基于中文优化的向量嵌入模型
- 🎯 **精准问答**: 结合向量检索和 LLM 生成
- 🚀 **Obsidian 集成**: 无缝集成到 Obsidian 笔记工作流

## 架构

```
DeepPDF/
├── mcp-server/          # Python MCP 服务器
│   ├── src/
│   │   ├── deeppdf/
│   │   │   ├── tools/   # MCP 工具实现
│   │   │   ├── storage/ # ChromaDB 向量存储
│   │   │   └── pageindex/ # PDF 解析 (PageIndex)
│   │   └── tests/       # 单元测试
│   └── scripts/         # 集成测试脚本
│
└── obsidian-plugin/     # Obsidian 前端插件
    ├── src/
    │   ├── mcp/         # MCP 客户端
    │   ├── views/       # 侧边栏视图
    │   └── ui/          # UI 组件
    └── styles.css       # 样式文件
```

## 技术栈

### 后端 (Python)

- **MCP SDK**: Model Context Protocol 服务器实现
- **ChromaDB**: 向量数据库
- **PageIndex**: PDF 章节分割和解析
- **中文嵌入**: BAAI/bge-small-zh-v1.5 (512 维度)
- **PyMuPDF**: PDF 文本提取
- **TikToken**: Token 计数

### 前端 (TypeScript)

- **Obsidian API**: 插件开发
- **MCP Client SDK**: 与后端通信
- **esbuild**: 构建工具

## 快速开始

### 1. 安装后端

```bash
cd mcp-server
uv sync
```

### 2. 启动 MCP 服务器

```bash
uv run python -m deeppdf.server
```

### 3. 安装 Obsidian 插件

```bash
cd obsidian-plugin
npm install
npm run build
```

复制 `obsidian-plugin` 目录到 Obsidian vault 的 `.obsidian/plugins/` 目录。

### 4. 配置插件

在 Obsidian 设置中:
1. 启用 DeepPDF 插件
2. 设置 MCP Server Path 为 `mcp-server` 目录的绝对路径
3. 调整 Max Results (默认: 5)

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
cd mcp-server
uv run pytest
```

### 前端测试

```bash
cd obsidian-plugin
npm run test:run
```

### 集成测试

```bash
cd mcp-server
python scripts/test_integration.py
```

## 开发状态

当前版本: MVP (Minimum Viable Product)

### 已完成功能

- ✅ MCP 服务器框架
- ✅ PDF 索引 (PageIndex 集成)
- ✅ 向量存储 (ChromaDB)
- ✅ 语义搜索
- ✅ Obsidian 插件基础框架
- ✅ MCP 客户端实现
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

## 文档

- [MVP 架构设计](docs/MVP/mvp-architecture-design.md)
- [实施进度](docs/MVP/implementation-progress.md)
- [Obsidian 插件文档](obsidian-plugin/README.md)
- [MCP 服务器文档](mcp-server/README.md)

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

---

**开发团队**: DeepPDF Team
**最后更新**: 2026-01-14
