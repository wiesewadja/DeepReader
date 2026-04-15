# DeepReader Agent 架构文档

> 基于 Adler《如何阅读一本书》的认知状态机，使用 LangGraph StateGraph 实现工具调用的 Agent 循环。

---

## 目录

1. [架构概览](#架构概览)
2. [核心组件](#核心组件)
3. [执行流程](#执行流程)
4. [LangGraph 认知引擎](#langgraph-认知引擎)
5. [工具系统](#工具系统)
6. [数据流](#数据流)
7. [追踪与可观测性](#追踪与可观测性)
8. [文件结构](#文件结构)

---

## 架构概览

### 单引擎架构

DeepReader 使用 **LangGraph** 作为唯一的认知引擎实现：

| 层级 | 实现 | 技术栈 |
|------|------|--------|
| **入口** | FrontendAgent | TypeScript + LangGraph |
| **LLM 客户端** | ChatOpenAI | @langchain/openai |
| **状态机** | StateGraph | @langchain/langgraph |
| **工具调用** | ReAct Subgraph | LangGraph + StructuredToolInterface |
| **Checkpoint** | FileCheckpointer | JSONL 文件持久化 |
| **追踪** | LangSmith | langsmith/client |

### 认知状态机 (S0-S4)

基于 Adler 阅读方法论的四层认知状态：

| 状态 | 名称 | 模型 | 功能 |
|------|------|------|------|
| **S0** | Router | fast | 深度分类 + 查询重写 |
| **S1** | Inspectional | fast | 目录扫描 + 范围锁定 |
| **S2** | Analytical | main | 深度分析 + 工具调用 |
| **S4** | Formatter | main | 格式化输出 + Self-Verification |

```
用户查询 → S0 Router → 深度分类
                         ↓
          depth=0 ───────────────→ S4 Formatter → END
          depth=1 ─→ S1 Inspectional → S4 Formatter → END
          depth=2 ─→ S2 Analytical → S4 Formatter → END
          depth=3 ─→ (降级为 depth=2)
```

---

## 核心组件

### 1. FrontendAgent (主入口)

**文件:** `src/agent/index.ts`

**职责:**
- 管理 ChatModel (ChatOpenAI via LangChain)
- 加载 Skills
- 构建 System Prompt
- 编译并执行 LangGraph StateGraph
- 处理 Human-in-the-Loop (HITL) 中断恢复

**关键方法:**

```typescript
class FrontendAgent {
  // 主入口（唯一执行路径）
  async chat(userMessage, context, callbacks): Promise<ChatMessage[]>
  async continueChat(history, userMessage, context, callbacks): Promise<ChatMessage[]>
  
  // LangGraph 执行
  async runGraphEngine(userMessage, context, callbacks): Promise<{ messages, interrupted? }>
  async resumeGraphExecution(approved, feedback, context, callbacks): Promise<{ messages, interrupted? }>
}
```

**内部实现:**

```typescript
async chat(userMessage, context, callbacks) {
  const result = await this.runGraphEngine(userMessage, context, callbacks);
  return result.messages;
}
```

### 2. SharedContext (运行时上下文)

**文件:** `src/agent/graph/shared-context.ts`

**职责:**
- 通过 `config.configurable` 传递给 LangGraph 节点
- 持有运行时数据和引擎依赖

```typescript
interface SharedContext {
  // 输入
  rawUserQuery: string
  chatHistory: ChatMessage[]
  
  // S0 输出
  depth: ReadingDepth        // 0 | 1 | 2 | 3
  
  // S1 输出
  scopeNodeIds?: string[]    // 范围锁定的章节
  tocSummary?: string
  betterQuestion?: string
  
  // S2 输出
  analysisResult?: string
  s2ToolResults?: ToolResultRecord[]
  
  // 运行时
  indexId: string
  pdfName: string
  markdownFiles?: Record<string, string>
  docDescription?: string
  memoryContext?: string
  
  // 引擎依赖
  llmClientManager?: LLMClientManager
  toolContext?: ToolContext
}
```

### 3. CognitiveEngineState (LangGraph 状态)

**文件:** `src/agent/graph/state.ts`

**职责:**
- LangGraph StateGraph 的状态定义
- 使用 Annotation 定义 reducer 语义

```typescript
const CognitiveEngineAnnotation = Annotation.Root({
  // Messages (append reducer)
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  
  // S0 Router 输出 (overwrite)
  depth: Annotation<number>(),
  rewrittenQuery: Annotation<string>(),
  
  // S1 Inspectional 输出 (overwrite)
  tocSummary: Annotation<string>(),
  scopeNodeIds: Annotation<string[]>(),
  betterQuestion: Annotation<string>(),
  structuralAnalysis: Annotation<string>(),
  
  // S2 Analytical 输出 (overwrite)
  analysisResult: Annotation<string>(),
  toolResultsSnapshot: Annotation<ToolResultSnapshot[]>(),
  
  // S4 Formatter 输出 (overwrite)
  formattedOutput: Annotation<string>(),
  
  // Runtime (overwrite)
  bookId: Annotation<string>(),
  pdfName: Annotation<string>(),
});
```

### 4. ChatModels (LLM 客户端)

**文件:** `src/agent/models/chat-model.ts`

**职责:**
- 创建 main/fast 双模型实例
- 使用 ChatOpenAI (LangChain) 替代手写 SSE

```typescript
interface ChatModels {
  main: ChatOpenAI;   // S2 Analytical + S4 Formatter
  fast: ChatOpenAI;   // S0 Router + S1 Inspectional
}

function createChatModels(main: ModelConfig, fast?: ModelConfig): ChatModels {
  const mainModel = new ChatOpenAI({
    openAIApiKey: main.apiKey,
    configuration: { baseURL: main.baseUrl },
    model: main.model,
    streaming: true,
    temperature: 0.3,
  });
  
  const fastModel = fast
    ? new ChatOpenAI({
        openAIApiKey: fast.apiKey,
        configuration: { baseURL: fast.baseUrl },
        model: fast.model,
        streaming: true,
        temperature: 0.1,
      })
    : mainModel;
  
  return { main: mainModel, fast: fastModel };
}
```

---

## 执行流程

### 完整执行流程

```
FrontendAgent.chat(userMessage, context, callbacks)
  │
  └─→ runGraphEngine(userMessage, context, callbacks)
        │
        ├─→ buildGraphConfigurable()
        │     ├─→ createChatModels() → { main, fast }
        │     ├─→ createSharedContext()
        │     └─→ getLangSmithTracer() (可选)
        │
        └─→ cognitiveEngine.stream({ messages, bookId, pdfName }, { configurable })
              │
              ├─→ START → routerNode (S0)
              │     └─→ fastModel.withStructuredOutput(RouterOutputSchema)
              │     └─→ 输出: { depth, rewrittenQuery }
              │
              ├─→ routeByDepth(state)
              │     ├─ depth=0 → formatterNode → END
              │     ├─ depth=1 → inspectionalNode → formatterNode → END
              │     └─ depth=2 → analyticalNode → formatterNode → END
              │
              ├─→ inspectionalNode (S1) [depth=1 或 depth=2]
              │     ├─→ loadTreeJson() → 目录结构
              │     └─→ fastModel.withStructuredOutput(InspectionalOutputSchema)
              │     └─→ 输出: { scopeNodeIds, tocSummary, betterQuestion }
              │
              ├─→ analyticalNode (S2) [depth=2]
              │     ├─→ 累积保证: 若 scopeNodeIds 空，先执行 S1
              │     ├─→ runReactLoop() → ReAct 子图
              │     ├─→ HITL: interrupt() (可选)
              │     └─→ 输出: { analysisResult, toolResultsSnapshot }
              │
              ├─→ formatterNode (S4)
              │     ├─→ mainModel.stream() → 流式输出
              │     ├─→ verifyAndCleanContent() → Self-Verification
              │     ├─→ HITL: interrupt() (可选)
              │     └─→ 输出: { formattedOutput }
              │
              └─→ END
                    │
                    └─→ processGraphStream() → { messages, interrupted? }
```

---

## LangGraph 认知引擎

### StateGraph 结构

**文件:** `src/agent/graph/index.ts`

```typescript
const workflow = new StateGraph(CognitiveEngineAnnotation)
  .addNode('router', routerNode)           // S0
  .addNode('inspectional', inspectionalNode) // S1
  .addNode('analytical', analyticalNode)    // S2
  .addNode('formatter', formatterNode)      // S4
  .addEdge(START, 'router')
  .addConditionalEdges('router', routeByDepth, {
    formatter: 'formatter',
    inspectional: 'inspectional',
  })
  .addConditionalEdges('inspectional', routeAfterInspectional, {
    continue: 'analytical',
    done: 'formatter',
  })
  .addEdge('analytical', 'formatter')
  .addEdge('formatter', END);
```

### 条件边逻辑

**文件:** `src/agent/graph/edges.ts`

```typescript
function routeByDepth(state): string {
  if (state.depth === 0) return 'formatter';  // 日常闲聊 → 直接输出
  if (state.depth === 1) return 'inspectional'; // 检视阅读
  return 'analytical';                          // 分析阅读 (depth=2)
}

function routeAfterInspectional(state): string {
  if (state.depth <= 1 && state.structuralAnalysis) return 'done';
  return 'continue';
}
```

### S0: Router Node

**文件:** `src/agent/graph/nodes/router.ts`

**职责:**
- 使用 fast 模型分类阅读深度
- 重写查询为独立形式

**实现:**

```typescript
async function routerNode(state, config) {
  const fastModel = config.configurable?.fastModel;
  
  // withStructuredOutput 确保可靠 JSON 解析
  const router = fastModel.withStructuredOutput(RouterOutputSchema);
  const result = await router.invoke([
    { role: 'system', content: PROMPT_S0_ROUTER },
    { role: 'user', content: buildRouterUserMessage(...) },
  ]);
  
  // depth=3 (主题阅读) 降级为 depth=2
  const effectiveDepth = result.depth >= 3 ? 2 : result.depth;
  
  return {
    depth: effectiveDepth,
    rewrittenQuery: result.standalone_query || rawQuery,
  };
}
```

### S1: Inspectional Node

**文件:** `src/agent/graph/nodes/inspectional.ts`

**职责:**
- 加载 tree.json 目录结构
- 锁定章节范围 (scopeNodeIds)
- 生成 TOC 摘要和改进问题

**实现:**

```typescript
async function inspectionalNode(state, config) {
  // 1. 加载 tree.json
  const outlineNodes = await loadTreeJson(toolContext.app, state.bookId, state.pdfName);
  
  // 2. 格式化目录结构
  const treeText = formatTreeStructure(outlineNodes);
  
  // 3. 调用 fast 模型
  const router = fastModel.withStructuredOutput(InspectionalOutputSchema);
  const result = await router.invoke([
    new SystemMessage(buildInspectionalSystemPrompt(treeText, ...)),
    new HumanMessage(buildInspectionalUserMessage(state.rewrittenQuery, state.depth)),
  ]);
  
  return {
    scopeNodeIds: result.scopeNodeIds ?? [],
    tocSummary: result.tocSummary ?? '',
    betterQuestion: result.better_question ?? state.rewrittenQuery,
    structuralAnalysis: result.structural_analysis ?? '',
  };
}
```

### S2: Analytical Node + ReAct Subgraph

**文件:** `src/agent/graph/nodes/analytical.ts`, `src/agent/graph/subgraphs/react-loop.ts`

**职责:**
- 累积保证：若 scopeNodeIds 空，先执行 S1
- ReAct 循环：工具调用 + 循环检测 + 强制结论
- Self-Verification：清理幽灵 block_id

**ReAct Subgraph 流程:**

```
runReactLoop(messages, config)
  │
  ├─→ agentNode: model.bindTools(tools).invoke(messages)
  │     └─→ 输出: AIMessage (含 tool_calls)
  │
  ├─→ shouldContinue(state)
  │     ├─ 无 tool_calls → '__end__'
  │     ├─ iterationCount >= maxIterations (8) → '__end__'
  │     ├─ toolCallCount >= maxToolCalls (5) → '__end__'
  │     ├─ 全部重复查询 → '__end__'
  │     └─→ 'tools'
  │
  ├─→ enhancedToolNode
  │     ├─ 循环检测: hasLoopDetected()
  │     ├─ 参数拦截: toolInterceptor(scopeNodeIds)
  │     ├─ 工具执行: tool.invoke(args)
  │     ├─ 结果压缩: compressToolResult() (max 8000 chars)
  │     └─→ 输出: ToolMessage[]
  │
  ├─→ 强制结论 (如果达到上限且有 pending tool_calls)
  │     └─→ model.invoke([...messages, HumanMessage(forcedPrompt)])
  │     └─→ verifyAndCleanContent() → Self-Verification
  │
  └─→ 返回: { content, toolResults, iterations, finishReason }
```

**循环检测逻辑:**

```typescript
function hasLoopDetected(toolName, args, queriesAsked): boolean {
  const key = extractQueryKey(toolName, args);
  const history = queriesAsked[toolName] ?? [];
  return history.includes(key);
}

function extractQueryKey(toolName, args): string | null {
  if ('query' in args) return String(args.query);
  if ('keywords' in args) return args.keywords.sort().join(',');
  return null;
}
```

### S4: Formatter Node

**文件:** `src/agent/graph/nodes/formatter.ts`

**职责:**
- 格式化输出为 Obsidian 双链笔记
- 流式输出到 UI
- Self-Verification 清理幽灵引用
- HITL 中断（可选）

**实现:**

```typescript
async function formatterNode(state, config) {
  const mainModel = config.configurable?.mainModel;
  const callbacks = config.configurable?.callbacks;
  
  // depth=0: 日常闲聊，直接流式输出
  if (state.depth === 0) {
    const stream = await mainModel.stream([
      new SystemMessage(casualPrompt),
      new HumanMessage(state.rewrittenQuery),
    ]);
    // ... 流式收集
    return { formattedOutput: content };
  }
  
  // depth>=1: 格式化分析结果
  const stream = await mainModel.stream([
    new SystemMessage(buildFormatterSystemPrompt(memoryContext)),
    new HumanMessage(buildFormatterUserMessage(...)),
  ]);
  
  // Self-Verification
  if (state.toolResultsSnapshot?.length > 0) {
    const verificationResult = await verifyAndCleanContent(content, toolResults);
    content = verificationResult.content;
  }
  
  // HITL interrupt (可选)
  if (enableHumanReview) {
    const resumeValue = interrupt({ nodeId: 'formatter', question, content });
    if (resumeValue?.approved === false) {
      // 重新生成
    }
  }
  
  return { formattedOutput: content };
}
```

### FileCheckpointer (持久化)

**文件:** `src/agent/graph/checkpointer.ts`

**职责:**
- 替代 MemorySaver，支持跨 Obsidian 重启恢复
- JSONL 文件存储 checkpoint
- 支持 HITL 中断恢复

**存储结构:**

```
.obsidian/plugins/deepreader/checkpoints/
  {thread_id}.jsonl          — checkpoint 数据
  {thread_id}.writes.jsonl   — pending writes
```

**关键方法:**

```typescript
class FileCheckpointer extends BaseCheckpointSaver {
  async getTuple(config): Promise<CheckpointTuple | undefined>
  async put(config, checkpoint, metadata, newVersions): Promise<RunnableConfig>
  async putWrites(config, writes, taskId): Promise<void>
  async deleteThread(threadId): Promise<void>
}
```

---

## 工具系统

### LangChain 工具格式

所有工具使用 LangChain `tool()` 格式：

**文件:** `src/agent/tools/definitions/*.ts`

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const createSearchBookTool: ToolFactory = (ctx) =>
  tool(
    async (args) => {
      return searchBookTool.execute(args, ctx);
    },
    {
      name: 'search_book',
      description: '...',
      schema: z.object({
        keywords: z.array(z.string()),
        scope_node_ids: z.array(z.string()).optional(),
      }),
    },
  );
```

### 工具注册

**文件:** `src/agent/tools/index.ts`

```typescript
function createLangChainTools(ctx: ToolContext): StructuredToolInterface[] {
  return [
    createSearchBookTool(ctx),
    createReadBookSectionTool(ctx),
    createWriteNoteTool(ctx),
    createSaveMemoryTool(ctx),
    createSearchMemoryTool(ctx),
    createUpdateProfileTool(ctx),
    createSearchReadBooksTool(ctx),
    createCheckSubAgentTool(ctx),
    createExcalidrawToolDefinition(ctx),
    ctx.app ? createCanvasToolDefinition(ctx) : null,
  ].filter(Boolean);
}
```

### 核心工具列表

| 工具 | 功能 | 定义文件 | 实现文件 |
|------|------|----------|----------|
| `search_book` | BM25 + 向量语义搜索 | `definitions/search-book.ts` | `local/search-text.ts` |
| `read_book_section` | 读取章节内容 | `definitions/read-section.ts` | `local/read-section.ts` |
| `write_note` | 写入 Obsidian 笔记 | `definitions/write-note.ts` | `write-note.ts` |
| `save_memory` | 保存长期记忆 | `definitions/memory.ts` | `memory.ts` |
| `search_memory` | 搜索长期记忆 | `definitions/memory.ts` | `memory.ts` |
| `update_profile` | 更新用户画像 | `definitions/profile.ts` | `profile.ts` |
| `search_read_books` | 搜索已读书籍 | `definitions/search-read-books.ts` | `search-read-books.ts` |
| `canvas` | 创建 Canvas 图 | `definitions/canvas.ts` | `canvas.ts` |
| `excalidraw` | 创建 Excalidraw 图 | `definitions/excalidraw.ts` | `excalidraw.ts` |
| `check_sub_agent` | 检查子 Agent 状态 | `definitions/sub-agent.ts` | `create-sub-agent.ts` |

---

## 数据流

### S0 → S1 → S2 → S4 数据传递

```
                    ┌─────────────────────────────────────┐
                    │      CognitiveEngineState           │
                    │    (LangGraph Annotation)           │
                    └─────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
   ┌─────────┐               ┌─────────────┐               ┌─────────┐
   │   S0    │               │     S1      │               │   S2    │
   │ Router  │               │ Inspectional│               │Analytical│
   └────┬────┘               └──────┬──────┘               └───┬─────┘
        │                           │                           │
        │ depth                     │ scopeNodeIds              │ analysisResult
        │ rewrittenQuery           │ tocSummary                │ toolResultsSnapshot
        │                           │ betterQuestion            │
        │                           │ structuralAnalysis        │
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    │
                                    ▼
                              ┌───────────┐
                              │    S4     │
                              │ Formatter │
                              └───┬───────┘
                                  │
                                  │ formattedOutput
                                  │
                                  ▼
                            [用户可见输出]
```

### 工具调用循环 (S2)

```
AIMessage (tool_calls)
    │
    ├─→ tool_calls[0]: { name: 'search_book', args: { keywords: [...] } }
    │     │
    │     ├─→ toolInterceptor: 注入 scope_node_ids
    │     ├─→ loopDetection: 检查是否重复
    │     ├─→ searchBookTool.execute()
    │     └─→ ToolMessage: { content: JSON.stringify(hits) }
    │
    ├─→ tool_calls[1]: { name: 'read_book_section', args: { node_ids: [...] } }
    │     └─→ readBookSectionTool.execute()
    │     └─→ ToolMessage: { content: 章节内容 }
    │
    └─→ AIMessage: { content: 分析结论 }
          │
          └─→ toolResultsSnapshot 收集
          └─→ 传递给 S4 Formatter
```

---

## 追踪与可观测性

### LangSmith Tracing

**文件:** `src/agent/tracing/langsmith.ts`

**配置:**

```typescript
interface LangSmithConfig {
  apiKey: string;
  projectName?: string;  // 默认 "DeepReader"
  apiUrl?: string;       // 默认 LangSmith API
}
```

**使用:**

```typescript
// 在 FrontendAgent 中
const langsmithTracer = getLangSmithTracer({
  apiKey: settings.langsmithApiKey,
  projectName: settings.langsmithProject,
});

// 传递给 LangGraph
cognitiveEngine.stream(input, {
  configurable,
  callbacks: [langsmithTracer],  // 自动追踪所有节点/LLM/工具调用
});
```

**追踪内容:**
- StateGraph 节点执行
- ChatOpenAI LLM 调用
- StructuredTool 工具调用
- ReAct 循环迭代
- Self-Verification 结果

### Langfuse (Legacy)

**文件:** `src/agent/tracing/tracer.ts`

Langfuse 用于非 LangGraph 场景（如记忆压缩）。LangGraph 场景优先使用 LangSmith。

---

## 文件结构

```
src/agent/
├── index.ts                    # FrontendAgent 主入口
├── types.ts                    # 核心类型定义
├── llm-client.ts               # LLMClient (非 LangGraph 场景使用)
│
├── graph/                      # LangGraph 认知引擎
│   ├── index.ts                # StateGraph 编译入口
│   ├── state.ts                # CognitiveEngineAnnotation 状态定义
│   ├── edges.ts                # 条件边逻辑
│   ├── shared-context.ts       # SharedContext 定义
│   ├── checkpointer.ts         # FileCheckpointer 持久化
│   │
│   ├── nodes/                  # 状态节点
│   │   ├── router.ts           # S0 Router
│   │   ├── inspectional.ts     # S1 Inspectional
│   │   ├── analytical.ts       # S2 Analytical
│   │   └── formatter.ts        # S4 Formatter
│   │
│   ├── prompts/                # 各状态 Prompt
│   │   ├── router-prompt.ts
│   │   ├── inspectional-prompt.ts
│   │   ├── analytical-prompt.ts
│   │   └── formatter-prompt.ts
│   │
│   ├── subgraphs/
│   │   └── react-loop.ts       # ReAct 子图 (S2 工具循环)
│   │
│   └── utils/
│       ├── tree-loader.ts      # tree.json 加载
│       ├── history-summarizer.ts # 历史摘要
│       ├── self-verification.ts  # block_id 验证
│       └── parse.ts            # 输出解析
│
├── models/                     # ChatModel
│   ├── index.ts
│   └── chat-model.ts           # createChatModels()
│
├── tools/                      # 工具系统
│   ├── index.ts                # createLangChainTools
│   ├── types.ts                # ToolContext, StructuredToolInterface
│   │
│   ├── definitions/            # LangChain tool() 定义
│   │   ├── search-book.ts
│   │   ├── read-section.ts
│   │   ├── write-note.ts
│   │   ├── memory.ts
│   │   ├── profile.ts
│   │   ├── search-read-books.ts
│   │   ├── canvas.ts
│   │   ├── excalidraw.ts
│   │   ├── sub-agent.ts
│   │   └── types.ts
│   │
│   ├── local/                  # 本地工具实现
│   │   ├── search-text.ts      # search_book 实现
│   │   ├── read-section.ts     # read_book_section 实现
│   │   ├── utils.ts            # 工具辅助函数
│   │   └── types.ts
│   │
│   ├── memory.ts               # save/search_memory 实现
│   ├── profile.ts              # update_profile 实现
│   ├── write-note.ts           # write_note 实现
│   ├── canvas.ts               # canvas 实现
│   ├── excalidraw.ts           # excalidraw 实现
│   └── create-sub-agent.ts     # subagent 实现
│
├── tracing/                    # 追踪系统
│   ├── index.ts                # 追踪入口
│   ├── langsmith.ts            # LangSmith Tracer
│   ├── tracer.ts               # Langfuse Tracer
│   ├── trace-context.ts        # TraceContext
│   ├── noop-tracer.ts          # Noop Tracer
│   └── types.ts
│
├── context/                    # 上下文构建
│   ├── index.ts
│   ├── builder.ts              # ContextBuilder
│   └── loader.ts               # ContextLoader
│
├── memory/                     # 长期记忆
│   ├── index.ts
│   ├── store.ts                # MemoryStore
│   ├── consolidator.ts         # 记忆压缩
│   └── milestones.ts           # 里程碑
│
├── skills/                     # Skills 系统
│   ├── index.ts
│   ├── loader.ts               # SkillLoader
│   └── types.ts
│
├── session/                    # 会话管理
│   ├── index.ts
│   ├── store.ts                # SessionStore
│   └── types.ts
│
├── router/                     # 意图路由
│   ├── index.ts
│   ├── intent-router.ts        # IntentRouter
│   └── types.ts
│
├── subagent/                   # 子 Agent
│   ├── manager.ts              # SubagentManager
│   └── types.ts
│
├── ui/                         # UI 组件
│   ├── index.ts
│   ├── humanized-types.ts
│   ├── humanized-view.ts
│   └── humanized-adapter.ts
│
└── utils/                      # 工具函数
    ├── logger.ts
    ├── result.ts
    ├── book-note.ts
    └── link-validator.ts
```

---

## 附录

### A. 配置字段

**settings 新增字段:**

```typescript
interface DeepPDFSettings {
  // Fast 模型配置
  fastModelEnabled: boolean;
  fastModelProvider: ProviderType;
  fastModelName: string;
  fastModelApiUrl: string;
  
  // LangGraph 引擎
  enableHumanReview: boolean;    // HITL 开关
  
  // LangSmith 追踪
  langsmithApiKey: string;
  langsmithProject: string;      // 默认 "DeepReader"
  langsmithEnabled: boolean;
}
```

### B. 运行时 configurable

```typescript
const configurable = {
  thread_id: threadId,
  fastModel: models.fast,           // ChatOpenAI (fast)
  mainModel: models.main,           // ChatOpenAI (main)
  sharedContext: ctx,               // SharedContext
  chatHistory: [],
  toolContext: context,
  callbacks: engineCallbacks,       // onProgress, onContent, onError
  enableHumanReview: boolean,       // HITL 开关
};
```

### C. Self-Verification 详情

**文件:** `src/agent/graph/utils/self-verification.ts`

```typescript
interface VerificationResult {
  content: string;              // 清理后的内容
  totalRefs: number;            // 总引用数
  ghostRefs: number;            // 幽灵引用数
  truncatedRefs: number;        // 截断导致的不可见引用
  llmCorrectionTriggered: boolean; // 是否触发 LLM 修正
}

async function verifyAndCleanContent(content, toolResults) {
  // 1. 提取所有 block_id 引用: [[文件#^block_id|别名]]
  const blockIds = extractBlockIds(content);
  
  // 2. 检查每个引用是否在 toolResults 中存在
  for (const id of blockIds) {
    const status = checkBlockIdExists(id, toolResults);
    if (status === 'ghost') ghostIds.add(id);
  }
  
  // 3. 移除幽灵引用，保留别名文本
  const cleanedContent = removeGhostLinks(content, ghostIds);
  
  // 4. 如果幽灵引用超过 50%，触发 LLM 修正
  if (ghostCount > totalRefs * 0.5 && options.llmClient) {
    const corrected = await llmClient.chat(correctionMessage);
    cleanedContent = corrected;
  }
  
  return { content: cleanedContent, ... };
}
```

---

## 变更日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-04-13 | v0.10.0 | LangGraph 引擎首次实现 |
| 2026-04-14 | v0.10.0 | 删除 Legacy 引擎，统一为 LangGraph |
| 2026-04-14 | v0.10.0 | 迁移 cognitive-engine/states/ 到 graph/nodes/ |
| 2026-04-14 | v0.10.0 | 添加 LangSmith tracing |