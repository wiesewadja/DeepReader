# Agent 全景图：从用户输入到 UI 输出的完整旅程

> 本文档是 Agent 架构的入口导览。目标：让任何工程师/Agent 在 30 分钟内理解
> DeepReader Agent 是怎么「构建」出来的、一次完整对话是怎么「工作」的。
> 详细实现见子文档（每个段落末尾会标注）。

---

## 目录

1. [构建全景：Agent 由哪些零件组成](#构建全景agent-由哪些零件组成)
2. [工作流程：一次对话的端到端旅程](#工作流程一次对话的端到端旅程)
3. [关键设计决策（ADR 索引）](#关键设计决策adr-索引)
4. [子系统速查表](#子系统速查表)
5. [深入阅读](#深入阅读)

---

## 构建全景：Agent 由哪些零件组成

DeepReader Agent 是一个**分层可插拔**的认知系统。从外到内拆为 5 层：

```
┌─────────────────────────────────────────────────────────────────┐
│  L1  入口层：FrontendAgent                                       │
│      src/agent/index.ts                                         │
│      • 唯一对外 API：chat() / continueChat() / resumeGraphExecution() │
│      • 持有所有子系统实例：llmClientManager, memoryStore, ...    │
│      • 生命周期：initialize() → runGraphEngine() → destroy()    │
└────────────────────────┬────────────────────────────────────────┘
                         │ 依赖注入
┌────────────────────────▼────────────────────────────────────────┐
│  L2  上下文层：构建 System Prompt                                │
│      src/agent/context/                                         │
│      • ContextBuilder — 组装提示词（画像 + 记忆 + 技能 + 文档）   │
│      • ContextLoader  — 加载 Vault 文件 / 初始化 MEMORY.md       │
└────────────────────────┬────────────────────────────────────────┘
                         │ configurable 注入
┌────────────────────────▼────────────────────────────────────────┐
│  L3  认知引擎层：LangGraph StateGraph                            │
│      src/agent/graph/                                           │
│      • 4 个状态节点：S0 Router / S1 Inspectional /               │
│                       S2 Analytical / S4 Formatter              │
│      • ReAct 子图：S2 内部的工具调用循环                         │
│      • 边：routeByDepth / routeAfterInspectional                │
│      • 持久化：FileCheckpointer (JSONL)                          │
└────────────────────────┬────────────────────────────────────────┘
                         │ 工具调用
┌────────────────────────▼────────────────────────────────────────┐
│  L4  工具层：search_book / read_book_section / write_note / ... │
│      src/agent/tools/                                           │
│      • 10 个 LangChain StructuredTool                            │
│      • S2 只用其中 2 个（search_book, read_book_section）        │
│      • VISUALIZER 通过 excalidraw 工具生成图形                   │
│      • 实现位置：definitions/ (schema) + local/ (执行)           │
└────────────────────────┬────────────────────────────────────────┘
                         │ 数据源
┌────────────────────────▼────────────────────────────────────────┐
│  L5  数据层：PageIndex / Vault / MEMORY.md / JSONL Sessions     │
│      src/pageindex/ + src/agent/memory/ + src/agent/session/    │
│      • PageIndex — 已索引的书籍结构 + 内容                       │
│      • MEMORY.md / HISTORY.md — 用户长期记忆与里程碑              │
│      • JSONL Sessions — 单会话消息历史（追加写入 + LRU）          │
└─────────────────────────────────────────────────────────────────┘
```

**核心设计原则：**
- **唯一入口**：`FrontendAgent.chat()` 是 Agent 唯一调用点（CLAUDE.md 规定）
- **可测试性**：每一层都可以独立 mock 注入（参见 `tests/unit/agent/`）
- **本地优先**：所有数据在用户 Vault，无外部服务依赖（除 LLM API）

---

## 工作流程：一次对话的端到端旅程

以「用户问『第三章的核心论点是什么』」为例，追踪全流程。

### 阶段 1：用户输入与 Agent 初始化

**触发：** 用户在阅读视图中输入问题，点击发送。

**调用栈：**
```
UI 阅读视图 (Topbar/Sidebar/Reading)
  └─→ FrontendAgent.chat(userMessage, context, callbacks)
        ├─→ this.initialize() [L1 入口]
        │     ├─→ contextLoader.ensureDirectories()  // 确保 Vault/DeepReader/ 存在
        │     └─→ contextLoader.initializeMemoryFile()  // 首次创建 MEMORY.md
        │
        └─→ this.runGraphEngine(userMessage, context, callbacks) [L1 → L3]
```

**关键文件：**
- `src/agent/index.ts: FrontendAgent.chat()` 入口
- `src/agent/index.ts: initialize()` 资源初始化
- `src/agent/context/loader.ts` 文件系统准备

**此时状态：** Agent 已加载，所有子系统就绪。

---

### 阶段 2：构建 Graph 配置（configurable）

**调用栈：**
```
runGraphEngine()
  └─→ buildGraphConfigurable() [L1]
        ├─→ this.cachedModels = createChatModels(main, fast?)  [双模型]
        ├─→ memoryStore.getMemoryContext()  [读 MEMORY.md]
        ├─→ profileBuilder.readSummary()  [用户画像摘要]
        ├─→ summarizeRecentHistory(chatHistory, 3)  [最近 3 轮摘要]
        ├─→ extractPrevBlockIds(chatHistory)  [避免重复搜索]
        └─→ createSharedContext({...})  [打包到 configurable]
```

**关键文件：**
- `src/agent/models/chat-model.ts: createChatModels()` — 双模型
- `src/agent/memory/store.ts: getMemoryContext()` — 长期记忆注入
- `src/agent/graph/shared-context.ts: createSharedContext()` — 打包
- `src/agent/index.ts: buildGraphConfigurable()` 编排

**configurable 结构：**
```typescript
{
  thread_id: "thread-{bookId}-{timestamp}",
  fastModel: ChatOpenAI,        // S0/S1 用
  mainModel: ChatOpenAI,        // S2/S4 用
  sharedContext: SharedContext, // 上面所有上下文
  toolContext: ToolContext,     // 工具执行环境
  callbacks: EngineCallbacks,   // 流式回调
  enableHumanReview: boolean,   // HITL 开关
  ttsConfig?: VoiceConfig,      // 语音输出配置
  _langsmithTracer?: Tracer,    // 可选追踪
}
```

**设计意图：** 节点不直接读取全局状态，所有外部依赖通过 `config.configurable` 注入，便于测试和替换。

---

### 阶段 3：LangGraph 状态机执行

**调用栈：**
```
cognitiveEngine.stream(input, { configurable, signal })
  │
  ├─→ START → routerNode (S0)  [L3 状态机]
  │     ├─ fastModel.withStructuredOutput(RouterOutputSchema)
  │     ├─ 输出: { depth: 0|1|2|3, rewrittenQuery, reason }
  │     └─→ state.depth = 2（本例「第三章核心论点」= 分析阅读）
  │
  ├─→ routeByDepth(state) → 'inspectional' (depth=2)
  │
  ├─→ inspectionalNode (S1)  [L3 状态机]
  │     ├─ loadTreeJson(app, bookId, pdfName)  [L5 PageIndex]
  │     ├─ formatTreeStructure(outlineNodes)    [把树转 LLM 友好格式]
  │     ├─ fastModel.withStructuredOutput()
  │     └─→ state.scopeNodeIds = ['0003']  （锁定第三章）
  │
  ├─→ routeAfterInspectional(state) → 'continue' (depth=2)
  │
  ├─→ analyticalNode (S2)  [L3 状态机 + ReAct 子图]
  │     ├─ buildAnalyticalSystemPrompt(scopeNodeIds)
  │     ├─ runReactLoop(messages, config)  [子图]
  │     │     ├─ agentNode: mainModel.bindTools([search_book, read_book_section])
  │     │     │     → AIMessage(tool_calls=[{name:'search_book', args:{...}}])
  │     │     ├─ shouldContinue: 检查循环次数 / 重复查询
  │     │     ├─ enhancedToolNode: 调用 search_book  [L4 工具]
  │     │     │     → ToolMessage(content='<matched_blocks>...')
  │     │     ├─ agentNode: 基于工具结果再推理
  │     │     ├─ shouldContinue: 无 tool_calls → '__end__'
  │     │     └─→ { content, toolResults, iterations }
  │     └─→ state.analysisResult = '...第三章核心论点...'
  │
  ├─→ formatterNode (S4)  [L3 状态机]
  │     ├─ buildFormatterSystemPrompt(bookName, toolResults)
  │     ├─ mainModel.stream([system, user])  [流式输出]
  │     ├─ verifyAndCleanContent(content, toolResults)  [Self-Verification]
  │     │     └─ 移除不存在的 block_id 引用（[[文件#^ghost|别名]] → 别名）
  │     └─→ state.formattedOutput = '[[思辨与立场/...#^b3a1|管理的最终目的...]]'
  │
  └─→ END
```

**关键文件：**
- `src/agent/graph/index.ts: cognitiveEngine` — StateGraph 编译
- `src/agent/graph/nodes/router.ts` — S0
- `src/agent/graph/nodes/inspectional.ts` — S1
- `src/agent/graph/nodes/analytical.ts` — S2（含 ReAct）
- `src/agent/graph/nodes/formatter.ts` — S4
- `src/agent/graph/subgraphs/react-loop.ts` — ReAct 子图
- `src/agent/graph/edges.ts` — 条件边
- `src/agent/graph/utils/self-verification.ts` — S4 后处理

**此时状态：** LLM 已生成完整回复，stream processor 正在收集 chunks。

---

### 阶段 4：流式输出与 UI 渲染

**调用栈：**
```
processGraphStream(stream, callbacks)
  ├─ 监听 stream events
  ├─ onProgress / onContent / onReasoning 回调
  │     └─ UI 实时追加文本块（流式打字机效果）
  ├─ 检测 __interrupt__ 事件（HITL）
  │     └─ 显示「是否继续？」对话框
  └─ onComplete → 返回 { messages, interrupted? }

UI 阅读视图
  ├─ 监听 formattedOutput 增量
  ├─ 渲染 Markdown + Obsidian 双链
  ├─ 保存到 SessionStore.appendMessage()
  │     ├─ 追加到 .jsonl 文件
  │     └─ 异步生成语音（如果开启）
  └─ 后台累计画像（10 轮触发一次 profileBuilder 更新）
```

**关键文件：**
- `src/agent/graph/stream-processor.ts: processStream()` — 流处理
- `src/agent/session/store.ts: appendMessage()` — 持久化
- 阅读视图组件（`src/views/reading/`, `src/views/sidebar/`）

**此时状态：** 用户已看到完整回答，会话已持久化，记忆/画像后台累计。

---

### 阶段 5（可选）：HITL 恢复或主动触发

**HITL（Human-in-the-Loop）：**
- S2 完成后或 S4 完成前 `interrupt()` 暂停
- 用户选择「继续」或「反馈」→ `resumeGraphExecution(approved, feedback)`
- 恢复时用同一个 `thread_id` + 新的 `Command({ resume: ... })` 回到图执行

**主动触发（Proactive）：**
- 阅读视图在 `onBookOpen` / `onHighlight` / `onChapterLeave` 调用 ProactiveEngine
- 引擎判断触发条件 → 调 `runGraphEngine(mode='proactive')`
- depth 默认为 1（检视阅读），触发参数注入 `proactiveTrigger` 字段

**关键文件：**
- `src/agent/index.ts: resumeGraphExecution()` — HITL 恢复
- `src/agent/proactive/engine.ts` — 主动触发
- `src/agent/proactive/state.ts` — 触发状态持久化

---

## 关键设计决策（ADR 索引）

每个 ADR 解释「为什么」是这么设计的。读 ADR 是理解 Agent 架构的最快方式。

| ADR | 主题 | 何时读 |
|-----|------|--------|
| [ADR-001](../decisions/ADR-001-four-layer-reading.md) | 四层阅读法作为 Agent 认知架构 | 想知道为什么有 S0/S1/S2/S4 |
| [ADR-002](../decisions/ADR-002-local-first-no-backend.md) | 本地优先，纯前端，无后端 | 想知道数据存哪、为什么无后端 |
| [ADR-003](../decisions/ADR-003-langgraph-state-machine.md) | LangGraph 状态机作为 Agent 框架 | 想知道为什么用 LangGraph 而非纯 ReAct |
| [ADR-004](../decisions/ADR-004-hybrid-search-bm25-vector.md) | BM25 + 向量混合搜索 | 想知道搜索如何工作 |
| [ADR-005](../decisions/ADR-005-data-files-use-fs-not-vault-api.md) | 数据文件用 fs 直接读写 | 想知道为什么 MEMORY.md/JSONL 用 fs |
| [ADR-006](../decisions/ADR-006-dual-model-routing.md) | 双模型分层架构（main + fast） | 想知道为什么 S0/S1 用便宜模型 |
| [ADR-007](../decisions/ADR-007-memory-and-session-architecture.md) | MEMORY.md + JSONL 长期记忆与会话 | 想知道记忆与会话如何存储 |
| [ADR-008](../decisions/ADR-008-proactive-engine-design.md) | 主动引擎（Proactive Engine）设计 | 想知道为什么 Agent 会主动说话 |
| [ADR-009](../decisions/ADR-009-s2-multi-layer-early-stop.md) | S2 多层早停 | 想知道为什么 S2 会在多层级判断停止 |

---

## 子系统速查表

| 子系统 | 目录 | 关键文件 | 一句话职责 |
|--------|------|----------|-----------|
| 入口 | `src/agent/index.ts` | `FrontendAgent` | 唯一对外 API |
| LLM 客户端 | `src/agent/llm-client.ts`, `src/agent/models/` | `LLMClientManager`, `createChatModels` | 双模型管理 |
| 认知引擎 | `src/agent/graph/` | `cognitiveEngine`, `nodes/*.ts` | LangGraph 状态机 |
| 上下文构建 | `src/agent/context/` | `ContextBuilder` | 拼装 System Prompt |
| 工具系统 | `src/agent/tools/` | `definitions/`, `local/` | 9 个 LangChain 工具 |
| 长期记忆 | `src/agent/memory/` | `MemoryStore` | MEMORY.md 读写 + 压缩 |
| 会话历史 | `src/agent/session/` | `SessionStore` | JSONL 追加 + LRU 缓存 |
| 主动引擎 | `src/agent/proactive/` | `ProactiveEngine` | 章节事件触发器 |
| 意图路由 | `src/agent/router/` | `IntentRouter` | 快捷意图（与 LangGraph router 不同） |
| 追踪 | `src/agent/tracing/` | `getLangSmithTracer` | LangSmith 集成 |
| 数据层 | `src/pageindex/` | `book-indexer.ts`, `pageindex.ts` | PDF/EPUB 索引与检索 |

---

## 深入阅读

按学习路径推荐：

1. **先看**：`docs/architecture/agent-state-machine/` 目录（L0-L8 分层文档，从外部触发到基础设施逐层深入）
2. **配合**：本文档（旅程视角） + 9 个 ADR（决策视角）
3. **看代码**：`src/agent/index.ts: FrontendAgent`（入口） → `src/agent/graph/index.ts: cognitiveEngine`（状态机） → `src/agent/graph/nodes/*.ts`（各节点）
4. **看测试**：`tests/unit/agent/`（单元测试，演示如何 mock 各层）

**其他相关文档：**
- `docs/architecture/agent-state-machine/README.md` — L0-L8 文档索引
- `docs/architecture/书籍索引系统.md` — PageIndex 索引管线
- `docs/features/ai-dialogue.md` — AI 对话 UI 行为
- `docs/features/agent-tools.md` — 工具系统用户视角
- `docs/features/memory-observability.md` — 记忆与可观测性

---

## 变更日志

| 日期 | 变更 |
|------|------|
| 2026-06-04 | 初版：构建全景 + 工作流程 + ADR 索引 + 子系统速查 |
