# CLAUDE.md

## 项目定位
**DeepReader**: 纯前端的 Obsidian PDF 智能索引插件，使用 PageIndex 本地引擎实现完全本地化的语义搜索。

- **架构**: 纯前端（Obsidian Plugin）
- **技术栈**: TypeScript + Node.js API
- **核心引擎**: PageIndex（本地索引和搜索）
- **无后端**: 所有功能在本地完成，无需外部服务

---

## 架构说明

### 完全本地化

DeepReader 采用纯前端架构：

- **PageIndex 引擎**: 本地 PDF/EPUB 解析、索引、搜索
- **FrontendAgent**: 内置 AI 助手，独立使用 LLM API
- **本地存储**: `.pageindex/` 目录存储索引和向量
- **隐私优先**: 数据不离开本地环境

### 核心模块

```
PageIndex (核心引擎)
├── book-indexer    书籍索引编排
├── book-search     混合搜索（Vector + BM25）
├── bm25            BM25 算法实现
├── parsers         文档解析（PDF/EPUB/Markdown）
├── exporters       Obsidian 导出
└── vault           向量存储和管理
```

---

## 命令

### 前端 (`/frontend`)
- **开发**: `npm run dev`（监听模式）-> 在 Obsidian 中重新加载（Cmd+R）
- **构建**: `npm run build`（包含类型检查）
- **测试**: `npm run test:run`（Vitest）
- **部署**: `npm run deploy`（构建并复制到 test-vault）

### 调试
- **Obsidian Console**: Cmd+Option+I 打开开发者工具
- **插件实例**: `app.plugins.plugins['deepreader']`
- **测试 Vault**: 项目内 `test-vault/` 目录

---

## 日志

### 前端日志
- **方式**: `console.log` / Obsidian Console
- **位置**: Cmd+Option+I -> Console 标签
- **模块日志**: 使用 `utils/logger.ts` 中的日志器

---

## 架构与文件映射

### PageIndex 核心结构 (`src/pageindex`)
- `node.ts`: Node.js 入口，导出核心 API
- `book-indexer.ts`: 书籍索引编排（主要流程）
- `book-search.ts`: 混合搜索实现
- `bm25.ts`: BM25 算法（关键词检索）
- `parsers/`: 文档解析器
  - `pdf.ts`: PDF 解析（pdf-parse）
  - `epub.ts`: EPUB 解析（adm-zip + xml2js）
  - `markdown.ts`: Markdown 结构提取
- `exporters/`: Obsidian 导出
  - `pdf-to-obsidian.ts`: PDF → Markdown
  - `epub-to-obsidian.ts`: EPUB → Markdown
- `vault/`: 向量存储
  - `vectors.ts`: JSONL 向量存储 + 全局目录
  - `types.ts`: 类型定义

### 前端结构 (`frontend/src`)
- `main.ts`: 插件入口，注册命令和视图
- `agent/`: FrontendAgent AI 助手
- `views/`: Obsidian UI 组件（sidebar-view 等）
- `components/`: UI 组件（library-modal, chat-input 等）
- `api/`: HTTP 客户端（仅用于 LLM API）
- `services/`: 业务服务（reading-portal, context-manager 等）

---

## 关键开发规则

### 1. PageIndex 使用

```typescript
// 导入核心 API（Node.js 兼容）
import { PageIndex, processPdfForObsidian } from './pageindex/node';
import { indexBook, searchBook } from './pageindex/book-indexer';
import type { BookIndexProgress } from './pageindex/book-types';

// 索引书籍
const result = await indexBook({
  filePath: '/path/to/book.pdf',
  fileType: 'pdf',
  outputDir: vaultPath,
  model: 'gpt-4o-mini',
  apiKey: settings.openaiApiKey,
  onProgress: (progress: BookIndexProgress) => {
    console.log(`${progress.percent}% - ${progress.stepLabel}`);
  }
});

// 搜索书籍
const results = await searchBook({
  filePath: '/path/to/book.pdf',
  query: '机器学习',
  topK: 5,
  embedding: settings.embedding,
});
```

### 2. 本地存储

- **索引位置**: `.pageindex/{bookId}/`
- **BookId 生成**: SHA-256(filePath).slice(0, 8)
- **存储内容**: book-meta.json, bm25.json, vectors.jsonl, catalog.json

### 3. LLM 配置

```typescript
// 在插件设置中配置
settings.openaiApiKey = 'sk-...';
settings.llmModel = 'gpt-4o-mini';
settings.apiUrl = 'https://api.openai.com/v1';

// Embedding 配置（可选）
settings.embedding = {
  provider: 'openai',
  model: 'text-embedding-3-small',
  dimensions: 1536,
  apiKey: 'sk-...',
  baseUrl: 'https://api.openai.com/v1'
};
```

### 4. 错误处理

- 使用 `IndexError` 自定义错误类
- 提供用户友好的错误提示（中文）
- 在 UI 中显示错误状态和恢复建议

---

## 常见陷阱（切勿忽略）

### 类型检查
- **问题**: TypeScript 类型错误
- **修复**: 确保 `obsidian` 类型定义存在，或使用 `// @ts-ignore` 并注明原因
- **测试 Vault**: 项目内 `test-vault/` 目录

### PageIndex 导入
- **问题**: 导入路径错误
- **修复**: 使用 `./pageindex/node.js`（Node.js 入口），不要使用 `./pageindex/index.js`

### 异步操作
- **问题**: 忘记 await
- **修复**: 所有 PageIndex API 都是异步的，必须使用 await

### 文件路径
- **问题**: 相对路径 vs 绝对路径
- **修复**: PageIndex 需要绝对路径，使用 `vault.adapter.getFilePath(file)`

---

## Git 提交规范

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
git commit -m "fix: 修复搜索结果排序问题"
```

**注意**: 无明确指定，不要自行提交代码

---

## 性能考虑

### 索引性能
- **PDF 解析**: ~1-2 秒/页
- **LLM 摘要**: ~0.5-1 秒/章节
- **向量化**: ~100ms/章节（可选）

### 存储优化
- **BM25 索引**: ~1KB/章节
- **向量存储**: ~6KB/章节（Float32, 1536 维）
- **建议**: 定期清理未使用的索引

---

## 测试策略

### 单元测试
- **框架**: Vitest
- **位置**: `src/**/__tests__/`
- **运行**: `npm run test:run`

### E2E 测试
- **位置**: `src/e2e/`
- **覆盖**: 完整的索引→搜索→删除流程

### 测试覆盖率
- **目标**: >80% 核心功能覆盖
- **重点**: PageIndex API, Agent Tools

---

## 扩展指南

### 添加新的文档解析器

1. 在 `pageindex/parsers/` 创建解析器
2. 实现 `parse()` 函数
3. 在 `pageindex/node.ts` 导出
4. 更新 `book-indexer.ts` 支持

### 添加新的搜索工具

1. 在 `agent/tools/` 创建工具文件
2. 实现 `ToolDefinition` 和 `ToolExecutor`
3. 注册到 `agent/tool-router.ts`
4. 添加单元测试

---

## 文档更新

当架构或功能有重大变化时，请同步更新：
- `README.md` - 用户指南
- `CLAUDE.md` - 开发者指南（本文件）
- `src/pageindex/README.md` - PageIndex 集成指南
- `CHANGELOG.md` - 版本更新日志