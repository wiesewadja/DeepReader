# CLAUDE.md

## 项目定位

**DeepReader**: Obsidian 深度阅读插件，实现 PDF/EPUB 智能索引、语义搜索和 AI 辅助阅读。

- **架构**: 纯前端 Obsidian Plugin
- **技术栈**: TypeScript + LangGraph + LangChain
- **核心引擎**: PageIndex（本地索引）+ FrontendAgent（AI Agent）
- **LLM**: 支持 OpenAI、DeepSeek、智谱等多种模型

---

## 目录结构

```
src/
├── main.ts                    # 插件入口
├── views/
│   └── sidebar-view.ts        # 主侧边栏（对话界面）
├── components/                # UI 组件
│   ├── message/               # 聊天消息（AI/用户气泡）
│   ├── message-list/          # 消息列表 + 问题导航 minimap
│   ├── chat-input/            # 输入框 + 引用卡片
│   ├── reading-topbar/        # 阅读顶栏（书籍封面+书名）
│   ├── library-modal/         # 书库弹窗（索引卡片）
│   ├── reading-mode/          # 分页阅读模式
│   ├── excerpt/               # 摘录保存
│   └── question-minimap/      # 问题快速导航
├── agent/                     # FrontendAgent AI 系统
│   ├── graph/                 # LangGraph 认知引擎（核心）
│   │   ├── nodes/             # 路由/检视/分析/主题阅读节点
│   │   ├── prompts/           # 各节点 System Prompt
│   │   ├── subgraphs/         # ReAct 循环子图
│   │   └── checkpointer/      # 状态持久化
│   ├── tools/                 # 工具集
│   │   ├── definitions/       # 工具定义（供 LLM 选择）
│   │   ├── local/             # 本地搜索工具（inspect_toc, hybrid_search, read_section）
│   │   └── *.ts               # 其他工具（write-note, memory, canvas 等）
│   ├── router/                # 意图路由器（闲聊/检视/分析/主题）
│   ├── memory/                # 记忆系统（store + consolidator + milestones）
│   ├── session/               # 会话存储（JSONL）
│   ├── skills/                # Skill 加载器
│   ├── context/               # 用户上下文构建
│   ├── models/                # LLM 模型封装
│   ├── tracing/               # LangSmith 集成
│   ├── ui/                    # 拟人化进度 UI
│   └── llm-client.ts          # LLM API 客户端
├── pageindex/                 # PageIndex 核心引擎
│   ├── book-indexer.ts        # 书籍索引编排
│   ├── book-search.ts         # 混合搜索（Vector + BM25）
│   ├── book-search-v2.ts      # 段落级搜索（L0/L1/L2）
│   ├── bm25.ts                # BM25 关键词检索
│   ├── parsers/               # 文档解析（PDF/EPUB/Markdown）
│   ├── exporters/             # Obsidian 导出
│   ├── vault/                 # 向量存储 + 索引引擎
│   │   ├── vectors.ts         # JSONL 向量存储
│   │   ├── compiler*.ts       # 编译器（章节重组、LLM 增强）
│   │   └── search*.ts         # 搜索引擎
│   └── llm/client.ts          # LLM 客户端（摘要/向量化）
├── services/                  # 业务服务
│   ├── reading-mode-service.ts # 阅读模式服务
│   ├── excerpt-service.ts     # 摘录服务
│   ├── context-manager.ts     # 上下文管理
│   └── excalidraw-service.ts  # Excalidraw 集成
├── settings/                  # 插件设置
├── api/                       # HTTP 客户端（LLM API）
├── types/                     # 类型定义
└── utils/                     # 工具函数
```

---

## 命令

```bash
# 开发
npm run dev          # 监听模式构建，在 Obsidian 中 Cmd+R 重载

# 构建
npm run build        # 完整构建（类型检查 + CSS + JS）

# 测试
npm run test:run     # Vitest 单元测试
npm run test         # Vitest 监听模式

# 部署到 test-vault
npm run deploy       # 构建并复制到 test-vault/.obsidian/plugins/deepreader/
```

---

## 调试

- **开发者工具**: Cmd+Option+I
- **插件实例**: `app.plugins.plugins['deepreader']`
- **测试 Vault**: `test-vault/` 目录
- **日志**: 使用 `utils/logger.ts` 的 `uiLog` / `serviceLog`

---

## Agent 系统（LangGraph）

### 认知层次

Agent 使用 LangGraph 实现四层认知模型（基于《如何阅读一本书》）：

| 层次 | 节点 | 功能 |
|------|------|------|
| S0 | Router | 意图路由（闲聊/检视/分析/主题） |
| S1 | Inspectional | 检视阅读（目录导航、结构概览） |
| S2 | Analytical | 分析阅读（ReAct 循环：搜索→阅读→推理） |
| S3 | Syntopical | 主题阅读（多书对比） |

### 工具集

```typescript
// 本地搜索工具
inspect_toc     // 查看目录结构
hybrid_search   // 混合搜索（Vector + BM25）
read_section    // 读取章节内容

// 其他工具
write_note      // 写笔记到 Obsidian
search_read_books // 跨书籍搜索
memory          // 记忆系统
canvas          // 生成 Canvas 可视化
```

### 关键文件

- `agent/graph/index.ts` - LangGraph 图定义
- `agent/router/intent-router.ts` - 意图路由
- `agent/tools/local/*.ts` - 本地工具实现
- `agent/memory/store.ts` - 记忆存储

---

## PageIndex 引擎

### 索引流程

```
PDF/EPUB → 解析 → 章节 → LLM 摘要 → 向量化 → BM25 + Vector 索引 → Obsidian 导出
```

### 搜索流程

```
Query → Embedding → Vector 搜索 → BM25 搜索 → 混合排序 → 结果
```

### 本地存储

- **索引目录**: `.pageindex/{bookId}/`
- **导出目录**: `DeepReader/{bookName}/`
- **封面目录**: `DeepReader/covers/`
- **存储文件**: `book-meta.json`, `bm25.json`, `vectors.jsonl`

---

## UI 组件

### 核心组件

| 组件 | 文件 | 功能 |
|------|------|------|
| SidebarView | `sidebar-view.ts` | 主侧边栏（对话 + 书籍选择） |
| AIMessage | `message/message.ts` | AI 消息气泡（信笺图案、最大化展示） |
| LibraryModal | `library-modal.ts` | 书库弹窗（索引卡片、进度显示） |
| ReadingModeService | `reading-mode-service.ts` | 分页阅读模式 |
| ReadingTopbar | `reading-topbar/` | 阅读顶栏（书籍封面 + 书名 + 作者） |

### 消息数据流

```
sidebar-view.ts → MessageList → AIMessage → 全屏展示（openFullscreen）
```

---

## Git 提交规范

```bash
<type>: <subject>

feat:     新功能
fix:      Bug 修复
refactor: 重构（不改变功能）
docs:     文档
test:     测试
perf:     性能优化
chore:    构建/工具
```

**重要**: 未经明确指示，不要自行提交代码。

---

## 开发注意事项

### 1. 类型检查

- 确保 `obsidian` 类型定义存在
- 使用 `// @ts-ignore` 时注明原因

### 2. 异步操作

- PageIndex API 全部异步，必须 `await`
- 流式输出使用 `AbortController` 控制

### 3. 文件路径

- PageIndex 需要绝对路径
- 使用 `vault.adapter.getFilePath(file)` 获取

### 4. UI 状态

- 流式消息用 `isStreaming` 标记
- 结束时必须调用 `onStreamingEnd()` 补充渲染

### 5. 记忆系统

- 记忆存储在 `agent/memory/store.ts`
- 里程碑记录在 `agent/memory/milestones.ts`
- 会话持久化在 `agent/session/store.ts`

---

## 测试策略

- **单元测试**: `src/**/__tests__/` （Vitest）
- **集成测试**: `tests/specs/` （WebdriverIO E2E）
- **重点覆盖**: PageIndex API、Agent Tools、搜索质量

---

## 相关文档

| 文档 | 位置 | 内容 |
|------|------|------|
| Agent 设计 | `docs/ARCHITECTURE-agent.md` | Agent 系统完整架构 |
| Agent 技术文档 | `docs/Agent对话模块技术文档.md` | 对话模块技术细节 |
| LangChain 重构 | `docs/LANGCHAIN-REFACTOR-WALKTHROUGH.md` | LangChain 集成指南 |
| 设计文档 | `docs/plans/` | 功能设计文档 |
| 系统提示词 | `docs/system-prompt-current.md` | 当前使用的 System Prompt |