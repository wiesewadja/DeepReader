# DeepReader

**DeepReader** - 为 Obsidian 提供的 PDF 智能索引插件，完全本地化的语义搜索解决方案。

**技术栈**: TypeScript (Obsidian Plugin API) + PageIndex 本地索引引擎
**架构**: 纯前端，无需后端服务

---

## 核心特性

### 🚀 完全本地化
- **PageIndex 引擎**: 所有索引和搜索功能在本地完成
- **无需后端**: 不依赖外部服务器，保护隐私
- **离线可用**: 仅需 LLM API 即可使用所有功能

### 📚 智能索引
- **PDF/EPUB 解析**: 自动提取文档结构
- **TOC 生成**: 智能目录检测和层级构建
- **LLM 增强**: 使用 GPT-4/Claude 等模型生成摘要

### 🔍 混合搜索
- **向量搜索**: 语义相似度匹配
- **BM25 搜索**: 关键词精确检索
- **Hybrid 融合**: 结合两种搜索方式的最优结果

### 💬 AI 助手
- **FrontendAgent**: 内置 AI 对话功能
- **上下文感知**: 自动关联已索引书籍内容
- **多模型支持**: OpenAI、DeepSeek、LM Studio 等

---

## 使用方式

### 快速开始

1. **安装插件**
   - 将 `main.js`, `styles.css`, `manifest.json` 复制到 Obsidian vault 的 `.obsidian/plugins/deepreader/` 目录

2. **配置 API Key**
   - 在插件设置中配置 OpenAI/DeepSeek API Key
   - 或使用本地模型（LM Studio, Ollama）

3. **开始使用**
   - 打开侧边栏（DeepReader 图标）
   - 点击"书库"添加 PDF/EPUB 文件
   - 等待索引完成后即可搜索和对话

### 索引书籍

**方式 1: 通过书库界面**
1. 点击侧边栏的"书库"按钮
2. 点击"+"添加书籍文件
3. 等待索引完成（会显示进度）

**方式 2: 直接打开 PDF**
1. 在 Obsidian 中打开 PDF 文件
2. 点击顶部工具栏的"索引"按钮
3. 自动开始索引流程

### 搜索和对话

- **搜索**: 在搜索框输入关键词，查找书籍内容
- **对话**: 与 AI 助手交流，自动引用已索引书籍的相关内容
- **引用**: 点击引用标记，直接跳转到原文位置

---

## 开发工作流

### 环境要求

- Node.js 18+
- npm 或 pnpm
- Obsidian（测试用）

### 启动开发环境

```bash
# 克隆项目
git clone https://github.com/your-repo/deepreader.git
cd deepreader/frontend

# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 在 Obsidian 中重新加载插件（Cmd+R）
```

### 构建和部署

```bash
# 构建（包含类型检查）
npm run build

# 部署到测试 vault
npm run deploy

# 重新加载插件
obsidian plugin:reload id=deepreader
```

### 测试

```bash
# 运行单元测试
npm run test:run

# 运行测试 UI
npm run test:ui

# 运行 E2E 测试
npm run test:e2e
```

### 代码质量检查

```bash
# 类型检查
npm run build  # 构建时自动检查

# 代码格式化（如果配置了）
npm run format
```

---

## 开发规范

### TypeScript 代码规范

| 项目 | 规范 | 工具 |
|------|------|------|
| 编译目标 | ES2020 | tsc |
| 模块系统 | ESNext | tsc |
| 类型检查 | 构建时检查 | tsc -noEmit |
| 构建工具 | esbuild | esbuild |
| 注释风格 | JSDoc | - |

### Git 提交规范

```bash
# 格式
<type>: <subject>

# 类型
feat:     新功能
fix:      修复 bug
refactor: 重构（不改变功能）
docs:     文档更新
test:     测试相关
chore:    构建/工具链相关

# 示例
git commit -m "feat: 添加批量索引功能"
git commit -m "fix: 修复查询返回空结果的问题"
```

### 代码审查原则

1. **测试先行**: 修改功能前先运行相关测试
2. **类型安全**: 确保类型检查通过（tsc -noEmit）
3. **格式统一**: 遵循项目代码风格
4. **简洁原则**: 避免过度工程化，按需实现

---

## 项目结构

### 关键文件路径

```
frontend/src/
├── main.ts                      # 插件入口，注册命令和视图
├── pageindex/                   # PageIndex 核心引擎
│   ├── node.ts                  # Node.js 入口
│   ├── book-indexer.ts          # 书籍索引编排
│   ├── book-search.ts           # 混合搜索
│   ├── bm25.ts                  # BM25 算法
│   ├── parsers/                 # 文档解析器
│   │   ├── pdf.ts               # PDF 解析
│   │   └── epub.ts              # EPUB 解析
│   ├── exporters/               # Obsidian 导出
│   │   ├── pdf-to-obsidian.ts   # PDF 导出
│   │   └── epub-to-obsidian.ts  # EPUB 导出
│   └── vault/                   # 向量存储
│       ├── vectors.ts           # 向量管理
│       └── types.ts             # 类型定义
├── agent/                       # AI 助手
│   ├── index.ts                 # FrontendAgent 入口
│   └── tools/                   # 工具集
├── views/                       # UI 视图
│   └── sidebar-view.ts          # 侧边栏视图
├── components/                  # UI 组件
│   ├── library-modal/           # 书库弹窗
│   └── chat-input/              # 聊天输入框
└── api/                         # API 客户端（LLM）
    └── http-client.ts           # HTTP 封装
```

### 分层架构

```
┌─────────────────────────────────────────────┐
│  Obsidian Plugin (UI Layer)                 │
│  ├── Views (sidebar, modals)                │
│  └── Components (interactive elements)      │
├─────────────────────────────────────────────┤
│  PageIndex Engine (Business Layer)          │
│  ├── Parsers (PDF/EPUB/Markdown)            │
│  ├── Indexers (book-indexer)                │
│  └── Search (book-search, BM25)             │
├─────────────────────────────────────────────┤
│  Storage Layer                              │
│  ├── Vault Storage (vectors, metadata)      │
│  └── File System (.pageindex/)              │
└─────────────────────────────────────────────┘
```

### 数据流

**索引流程**:
```
PDF/EPUB → Parser → Tree Structure → LLM Summary → Markdown Export
                                      ↓
                              Vector Embedding (可选)
                                      ↓
                              Local Storage (.pageindex/)
```

**搜索流程**:
```
Query → Tokenize → BM25 Search → Vector Search (可选)
                              ↓
                        Score Fusion → Top-K Results
                              ↓
                        Context Reading → Response
```

---

## 存储结构

### .pageindex/ 目录

```
.pageindex/{bookId}/
├── book-meta.json         # 书籍元数据（章节、摘要）
├── bm25.json              # BM25 倒排索引
├── vectors.f32            # Float32 向量数据（可选）
└── vectors.meta.json      # 向量元数据（可选）
```

### Book ID 生成

- 使用 SHA-256(filePath) 前 8 字符
- 例如: `/vault/books/example.pdf` → `a1b2c3d4`

---

## 配置选项

### LLM 配置

```json
{
  "llmModel": "gpt-4o-mini",
  "openaiApiKey": "sk-...",
  "apiUrl": "https://api.openai.com/v1",
  "embeddingModel": "text-embedding-3-small",
  "embeddingApiKey": "sk-...",
  "embeddingBaseUrl": "https://api.openai.com/v1"
}
```

### Embedding 配置

```json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536,
    "apiKey": "sk-...",
    "baseUrl": "https://api.openai.com/v1"
  }
}
```

---

## 性能优化

### 索引性能

- **PDF 解析**: ~1-2 秒/页（取决于 PDF 复杂度）
- **LLM 摘要**: ~0.5-1 秒/章节
- **向量化**: ~100ms/章节（可选）

### 存储优化

- **BM25 索引**: ~1KB/章节
- **向量存储**: ~6KB/章节（Float32, 1536 维）
- **压缩**: 可通过调整维度减少存储

---

## 故障排查

### 常见问题

**1. 索引失败**
- 检查 API Key 是否正确
- 查看 Console 日志（Cmd+Option+I）
- 确认文件路径可访问

**2. 搜索无结果**
- 确认书籍已索引完成
- 检查 `.pageindex/` 目录是否存在
- 尝试重新索引

**3. 插件无法加载**
- 检查 `manifest.json` 是否正确
- 确认 Node.js 版本 >= 18
- 查看 Obsidian Console 错误信息

### 调试技巧

```javascript
// 在 Obsidian Console 中访问插件实例
app.plugins.plugins['deepreader']

// 查看索引状态
app.plugins.plugins['deepreader'].pageIndex

// 手动触发索引
app.plugins.plugins['deepreader'].processPdf('/path/to/file.pdf')
```

---

## 贡献指南

### 如何贡献

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

### 代码风格

- 遵循 TypeScript 最佳实践
- 添加必要的 JSDoc 注释
- 保持函数简洁（单一职责）
- 编写单元测试

---

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

---

## 致谢

- [Obsidian](https://obsidian.md/) - 强大的知识管理工具
- [pdf-parse](https://www.npmjs.com/package/pdf-parse) - PDF 解析库
- [OpenAI](https://openai.com/) - GPT 和 Embedding API

---

## 更新日志

### v0.9.2 (2026-04-08)
- ✨ 完全本地化的 PageIndex 引擎
- 🚀 移除后端依赖，纯前端架构
- 📚 支持向量 + BM25 混合搜索
- 💬 FrontendAgent AI 助手集成
- 🐛 修复多项已知问题

详见 [CHANGELOG.md](CHANGELOG.md)