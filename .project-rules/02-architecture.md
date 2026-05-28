# 目录结构与架构约定

## 项目结构

```
src/
├── main.ts                      # 插件入口（DeepPDFPlugin），注册命令、视图、事件
├── views/
│   ├── sidebar-view.ts          # 主侧边栏视图（对话界面、书籍选择）
│   ├── library-view.ts          # 书库视图（PDF/EPUB 管理 + Z-Library 下载）
│   └── zlibrary-search-modal.ts # Z-Library 搜索弹窗
├── components/                  # UI 组件（纯 TypeScript + DOM，无 React/Vue）
│   ├── chat-input/              # 聊天输入框
│   ├── message/                 # AI/用户消息气泡
│   ├── message-list/            # 消息列表 + 问题导航 minimap
│   ├── reading-mode/            # 分页阅读模式（章节导航、高亮、摘录）
│   ├── question-minimap/        # 问题快速导航
│   ├── reading-topbar/          # 阅读顶栏（封面、书名、作者）
│   ├── agent-mode-toggle/       # Agent 模式切换
│   ├── chat-settings-modal/     # 聊天设置弹窗
│   ├── context-tags/            # 上下文标签
│   ├── file-suggest/            # 文件建议
│   ├── excerpt/                 # 摘录组件（摘录弹窗、选择菜单）
│   ├── confirm-modal/           # 通用确认弹窗
│   ├── top-nav/                 # 顶部导航
│   └── ...                      # 其他 UI 组件
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
├── weread/                      # 微信读书集成
│   ├── index.ts                 # WereadService 服务入口
│   ├── api/client.ts           # 微信读书 API 客户端
│   ├── api/shelf.ts            # 书架 API
│   ├── auth/unmatched-modal.ts # 未匹配书籍弹窗
│   ├── sync/                   # 同步引擎
│   │   ├── sync-engine.ts      # 同步编排
│   │   ├── state.ts            # 同步状态管理
│   │   ├── matcher.ts          # 书籍匹配
│   │   ├── highlight-importer.ts # 高亮导入
│   │   ├── mapping-stats.ts    # 映射统计
│   │   └── diff.ts             # 差异计算
│   ├── render/                 # 渲染器
│   │   ├── markdown-renderer.ts # Markdown 渲染
│   │   └── frontmatter.ts      # Frontmatter 生成
│   └── utils/                  # 工具函数
├── config/                      # 配置类型、迁移、模型提供商定义
│   ├── settings.ts              # DeepPDFSettings
│   └── features.ts              # 功能开关（ZLIBRARY_ENABLED 等）
├── settings/                    # 插件设置面板 UI
│   └── sections/                # 设置 Tab 页面
│       └── weread-section.ts    # 微信读书/高级设置 Tab
├── services/                    # 业务服务
│   ├── reading-mode-service.ts  # 阅读模式生命周期管理
│   ├── excerpt-service.ts       # 摘录/高亮保存服务
│   ├── excalidraw-service.ts    # Excalidraw 插件集成
│   └── mineru-api.ts           # MinerU PDF 解析 API 客户端
├── ui/                         # 通用 UI 组件
├── assets/                     # 静态资源（图标等）
├── e2e/                        # E2E 测试配置
├── zlibrary/                    # Z-Library 集成（默认关闭）
│   ├── client.ts               # Z-Library API 客户端
│   ├── build-client.ts         # 构建查询请求
│   ├── types.ts                # 类型定义
│   ├── errors.ts               # 错误类型
│   ├── constants.ts            # 常量
│   ├── cookie-jar.ts           # Cookie 管理
│   └── DISCLAIMER.ts           # 法律免责声明
├── api/                         # HTTP 客户端（fetch 封装、请求管理）
├── types/                       # 全局类型定义
├── utils/                       # 工具函数（日志、错误处理、图标、时间）
└── built-in-skills.ts           # 内置 Skill 定义（启动时同步到 Vault）
```

### 构建产物

- `bin/main.js` — esbuild 打包的插件主文件（CJS）。
- `bin/styles.css` — 从 `src/styles/main.css` 递归 `@import` 合并后的样式。
- `bin/manifest.json` — 从 `package.json` 同步版本号生成的 Obsidian 插件清单。

## AI Agent（LangGraph）

### 认知层次

Agent 使用 LangGraph 实现四层认知模型（基于《如何阅读一本书》）：

| 层次 | 节点 | 功能 |
|------|------|------|
| S0 | Router | 意图路由 + 查询重写（fast 模型） |
| S1 | Inspectional | 检视阅读（目录导航、结构概览）（fast 模型） |
| S2 | Analytical | 分析阅读（ReAct 循环：搜索→阅读→推理）（main 模型） |
| S3 | Syntopical | 主题阅读（多书对比）（main 模型） |
| S4 | Formatter | 格式化输出 + 自校验（main 模型） |

### 工具集

```
inspect_toc      // 查看目录结构
hybrid_search    // 混合搜索（Vector + BM25）
read_section     // 读取章节内容
write_note       // 写笔记到 Obsidian
search_read_books // 跨书籍搜索
memory           // 记忆系统
canvas           // 生成 Canvas 可视化
```

### 关键架构约定

1. **唯一执行路径**: `FrontendAgent.chat()` → `runGraphEngine()` → LangGraph `stream()`。
2. **HITL**: 支持 Human-in-the-Loop 中断与恢复（`resumeGraphExecution`）。
3. **Checkpointer**: `FileCheckpointer`（JSONL 持久化到 Vault）或 `MemorySaver`（内存，测试用）。

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

## Skill 系统

- Skills 是带有 frontmatter 的 Markdown 文件，存放在 Vault 的 `DeepReader/skills/`。
- 内置 Skills 定义在 `src/built-in-skills.ts`，插件启动时自动同步到 Vault（仅创建不覆盖）。
- Skill 通过 `SkillLoader` 加载，在 System Prompt 中作为 XML Summary 注入。

## 设置与配置

- 设置类型: `src/config/settings.ts`（`DeepPDFSettings`）。
- 采用两层架构: `providers`（服务商账号） + `roles`（角色配置: chat / router / pageindex / proposition / embedding / reranker）。
- 旧版字段仍保留以兼容迁移逻辑（`config/settings-migrator.ts`）。
- 修改设置后需调用 `plugin.saveSettings()` 持久化。

## 微信读书集成

### 同步流程

```
微信读书 API → 拉取书架 → 书籍匹配 → 同步笔记/高亮/评论 → 关联本地书籍
```

### 核心功能

| 功能 | 说明 |
|------|------|
| 账号绑定 | 通过 API Key 连接微信读书账号 |
| 全量同步 | 同步书架所有书籍的标注、笔记、评论 |
| 增量同步 | 仅同步自上次同步以来变化的内容 |
| 书籍匹配 | 自动匹配微信读书书籍与本地 PDF/EPUB（书名+作者） |
| 高亮导入 | 将微信读书标注导入已关联书籍的章节文件 |
| 进度同步 | 同步阅读进度和阅读时长统计 |

### 本地存储

- **同步状态**: `.pageindex/weread/sync-state.json`
- **书籍映射**: `.pageindex/weread/mapping.json`
- **配置**: 存储在插件 settings 中的 `wereadApiKey`

## Z-Library 集成

### 双开关设计

Z-Library 功能采用编译时 + 运行时双重开关：

| 开关 | 位置 | 默认值 | 作用 |
|------|------|--------|------|
| `ZLIBRARY_ENABLED` | `src/config/features.ts` | `true` | 编译时控制是否将 Z-Library 代码编译进插件 |
| `enableZlibrary` | `src/config/settings.ts` | `false` | 运行时控制用户是否可使用 Z-Library |

### 法律声明

用户首次启用 Z-Library 功能前需阅读并同意法律警告（`src/zlibrary/DISCLAIMER.ts`）。

### 集成点

- `src/views/library-view.ts` — `proceedZlibDownload()` 双重检查
- `src/views/zlibrary-search-modal.ts` — Z-Library 搜索 UI
- `src/config/settings.ts` — `enableZlibrary` 设置项
- `src/settings/sections/weread-section.ts` — 启用开关 + 免责声明弹窗

## 第三方服务抽象

### MinerU PDF 解析

`src/services/mineru-api.ts` 的 `MineruClient` 支持自定义 API 端点：

```typescript
const client = new MineruClient(token, {
  agentBaseUrl: 'https://custom-agent-api.com',
  precisionBaseUrl: 'https://custom-precision-api.com'
});
```

### OCR

`src/pageindex/parsers/ocr.ts` 的 `ocrImage()` 支持自定义 OCR API 端点：

```typescript
const text = await ocrImage(imagePath, {
  apiKey: 'your-api-key',
  baseUrl: 'https://custom-ocr-api.com/api/paas/v4'
});
```
