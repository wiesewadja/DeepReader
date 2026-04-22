# DeepReader — AGENTS.md

> 本文档面向 AI Coding Agent。假设读者对项目一无所知，所有信息均基于实际代码和配置文件，不做推测。

---

## 项目概述

**DeepReader** 是一个 Obsidian 桌面端插件，提供 PDF/EPUB 的深度阅读、智能索引、语义搜索和 AI 对话功能。

- **定位**: 纯前端插件，无需后端服务器，所有索引和搜索在本地完成。
- **核心能力**:
  - 解析 PDF/EPUB，生成结构化 Markdown 笔记并导出到 Obsidian Vault。
  - 本地混合搜索（BM25 + 向量语义搜索）。
  - 内置 AI Agent（FrontendAgent），基于 LangGraph 实现四层认知状态机（检视阅读 / 分析阅读 / 主题阅读），支持与书籍内容的智能问答。
- **语言环境**: 项目注释、文档、UI 文案以中文为主，代码标识符使用英文。

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 语言 | TypeScript 5.x | 目标 ES6，模块 ESNext，启用 `strictNullChecks` |
| 运行时 | Electron (Obsidian) | 桌面端 only，`isDesktopOnly: true` |
| 构建 | esbuild 0.19 | 打包 `src/main.ts` → `bin/main.js` (CJS, es2018) |
| 样式 | 原生 CSS | 源文件在 `src/styles/`，通过自定义脚本打包为 `bin/styles.css` |
| Agent 框架 | LangGraph + LangChain | `@langchain/core`、`@langchain/langgraph`、`@langchain/openai` |
| LLM 接入 | OpenAI 兼容 API | 支持 DeepSeek、Kimi、智谱、SiliconFlow、OpenAI 等 |
| 测试 (单元) | Vitest 1.x | `jsdom` 环境，单线程线程池 |
| 测试 (E2E) | WebdriverIO 9.x + `wdio-obsidian-service` | 在真实 Obsidian 实例中测试，超时 10 分钟 |
| 其他依赖 | `pdf-parse`、`turndown`、`xml2js`、`adm-zip`、`uuid`、`zod` | 文档解析与工具库 |

---

## 项目结构

```
src/
├── main.ts                      # 插件入口（DeepPDFPlugin），注册命令、视图、事件
├── views/
│   └── sidebar-view.ts          # 主侧边栏视图（对话界面、书籍选择）
├── components/                  # UI 组件（纯 TypeScript + DOM，无 React/Vue）
│   ├── chat-input/              # 聊天输入框
│   ├── message/                 # AI/用户消息气泡
│   ├── message-list/            # 消息列表 + 问题导航 minimap
│   ├── reading-mode/            # 分页阅读模式（章节导航、高亮、摘录）
│   ├── library-modal/           # 书库弹窗（索引卡片、进度）
│   └── ...
├── agent/                       # FrontendAgent AI 系统
│   ├── index.ts                 # 主入口（FrontendAgent 类）
│   ├── graph/                   # LangGraph 认知引擎
│   │   ├── index.ts             # StateGraph 编译（S0→S1→S2/S3→S4）
│   │   ├── nodes/               # router / inspectional / analytical / syntopical / formatter
│   │   ├── prompts/             # 各节点 System Prompt
│   │   ├── subgraphs/           # ReAct 循环子图
│   │   ├── checkpointer.ts      # 基于 Vault 文件的 JSONL 持久化
│   │   └── state.ts             # LangGraph Annotation 状态定义
│   ├── tools/                   # 工具集
│   │   ├── local/               # 本地搜索工具（search_text, read_section）
│   │   ├── definitions/         # 供 LLM 选择的工具定义
│   │   └── *.ts                 # write_note, canvas, excalidraw, memory 等
│   ├── router/                  # 意图路由器（闲聊/检视/分析/主题）
│   ├── memory/                  # 记忆系统（store + consolidator + milestones）
│   ├── session/                 # 会话持久化（JSONL）
│   ├── skills/                  # Skill 加载器（从 Vault 读取 Markdown Skill）
│   ├── context/                 # 用户上下文构建（MEMORY.md、书籍元数据）
│   ├── models/                  # ChatModel 封装
│   ├── tracing/                 # LangSmith / Langfuse 追踪
│   └── llm-client.ts            # LLM API 客户端管理
├── pageindex/                   # PageIndex 本地索引引擎
│   ├── pageindex.ts             # 核心类（PDF/EPUB 解析、TOC、LLM 摘要）
│   ├── node.ts                  # Node.js / Electron 兼容入口（不含 Bun 特性）
│   ├── book-indexer.ts          # 书籍索引编排（生成 bookId、调用解析器）
│   ├── book-search.ts           # 混合搜索（Vector + BM25 Fusion）
│   ├── book-search-v2.ts        # 段落级分层搜索（L0/L1/L2）
│   ├── bm25.ts                  # BM25 关键词检索实现
│   ├── parsers/                 # 文档解析器（pdf.ts, epub.ts, markdown.ts, ocr.ts）
│   ├── exporters/               # Obsidian Markdown 导出
│   ├── vault/                   # 向量存储、索引引擎、编译器、搜索引擎
│   └── llm/client.ts            # PageIndex 专用 LLM 客户端
├── services/                    # 业务服务
│   ├── reading-mode-service.ts  # 阅读模式生命周期管理
│   ├── excerpt-service.ts       # 摘录/高亮保存服务
│   └── excalidraw-service.ts    # Excalidraw 插件集成
├── config/                      # 配置类型、迁移、模型提供商定义
├── settings/                    # 插件设置面板 UI
├── api/                         # HTTP 客户端（fetch 封装、请求管理）
├── types/                       # 全局类型定义
├── utils/                       # 工具函数（日志、错误处理、图标、时间）
└── built-in-skills.ts           # 内置 Skill 定义（启动时同步到 Vault）
```

### 构建产物

- `bin/main.js` — esbuild 打包的插件主文件（CJS）。
- `bin/styles.css` — 从 `src/styles/main.css` 递归 `@import` 合并后的样式。
- `bin/manifest.json` — 从 `package.json` 同步版本号生成的 Obsidian 插件清单。

---

## 构建与开发命令

```bash
# 安装依赖
npm install

# 开发模式（esbuild watch，监听文件变化）
npm run dev

# 完整构建（类型检查 tsc -noEmit + CSS 打包 + JS 打包）
npm run build

# 同步版本号（package.json → manifest.json）
npm run sync-version

# 打包 CSS
npm run copy-css

# 部署到测试 Vault（构建后复制到 test-vault/.obsidian/plugins/deepreader/）
npm run deploy
```

**开发 workflow**:
1. `npm run dev` 启动 watch。
2. 在 Obsidian 中打开 `test-vault/`。
3. 修改代码后，在 Obsidian 中按 `Cmd+R` 重载插件。

---

## 测试策略

### 单元测试 / 集成测试（Vitest）

```bash
# 监听模式
npm run test

# 单次运行
npm run test:run

# UI 界面
npm run test:ui
```

- **配置**: `vitest.config.ts`
- **环境**: `jsdom`，`globals: true`
- **Setup**: `tests/setup.ts` — 在 `HTMLElement.prototype` 上挂载 Obsidian 的 DOM 扩展方法（`addClass`、`createEl`、`empty` 等）。
- **Mock**: `tests/__mocks__/obsidian.ts` 提供 `TFile`、`TFolder`、`App`、`Notice` 等 Mock。
- **路径别名**: `@` → `./src`，`@tests` → `./tests`，`obsidian` → `./tests/__mocks__/obsidian.ts`
- **排除项**: `tests/components/message.test.ts`、`tests/views/sidebar-view.test.ts`、`src/api/__tests__/server-manager.test.ts`（引用了已移除组件或需要重构）。

**测试文件位置**:
- `src/**/__tests__/**/*.test.ts` — 与源码同目录的测试（Agent、PageIndex、Config、Components）。
- `tests/components/*.test.ts` — 组件测试。
- `tests/views/*.test.ts` — 视图测试。

### E2E 测试（WebdriverIO）

```bash
# 运行 E2E 测试（需要 Obsidian 已安装并通过 wdio-obsidian-service 启动）
npx wdio run wdio.conf.ts
```

- **配置**: `wdio.conf.ts`
- **测试文件**: `tests/specs/**/*.e2e.ts`
- **Obsidian 选项**: 使用 `./test-vault` 作为 Vault，`./bin` 作为插件目录。
- **超时**: 10 分钟（LLM 摘要多章节耗时较长）。
- **缓存目录**: `.obsidian-cache/`（安装器、Obsidian 应用、版本信息）。

---

## 代码风格与规范

### TypeScript

- **编译目标**: ES6（`tsconfig.json`），esbuild target `es2018`。
- **模块**: ESNext，`isolatedModules: true`。
- **严格检查**: `noImplicitAny`, `strictNullChecks`。
- **类型检查**: 构建时通过 `tsc -noEmit -skipLibCheck` 检查。
- **源码映射**: `inlineSourceMap` + `inlineSources`（开发模式）。

### 注释风格

- 使用中文注释描述业务逻辑和复杂算法。
- JSDoc 用于公共 API 和类型说明。

### Git 提交规范

```
<type>: <subject>

feat:     新功能
fix:      修复 bug
refactor: 重构（不改变功能）
docs:     文档更新
test:     测试相关
perf:     性能优化
chore:    构建/工具链相关
```

**未经明确指示，不要自行提交代码。**

---

## 关键架构约定

### 1. 日志系统

- 统一使用 `src/utils/logger.ts`。
- 按模块分类：`agentLog`、`toolsLog`、`contextLog`、`uiLog`、`serviceLog`、`apiLog`。
- 通过 `setLogEnabled(true/false)` 控制全局开关，受插件设置 `enableDebugLog` 控制。
- 错误日志（`log.error`）始终输出，不受开关影响。

### 2. 文件路径与 Vault API

- 所有 Vault 文件操作通过 `app.vault.adapter` 或 `app.vault` API 进行。
- PageIndex 需要文件绝对路径；在 Obsidian 中通过 `vault.adapter.getBasePath()` 获取 Vault 根目录后拼接。
- 插件在 Vault 中创建的目录:
  - `DeepReader/` — 导出书籍、封面、调试文件。
  - `DeepReader/skills/` — 内置 Skill 文件。
  - `.pageindex/{bookId}/` — 索引数据（`book-meta.json`、`bm25.json`、`vectors.jsonl` 等）。

### 3. Agent 执行模型

- **唯一执行路径**: `FrontendAgent.chat()` → `runGraphEngine()` → LangGraph `stream()`。
- 认知状态机（S0-S4）基于 Adler《如何阅读一本书》:
  - S0 Router: 意图路由 + 查询重写（fast 模型）。
  - S1 Inspectional: 目录扫描 + 范围锁定（fast 模型）。
  - S2 Analytical: 深度分析 + ReAct 工具循环（main 模型）。
  - S3 Syntopical: 主题阅读 / 多书融合（main 模型）。
  - S4 Formatter: 格式化输出 + 自校验（main 模型）。
- 支持 Human-in-the-Loop（HITL）中断与恢复（`resumeGraphExecution`）。
- Checkpointer: `FileCheckpointer`（JSONL 持久化到 Vault）或 `MemorySaver`（内存，测试用）。

### 4. Skill 系统

- Skills 是带有 frontmatter 的 Markdown 文件，存放在 Vault 的 `DeepReader/skills/`。
- 内置 Skills 定义在 `src/built-in-skills.ts`，插件启动时自动同步到 Vault（仅创建不覆盖）。
- Skill 通过 `SkillLoader` 加载，在 System Prompt 中作为 XML Summary 注入。

### 5. 设置与配置迁移

- 设置类型: `src/config/settings.ts`（`DeepPDFSettings`）。
- 采用两层架构: `providers`（服务商账号） + `roles`（角色配置: chat / router / pageindex / proposition / embedding / reranker）。
- 旧版字段仍保留以兼容迁移逻辑（`config/settings-migrator.ts`）。
- 修改设置后需调用 `plugin.saveSettings()` 持久化。

### 6. UI 组件规范

- 不使用前端框架（React/Vue/Svelte），全部使用原生 DOM API + Obsidian 的 `createEl` 风格。
- 组件通常在 `index.ts` 中导出，主逻辑在同名 `.ts` 文件中。
- 流式消息使用 `isStreaming` 标记，结束时必须调用 `onStreamingEnd()` 完成渲染。

---

## 安全与隐私

- **纯本地架构**: 索引、搜索、向量存储全部在本地完成，不依赖外部后端服务。
- **API Key 存储**: LLM API Key 存储在 Obsidian 的 `data.json` 中（本地文件），不传输到任何第三方服务器（除目标 LLM API 端点外）。
- **网络请求**: 仅向用户配置的 LLM API Base URL 发送请求（OpenAI 兼容格式）。
- **敏感文件排除**: `.env` 等敏感文件受工具保护，不会被读取。
- **插件权限**: 需要桌面端（`isDesktopOnly: true`），因为依赖 Node.js 模块（`path`、`fs` 等）进行文件解析。

---

## 开发注意事项

1. **Node.js 兼容**: `src/pageindex/node.ts` 是 Electron/Node.js 兼容入口，排除了 Bun 特有的 Vault 索引功能。在 Obsidian 中始终通过 `node.ts` 导入 PageIndex。
2. **esbuild external**: `obsidian`、`electron`、CodeMirror 相关包、`builtin-modules`、`node:*` 模块均标记为 external，不参与打包。
3. **PDF 解析特殊处理**: esbuild banner 中注入代码，设置 `window.PDFJS.disableWorker = true` 并 polyfill `require.ensure`，以兼容 Electron 环境。
4. **异步操作**: PageIndex API 全部异步，必须 `await`；流式输出使用 `AbortController` 控制取消。
5. **测试环境**: `tests/setup.ts` 会修改全局 `HTMLElement.prototype`，运行测试时确保 `jsdom` 环境已初始化。

---

## 相关文档

| 文档 | 位置 |
|------|------|
| Agent 架构 | `docs/ARCHITECTURE-agent.md` |
| LangChain 重构指南 | `docs/LANGCHAIN-REFACTOR-WALKTHROUGH.md` |
| 设计文档集 | `docs/plans/` |
| 系统提示词（当前） | `docs/system-prompt-current.md` |
| README | `README.md` |
| CLAUDE.md | `CLAUDE.md` |
