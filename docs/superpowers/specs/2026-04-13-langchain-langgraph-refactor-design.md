# DeepReader Agent LangChain/LangGraph 重构设计

## 概述

将 DeepReader 的 Agent 系统从手写的 ReAct 循环和状态机重构为基于 LangChain.js + LangGraph.js 的标准实现。采用渐进式方案，分 5 个 Chunk 逐层替换，每个 Chunk 完成后系统可运行。

**重构目标**：
- 架构标准化：用社区最佳实践替换手写的 LLM 调用、工具注册、状态机
- 能力扩展：解锁人机协作（human-in-the-loop）等 LangGraph 原生能力

**运行环境**：纯 Node.js（Obsidian Electron 插件）

**认知引擎**：保留 S0→S1→S2→S4 阅读深度分层流程，用 LangGraph StateGraph 重实现

---

## 新增依赖

```
@langchain/langgraph      — StateGraph、MemorySaver、interrupt、Command
@langchain/core            — messages、tool 定义、callbacks、RunnableConfig
@langchain/openai          — ChatOpenAI（兼容 DeepSeek 等非标准 provider）
zod                        — 工具参数 schema（LangChain tool() 内置依赖）
```

---

## 目录结构

保留现有 `src/agent/`，重构在原地进行：

```
src/agent/
  index.ts                        # FrontendAgent 入口（保持接口不变）

  models/                         # 【新】ChatModel 管理
    index.ts                      # 导出 createChatModels
    chat-model.ts                 # ChatOpenAI 实例工厂（main/fast 双模型）

  tools/                          # 【重构】LangChain tool() 格式
    index.ts                      # createToolRegistry(ctx) → Tool[]
    definitions/                  # 每个工具一个文件
      search-book.ts
      read-section.ts
      write-note.ts
      memory.ts                   # save_memory + search_memory
      profile.ts
      search-read-books.ts
      canvas.ts
      excalidraw.ts
      sub-agent.ts                # create_sub_agent + check_sub_agent
      skill.ts                    # 动态技能执行（如已启用）

  graph/                          # 【新】LangGraph 认知引擎
    index.ts                      # 导出编译后的 graph
    state.ts                      # CognitiveEngineAnnotation 定义
    nodes/
      router.ts                   # S0: 路由（depth 分类 + query 改写）
      inspectional.ts             # S1: 检视阅读（TOC 分析）
      analytical.ts               # S2: 分析阅读（内含 ReAct 子图）
      formatter.ts                # S4: 格式化输出
    edges.ts                      # 条件边（routeByDepth 等）
    subgraphs/
      react-loop.ts               # S2 内部的 ReAct 循环子图

  cognitive-engine/               # 【保留→逐步删除】旧引擎，迁移完成后移除
  memory/                         # 【保留】三层记忆系统
  session/                        # 【保留→Chunk 5 替换】JSONL 会话存储
  context/                        # 【保留】系统提示构建
  ui/                             # 【保留】进度显示适配器
  tracing/                        # 【保留】Langfuse 可观测性
  skills/                         # 【保留】动态技能加载
  subagent/                       # 【保留→后续可改 LangGraph subgraph】
  utils/                          # 【保留】共享工具函数
```

---

## Chunk 1：ChatModel + 工具层

### ChatModel 工厂

替换现有 `LLMClientManager`：

```typescript
// src/agent/models/chat-model.ts
import { ChatOpenAI } from "@langchain/openai";

interface ModelConfig {
  apiKey: string;
  baseUrl: string;    // 如 "https://api.deepseek.com/v1"
  model: string;      // 如 "deepseek-chat"
}

export function createChatModels(main: ModelConfig, fast?: ModelConfig) {
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

ChatOpenAI 兼容所有 OpenAI API 格式的 provider（DeepSeek、Kimi、Moonshot），通过 `configuration.baseURL` 切换。内置 streaming、tool calling、structured output 支持，消除手写 SSE 解析和 tool_calls 片段拼接的需要。

`withStructuredOutput()` 用于 S0 Router 的 JSON 分类，替代现有 `response_format: { type: 'json_object' }`。

### 工具层

从 `BaseTool` 抽象类迁移到 LangChain `tool()` 函数。关键变更：工具所需运行时依赖（如 Obsidian `app` 实例、PageIndex 路径等）通过闭包捕获而非 `config.configurable` 传递。

```typescript
// src/agent/tools/definitions/search-book.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ToolContext } from "../types";

export function createSearchBookTool(ctx: ToolContext) {
  return tool(
    async ({ query, topK, scopeNodeIds }) => {
      const results = await hybridSearch(ctx.indexPath, query, { topK, scopeNodeIds });
      return JSON.stringify(results);
    },
    {
      name: "search_book",
      description: "在书籍索引中进行混合搜索（BM25 + 语义向量），返回最相关的章节片段",
      schema: z.object({
        query: z.string().describe("搜索查询文本"),
        topK: z.number().default(5).describe("返回结果数量"),
        scopeNodeIds: z.array(z.string()).optional().describe("限定搜索范围的节点 ID 列表"),
      }),
    }
  );
}
```

工具注册表通过工厂函数创建，每个工具闭包捕获 `ToolContext`：

```typescript
// src/agent/tools/index.ts
import type { ToolContext } from "./types";
import type { Tool } from "@langchain/core/tools";

export function createToolRegistry(ctx: ToolContext): Tool[] {
  return [
    createSearchBookTool(ctx),
    createReadSectionTool(ctx),
    createWriteNoteTool(ctx),
    createSaveMemoryTool(ctx),
    createSearchMemoryTool(ctx),
    createUpdateProfileTool(ctx),
    createSearchReadBooksTool(ctx),
    createCanvasTool(ctx),
    createExcalidrawTool(ctx),
    createCheckSubAgentTool(ctx),
    // create_sub_agent 和 skill 工具在 Chunk 3 后迁移
  ];
}
```

改进对比：

| 现有 BaseTool | LangChain tool() |
|---------------|------------------|
| 手写 JSON Schema 参数定义 | Zod schema，自动推断 |
| 手写 castParams() 类型转换 | LangChain 自动处理 |
| Map\<string, ToolExecutor\> 注册表 | 标准 Tool[] 数组 |
| 手写工具执行超时 | LangChain 内置 timeout 支持 |

工具迁移清单（14 个注册项）：

| 现有工具名 | 新文件 | 复杂度 |
|-----------|--------|--------|
| search_book | definitions/search-book.ts | 中 |
| read_book_section | definitions/read-section.ts | 低 |
| write_note | definitions/write-note.ts | 低 |
| save_memory | definitions/memory.ts | 中（涉及 vault 文件读写） |
| search_memory | definitions/memory.ts | 低 |
| update_profile | definitions/profile.ts | 低 |
| search_read_books | definitions/search-read-books.ts | 中 |
| canvas | definitions/canvas.ts | 中 |
| excalidraw | definitions/excalidraw.ts | 中 |
| check_sub_agent | definitions/check-sub-agent.ts | 中 |
| create_sub_agent | 暂保留，Chunk 3 后迁移 | 高 |
| skill | 暂保留，后续迁移 | 中 |

迁移开关（过渡期）：

```typescript
// src/agent/tools/index.ts
const USE_LANGCHAIN_TOOLS = true;

export function createTools(ctx: ToolContext): Tool[] | Map<string, ToolExecutor> {
  if (USE_LANGCHAIN_TOOLS) {
    return createToolRegistry(ctx);
  }
  return createLegacyTools(ctx);
}
```

---

## Chunk 2：Graph 节点 + 边

### GraphState 定义

用 LangGraph `Annotation` 替换 `SharedContext`。每个字段显式声明 `default` 值，避免 `undefined` 问题：

```typescript
// src/agent/graph/state.ts
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

export const CognitiveEngineAnnotation = Annotation.Root({
  // 对话消息（LangGraph 标准消息 reducer：追加而非覆盖）
  messages: Annotation({
    reducer: MessagesAnnotation.spec.messages.reducer,
    default: () => [],
  }),

  // S0: 路由结果
  depth: Annotation<number>({ default: () => 0 }),
  rewrittenQuery: Annotation<string>({ default: () => "" }),

  // S1: 检视阅读结果
  tocSummary: Annotation<string>({ default: () => "" }),
  scopeNodeIds: Annotation<string[]>({ default: () => [] }),
  betterQuestion: Annotation<string>({ default: () => "" }),
  structuralAnalysis: Annotation<string>({ default: () => "" }),

  // S2: 分析阅读结果
  analysisResult: Annotation<string>({ default: () => "" }),
  toolResultsSnapshot: Annotation<any[]>({ default: () => [] }),

  // S4: 格式化输出
  formattedOutput: Annotation<string>({ default: () => "" }),

  // 运行时依赖
  bookId: Annotation<string>({ default: () => "" }),
  filePath: Annotation<string>({ default: () => "" }),
});
```

### 主图

```typescript
// src/agent/graph/index.ts
import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { CognitiveEngineAnnotation } from "./state";
import type { RunnableConfig } from "@langchain/core/runnables";

const workflow = new StateGraph(CognitiveEngineAnnotation)
  .addNode("router", routerNode)
  .addNode("inspectional", inspectionalNode)
  .addNode("analytical", analyticalNode)
  .addNode("formatter", formatterNode)
  .addEdge(START, "router")
  .addConditionalEdges("router", routeByDepth, {
    casual: END,
    inspectional: "inspectional",
    analytical: "analytical",
  })
  .addConditionalEdges("inspectional", routeAfterInspectional, {
    continue: "analytical",
    done: "formatter",
  })
  .addEdge("analytical", "formatter")
  .addEdge("formatter", END);

// Chunk 5 之前使用 MemorySaver（内存级别），
// Chunk 5 实现文件系统持久化 checkpointer
export const cognitiveEngine = workflow.compile({
  checkpointer: new MemorySaver(),
});
```

### 条件边

depth=3（syntopical reading）当前实现为降级到 depth=2（analytical），这个降级逻辑在 router 节点内处理，保持路由函数简洁：

```typescript
// src/agent/graph/edges.ts
import type { typeof CognitiveEngineAnnotation.State } from "./state";

export function routeByDepth(state: typeof CognitiveEngineAnnotation.State): string {
  if (state.depth === 0) return "casual";
  if (state.depth === 1) return "inspectional";
  // depth=2 (analytical) 和 depth=3 (syntopical，已降级) 都走 analytical
  return "analytical";
}

export function routeAfterInspectional(state: typeof CognitiveEngineAnnotation.State): string {
  // depth=1 且已完成结构分析 → 直接格式化
  if (state.depth <= 1 && state.structuralAnalysis) {
    return "done";
  }
  // depth>=2 → 继续到分析阅读
  return "continue";
}
```

### S0 Router 节点

降级逻辑在节点内处理，确保路由结果的一致性：

```typescript
// src/agent/graph/nodes/router.ts
import { z } from "zod";
import { HumanMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { CognitiveEngineAnnotation } from "../state";

const RouterSchema = z.object({
  depth: z.number().min(0).max(3),
  rewrittenQuery: z.string(),
  reasoning: z.string(),
});

export async function routerNode(
  state: typeof CognitiveEngineAnnotation.State,
  config: RunnableConfig
) {
  const fastModel = config.configurable.fastModel;
  const router = fastModel.withStructuredOutput(RouterSchema);

  const result = await router.invoke([
    { role: "system", content: ROUTER_SYSTEM_PROMPT },
    ...state.messages,
  ]);

  // Syntopical reading (depth=3) 降级为 analytical (depth=2)
  const effectiveDepth = result.depth >= 3 ? 2 : result.depth;

  return {
    depth: effectiveDepth,
    rewrittenQuery: result.rewrittenQuery,
    messages: [new HumanMessage(result.rewrittenQuery)],
  };
}
```

---

## Chunk 3：ReAct 子图 + 逻辑迁移

### ReAct 子图

S2 内部的 ReAct 循环，替换 `runStateLoop()`。`iterationCount` 作为简单字段由节点自身维护，不使用 reducer：

```typescript
// src/agent/graph/subgraphs/react-loop.ts
import { StateGraph, START, END, ToolNode } from "@langchain/langgraph";
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { Tool } from "@langchain/core/tools";

interface ReactLoopConfig {
  tools: Tool[];
  model: any;  // ChatOpenAI instance
  maxIterations: number;
  maxToolCalls: number;
}

export function createReactLoopGraph(config: ReactLoopConfig) {
  const ReactAnnotation = Annotation.Root({
    messages: Annotation({
      reducer: MessagesAnnotation.spec.messages.reducer,
      default: () => [],
    }),
    iterationCount: Annotation<number>({ default: () => 0 }),
    toolCallCount: Annotation<number>({ default: () => 0 }),
    queriesAsked: Annotation<string[]>({ default: () => [] }),
  });

  async function agentNode(
    state: typeof ReactAnnotation.State,
    runnableConfig: RunnableConfig
  ) {
    const modelWithTools = config.model.bindTools(config.tools);
    const response = await modelWithTools.invoke(state.messages, runnableConfig);

    return {
      messages: [response],
      iterationCount: state.iterationCount + 1,
      toolCallCount: state.toolCallCount + (response.tool_calls?.length ?? 0),
      queriesAsked: extractQueries(response),
    };
  }

  function shouldContinue(state: typeof ReactAnnotation.State): string {
    const lastMessage = state.messages.at(-1) as AIMessage;

    // 无工具调用 → 正常结束
    if (!lastMessage?.tool_calls?.length) return "__end__";
    // 超过最大迭代 → 强制结束
    if (state.iterationCount >= config.maxIterations) return "__end__";
    // 超过最大工具调用数 → 强制结束
    if (state.toolCallCount >= config.maxToolCalls) return "__end__";
    // 循环检测（重复查询）
    if (hasLoopDetected(state.queriesAsked)) return "__end__";

    return "tools";
  }

  return new StateGraph(ReactAnnotation)
    .addNode("agent", agentNode)
    .addNode("tools", new ToolNode(config.tools))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue, {
      tools: "tools",
      __end__: "__end__",
    })
    .addEdge("tools", "agent");
}
```

### Scope Interceptor 迁移

现有 scope interceptor 在每次工具调用前拦截并注入 `scope_node_ids`。在 LangChain 模型下，通过**包装工具函数**实现：

```typescript
// src/agent/graph/subgraphs/react-loop.ts（续）
function createScopedTools(tools: Tool[], scopeNodeIds: string[]): Tool[] {
  return tools.map(t => {
    if (t.name === "search_book") {
      // 包装 search_book 工具，自动注入 scopeNodeIds
      return tool(
        async (args) => {
          return t.invoke({ ...args, scopeNodeIds });
        },
        { name: t.name, description: t.description, schema: t.schema }
      );
    }
    return t;
  });
}
```

### Forced Conclusion 迁移

达到迭代上限时，现有逻辑注入强制总结 prompt。在 LangGraph 中通过条件边 + 专用节点实现：

```typescript
// 当 shouldContinue 返回 "__end__" 且是因为迭代上限（而非正常结束）时，
// 在 analyticalNode 中检测并追加 forced conclusion prompt
async function analyticalNode(state, config) {
  let reactResult = await reactLoop.invoke(
    { messages: state.messages, iterationCount: 0, toolCallCount: 0 },
    config
  );

  const lastMessage = reactResult.messages.at(-1) as AIMessage;

  // 检测是否因达到上限而终止（有未完成的 tool_calls）
  if (lastMessage?.tool_calls?.length && reactResult.iterationCount >= MAX_ITERATIONS) {
    // 注入 forced conclusion prompt，让 LLM 基于已有结果总结
    const forcedSummary = await config.configurable.mainModel.invoke([
      ...reactResult.messages,
      new HumanMessage(FORCED_CONCLUSION_PROMPT),
    ]);
    reactResult = {
      ...reactResult,
      messages: [...reactResult.messages, forcedSummary],
    };
  }

  // 保存 tool results 给 S4 自验证
  const toolResults = reactResult.messages
    .filter(m => m instanceof ToolMessage)
    .map(m => ({ name: m.name, content: m.content }));

  return {
    analysisResult: extractAnalysis(reactResult),
    toolResultsSnapshot: toolResults,
    messages: reactResult.messages,
  };
}
```

### Self-Verification 迁移

S4 验证 S2 的 block_id 引用真实性。在 formatterNode 中实现，从 state 读取 `toolResultsSnapshot`：

```typescript
// formatterNode 内部
function verifyCitations(output: string, toolResults: any[]): VerificationResult {
  const citations = extractBlockIds(output);
  const validBlockIds = toolResults.flatMap(r => extractBlockIdsFromResult(r.content));
  const invalid = citations.filter(id => !validBlockIds.includes(id));
  return { valid: invalid.length === 0, invalidCitations: invalid };
}
```

---

## Chunk 4：人机协作（Human-in-the-Loop）

### interrupt() API 说明

LangGraph 的 `interrupt(value)` 向调用方发送一个值（展示给人类），暂停图执行。恢复时，调用方通过 `Command({ resume: response })` 传入人类响应，`interrupt()` 的返回值即为该响应。

### 断点 1：S2 分析结果审查

在 Analytical 完成后、Formatter 之前暂停：

```typescript
// src/agent/graph/nodes/analytical.ts
import { interrupt } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { CognitiveEngineAnnotation } from "../state";

// interrupt 发送的数据结构
interface AnalysisReviewPayload {
  summary: string;
  keyFindings: string[];
  sourceSections: string[];
}

// 用户恢复时传入的响应结构
interface AnalysisReviewResponse {
  action: "approve" | "redirect" | "deepen";
  feedback?: string;
  focusAreas?: string[];
}

export async function analyticalNode(
  state: typeof CognitiveEngineAnnotation.State,
  config: RunnableConfig
) {
  let reactResult = await reactLoop.invoke(
    { messages: state.messages },
    config
  );

  const analysis = extractAnalysis(reactResult);

  // 如果启用人机协作，暂停等待用户审查
  if (config.configurable.enableHumanReview) {
    const review: AnalysisReviewResponse = interrupt({
      summary: analysis.summary,
      keyFindings: analysis.keyFindings,
      sourceSections: analysis.sourceSections,
    });

    if (review.action === "redirect" && review.feedback) {
      reactResult = await reactLoop.invoke(
        { messages: [...state.messages, new HumanMessage(review.feedback)] },
        config
      );
      return {
        analysisResult: extractAnalysis(reactResult).content,
        toolResultsSnapshot: extractToolResults(reactResult),
        messages: reactResult.messages,
      };
    }

    if (review.action === "deepen" && review.focusAreas) {
      const deepenPrompt = `请针对以下方面深入分析：${review.focusAreas.join("、")}`;
      reactResult = await reactLoop.invoke(
        { messages: [...state.messages, new HumanMessage(deepenPrompt)] },
        config
      );
      return {
        analysisResult: extractAnalysis(reactResult).content,
        toolResultsSnapshot: extractToolResults(reactResult),
        messages: reactResult.messages,
      };
    }
  }

  return {
    analysisResult: analysis.content,
    toolResultsSnapshot: extractToolResults(reactResult),
    messages: reactResult.messages,
  };
}
```

### 断点 2：S4 格式化输出预览

在 Formatter 生成笔记后暂停，限制最大重新生成次数为 2：

```typescript
// src/agent/graph/nodes/formatter.ts
import { interrupt } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";

interface FormatReviewResponse {
  action: "accept" | "revise" | "regenerate";
  revisions?: string;
}

export async function formatterNode(
  state: typeof CognitiveEngineAnnotation.State,
  config: RunnableConfig
) {
  const mainModel = config.configurable.mainModel;
  let formatted = await mainModel.invoke([
    { role: "system", content: FORMATTER_SYSTEM_PROMPT },
    ...buildFormatterContext(state),
  ]);

  // Self-verification：验证 block_id 引用
  const verification = verifyCitations(formatted.content, state.toolResultsSnapshot);
  if (!verification.valid) {
    formatted = await mainModel.invoke([
      ...state.messages,
      new HumanMessage(`以下引用无效，请修正：${verification.invalidCitations.join(", ")}`),
    ]);
  }

  // 人机协作：预览最终输出（最多重试 2 次）
  if (config.configurable.enableHumanReview) {
    let regenerateCount = 0;
    const MAX_REGENERATE = 2;

    let review: FormatReviewResponse = interrupt({
      preview: formatted.content,
      noteTitle: extractTitle(formatted.content),
      citations: extractCitations(formatted.content),
    });

    while (review.action === "regenerate" && regenerateCount < MAX_REGENERATE) {
      formatted = await mainModel.invoke([
        { role: "system", content: FORMATTER_SYSTEM_PROMPT },
        ...buildFormatterContext(state),
      ]);
      regenerateCount++;

      review = interrupt({
        preview: formatted.content,
        noteTitle: extractTitle(formatted.content),
        citations: extractCitations(formatted.content),
      });
    }

    if (review.action === "revise" && review.revisions) {
      formatted = await mainModel.invoke([
        ...state.messages,
        new HumanMessage(`请按以下要求修改：${review.revisions}`),
      ]);
    }
  }

  return { formattedOutput: formatted.content };
}
```

### 恢复执行

```typescript
// src/agent/graph/resume.ts
import { Command } from "@langchain/langgraph";

async function resumeFromInterrupt(
  threadId: string,
  reviewResponse: AnalysisReviewResponse | FormatReviewResponse
) {
  const stream = await cognitiveEngine.stream(
    new Command({ resume: reviewResponse }),
    { configurable: { thread_id: threadId } }
  );
  for await (const chunk of stream) {
    callbacks.onContent?.(chunk);
  }
}
```

### 开关控制

人机协作默认关闭，通过 `configurable.enableHumanReview` 控制。不需要编译不同的图——在节点内部根据配置决定是否 `interrupt`：

```typescript
if (config.configurable.enableHumanReview) {
  const review = interrupt({ ... });
  // 处理 review
}
```

### Streaming 集成

LangGraph 支持 `graph.stream()` 返回异步迭代器。通过 `streamMode` 控制输出粒度：

```typescript
// 流式输出到 UI
const stream = await cognitiveEngine.stream(
  { messages: [new HumanMessage(userMessage)], bookId, filePath },
  {
    configurable: { thread_id: sessionId, mainModel, fastModel, toolContext },
    streamMode: "messages",  // 逐消息流式输出
  }
);

for await (const [eventType, chunk] of stream) {
  if (eventType === "messages") {
    // chunk 是 AIMessageChunk，包含增量内容
    callbacks.onContent?.(chunk.content);
  }
}
```

`streamMode: "messages"` 提供 LLM 的逐 token 流式输出，与现有 UI 的 `onContent` 回调对接。

### 用户体验流程

```
用户提问 → S0 路由 → S1 检视 → S2 分析（ReAct 循环）
                                         ↓
                                   [interrupt 暂停]
                                   UI 显示分析摘要卡片
                                   [深入] [换个方向] [继续]
                                         ↓ (用户选择)
                                   S4 格式化
                                         ↓
                                   [interrupt 暂停]
                                   UI 显示笔记预览
                                   [接受] [修改] [重新生成]
                                         ↓
                                   最终输出
```

---

## Chunk 5：持久化 Checkpointer 替换会话存储

### 问题：MemorySaver 不持久化

`MemorySaver` 是内存级 checkpointer，Obsidian 重启后数据丢失。需要实现文件系统级 checkpointer 用于：
- interrupt 恢复（跨 Obsidian 重启）
- 会话状态持久化

### 方案：自定义 FileCheckpointer

基于 JSONL 的文件系统 checkpointer，复用现有 session 存储的目录结构：

```typescript
// src/agent/graph/checkpointer.ts
import { BaseCheckpointSaver } from "@langchain/langgraph";
import type { Checkpoint, CheckpointMetadata } from "@langchain/langgraph";

export class FileCheckpointer extends BaseCheckpointSaver {
  constructor(private baseDir: string) {
    super();
  }

  async put(config, checkpoint: Checkpoint, metadata: CheckpointMetadata) {
    const threadId = config.configurable.thread_id;
    const filePath = `${this.baseDir}/${threadId}.jsonl`;
    // 追加写入 checkpoint
    await appendLine(filePath, JSON.stringify({ checkpoint, metadata }));
  }

  async get(config) {
    const threadId = config.configurable.thread_id;
    const filePath = `${this.baseDir}/${threadId}.jsonl`;
    // 读取最后一个 checkpoint
    return readLastLine(filePath);
  }
}
```

迁移后，现有 `session/store.ts` 的功能由 FileCheckpointer + MemoryStore 分担：
- **FileCheckpointer**：图执行状态、interrupt 断点
- **MemoryStore**（保持不变）：用户画像、阅读历史、MEMORY.md

---

## 与现有系统的适配

FrontendAgent 入口保持接口不变，内部切换：

```typescript
// src/agent/index.ts
async chat(userMessage: string, context: ChatContext, callbacks: StreamCallbacks) {
  if (USE_LANGGRAPH_ENGINE) {
    const stream = await cognitiveEngine.stream(
      {
        messages: [new HumanMessage(userMessage)],
        bookId: context.bookId,
        filePath: context.filePath,
      },
      {
        configurable: {
          thread_id: this.sessionId,
          mainModel: this.models.main,
          fastModel: this.models.fast,
          toolContext: this.toolContext,
          enableHumanReview: this.settings.humanReview,
        },
      }
    );

    let finalOutput = "";
    for await (const [eventType, chunk] of stream) {
      if (chunk instanceof AIMessageChunk && chunk.content) {
        callbacks.onContent?.(chunk.content);
      }
    }

    // 从最终 state 获取 formattedOutput
    const finalState = await cognitiveEngine.getState({
      configurable: { thread_id: this.sessionId },
    });
    return finalState.values.formattedOutput;
  }
  // 旧路径（过渡期保留）
  return this.legacyChat(userMessage, context, callbacks);
}
```

---

## 错误处理设计

### 错误分类

```typescript
// src/agent/graph/errors.ts
class AgentError extends Error {
  code: string;
  recoverable: boolean;
  userMessage: string;
}

class NodeTimeoutError extends AgentError {
  constructor(nodeName: string, timeout: number) {
    super('NODE_TIMEOUT', `节点 ${nodeName} 超时`, `操作超时，请稍后重试`, true);
  }
}

class ToolExecutionError extends AgentError {
  constructor(toolName: string, error: Error) {
    super('TOOL_ERROR', `工具 ${toolName} 失败`, `工具执行失败，尝试其他方式`, true);
  }
}

class LLMError extends AgentError {
  constructor(provider: string, error: Error) {
    super('LLM_ERROR', `LLM ${provider} 错误`, `AI 服务暂时不可用`, true);
  }
}
```

### 节点错误处理

在 ReAct 循环中捕获并处理：

```typescript
// react-loop.ts
async function agentNode(state, config) {
  try {
    const response = await modelWithTools.invoke(state.messages, config);
    return { messages: [response], iterationCount: state.iterationCount + 1 };
  } catch (error) {
    if (error instanceof LLMError) {
      // 尝试 fallback 模型
      const fallbackModel = config.configurable.fallbackModel;
      const response = await fallbackModel.invoke(state.messages);
      return { messages: [response], iterationCount: state.iterationCount + 1 };
    }
    throw error;
  }
}
```

### 用户友好错误消息

| 错误代码 | 用户消息 | 恢复建议 |
|----------|----------|----------|
| NODE_TIMEOUT | 操作超时 | 简化问题或减少查询范围 |
| TOOL_ERROR | 工具执行失败 | 检查文档是否已索引 |
| LLM_ERROR | AI 服务不可用 | 检查 API Key 和网络 |

---

## 回滚计划

### 分支策略

```
main
  └── feature/langchain-refactor
        ├── chunk-1-complete (tag)
        ├── chunk-2-complete (tag)
        ├── chunk-3-complete (tag)
        ├── chunk-4-complete (tag)
        └── chunk-5-complete (tag)
```

### 回滚触发条件

| Chunk | 回滚条件 | 回滚目标 |
|-------|----------|----------|
| 1 | 工具功能测试失败 > 30% | 回到 main |
| 2 | 状态图 E2E 测试失败 > 20% | 回到 chunk-1-complete |
| 3 | ReAct 循环测试失败 > 15% | 回到 chunk-2-complete |
| 4 | interrupt 流程测试失败 | 回到 chunk-3-complete |
| 5 | 持久化测试失败 | 回到 chunk-4-complete |

### 迁移开关

每个 Chunk 都有开关，失败时可快速切换回旧实现：

```typescript
const USE_LANGCHAIN_TOOLS = process.env.USE_LANGCHAIN_TOOLS !== 'false';
const USE_LANGGRAPH_ENGINE = process.env.USE_LANGGRAPH_ENGINE !== 'false';
```

---

## 性能基准指标

| 指标 | 现有版本基准 | 新版本目标 | 测试方法 |
|------|-------------|------------|----------|
| S0 Router 响应时间 | ~1.5s | ≤1.6s (+10%) | 单元测试计时 |
| S2 ReAct 循环（5轮） | ~15s | ≤16.5s (+10%) | E2E 测试计时 |
| 工具执行延迟 | ~500ms/次 | ≤550ms (+10%) | 工具测试计时 |
| 内存占用峰值 | ~50MB | ≤55MB (+10%) | Node 内存监控 |
| 流式首字节时间 | ~1s | ≤1.1s (+10%) | UI 测试计时 |
| 插件包体积增量 | 0 | ≤400KB (gzip) | esbuild 输出 |

---

## DeepSeek Reasoning 处理

DeepSeek 返回 `reasoning_content` 在 `additional_kwargs`：

```typescript
// src/agent/models/chat-model.ts
async function invokeWithReasoning(model, messages, callbacks) {
  const response = await model.invoke(messages);
  
  const reasoning = response.additional_kwargs?.reasoning_content;
  if (reasoning && callbacks.onReasoning) {
    callbacks.onReasoning(reasoning);
  }
  
  return {
    content: response.content,
    reasoning,
  };
}

// 状态字段
const CognitiveEngineAnnotation = Annotation.Root({
  // ...
  reasoningContent: Annotation<string>({ default: () => "" }),
});
```

---

## 迁移时间线

| 阶段 | 内容 | 产出 |
|------|------|------|
| Week 1 | Chunk 1 (models + tools) | 新 ChatModel + tool() 工具 + 单元测试 |
| Week 2 | Chunk 2 (graph nodes + edges) | S0→S4 主图 + 端到端测试 |
| Week 3 | Chunk 3 (react-loop subgraph) | ReAct 子图 + interceptor + forced conclusion + verification |
| Week 4 | Chunk 4 (human-in-the-loop) | interrupt 断点 + UI 适配 + streaming 对接 |
| Week 5 | Chunk 5 (checkpointer + 清理) | FileCheckpointer + 删除旧代码 |

---

## 测试策略

### 每个 Chunk 的测试要求

| Chunk | 单元测试 | 集成测试 | 验收标准 |
|-------|---------|---------|---------|
| 1 | 每个工具独立测试 | ChatModel streaming 对比 | 输出与旧实现一致 |
| 2 | 每个节点独立测试 | 完整 S0→S4 流程 | 路由结果与旧引擎一致 |
| 3 | ReAct 循环测试 | scope + loop detection | 搜索结果与旧实现一致 |
| 4 | interrupt/resume 测试 | UI 端到端 | 审查流程正常工作 |
| 5 | FileCheckpointer 测试 | 跨重启恢复 | 状态完整持久化 |

### LangChain Mock 策略

- `ChatOpenAI`：通过 `@langchain/core/utils/testing` 的 fake chat model 或自定义 mock
- `ToolNode`：直接 mock 工具函数返回值
- `interrupt()`：LangGraph 提供 `createTestGraph` 工具测试 interrupt 流程

### 现有测试迁移

`src/agent/__tests__/cognitive-engine/` 下 7 个测试文件逐步迁移到新 graph 结构，测试逻辑不变，断言目标从 `SharedContext` 改为 `CognitiveEngineAnnotation.State`。

---

## 风险控制

| 风险 | 应对 | 监控方式 |
|------|------|---------|
| LangChain 包体积影响插件大小 | esbuild tree-shaking；预估增量 ~200-400KB（gzip） | CI 中检查 main.js 体积 |
| DeepSeek 等非标准 provider 兼容性 | ChatOpenAI 通过 OpenAI 兼容接口；Chunk 1 中优先实测 DeepSeek | 手动测试 |
| streaming 行为差异 | `streamMode: "messages"` 逐 chunk 对比现有 SSE 输出 | 自动化 diff 测试 |
| 现有功能回归 | 每个 Chunk 完成后运行完整回归测试 | 现有测试套件 |
| interrupt 跨重启恢复 | FileCheckpointer（Chunk 5）替代 MemorySaver | 手动测试 |

---

## 不变的部分

以下模块在本次重构中不修改：
- `memory/` — 三层记忆系统（MemoryStore、MemoryConsolidator、MilestoneRecorder）
- `context/` — 系统提示构建（ContextBuilder、ContextLoader）
- `router/intent-router.ts` — 正则路由（后续可移除）
- `ui/` — 进度显示适配器（适配新 streaming 接口即可）
- `tracing/` — Langfuse 可观测性
- `skills/` — 动态技能加载
- `subagent/` — 子 Agent 管理（后续可改 LangGraph subgraph）
- `utils/` — 共享工具函数（book-note、link-validator 等）
