# LangChain 改造手写引擎代码走读

本文档对比 **main 分支（手写引擎）** 和 **langchain-refactor 分支（LangGraph 引擎）**，展示 LangChain 如何逐步改造手写认知引擎。

---

## 一、整体架构对比

### 1.1 目录结构变化

| 手写引擎 (main) | LangGraph 引擎 (langchain-refactor) | 说明 |
|----------------|-------------------------------------|------|
| `cognitive-engine/engine.ts` | `graph/index.ts` | 主编排器 → StateGraph |
| `cognitive-engine/states/router.ts` | `graph/nodes/router.ts` | S0 状态节点 |
| `cognitive-engine/states/inspectional.ts` | `graph/nodes/inspectional.ts` | S1 状态节点 |
| `cognitive-engine/states/analytical.ts` | `graph/nodes/analytical.ts` | S2 状态节点 |
| `cognitive-engine/states/formatter.ts` | `graph/nodes/formatter.ts` | S4 状态节点 |
| `cognitive-engine/states/run-state-loop.ts` | `graph/subgraphs/react-loop.ts` | 手写循环 → ReAct 子图 |
| `cognitive-engine/types.ts` | `graph/shared-context.ts` | SharedContext 定义 |
| `cognitive-engine/context.ts` | `graph/shared-context.ts` | createSharedContext() |
| `cognitive-engine/prompts/*.ts` | `graph/prompts/*.ts` | Prompt 模块迁移 |
| `cognitive-engine/utils/*.ts` | `graph/utils/*.ts` | 工具函数迁移 |
| 无 | `graph/state.ts` | 新增：Annotation 状态定义 |
| 无 | `graph/edges.ts` | 新增：条件边逻辑 |
| 无 | `graph/checkpointer.ts` | 新增：FileCheckpointer |
| 无 | `models/chat-model.ts` | 新增：ChatOpenAI 工厂 |

### 1.2 执行入口对比

**手写引擎 (main):**
```typescript
// src/agent/index.ts
export { runCognitiveEngine } from './cognitive-engine/index.js';

// src/agent/cognitive-engine/engine.ts
export async function runCognitiveEngine(ctx, callbacks) {
  // 手写 switch-case 路由
  switch (ctx.depth) {
    case 0: break;  // 闲聊
    case 1: await executeStateWithLogging('Inspectional', inspectionalState, ctx, callbacks);
    case 2: await executeStateWithLogging('Analytical', analyticalState, ctx, callbacks);
  }
  await executeStateWithLogging('Formatter', formatterState, ctx, callbacks);
}
```

**LangGraph 引擎 (langchain-refactor):**
```typescript
// src/agent/index.ts
export { createSharedContext } from './graph/shared-context.js';
// 不导出 runCognitiveEngine

// src/agent/graph/index.ts
const workflow = new StateGraph(CognitiveEngineAnnotation)
  .addNode('router', routerNode)
  .addNode('inspectional', inspectionalNode)
  .addNode('analytical', analyticalNode)
  .addNode('formatter', formatterNode)
  .addConditionalEdges('router', routeByDepth)
  .addConditionalEdges('inspectional', routeAfterInspectional)
  .compile({ checkpointer });

// FrontendAgent 直接使用
async runGraphEngine() {
  const stream = await cognitiveEngine.stream(input, { configurable });
  return await this.processGraphStream(stream, callbacks);
}
```

---

## 二、LLM 客户端对比

### 2.1 手写 SSE 客户端

**文件:** `src/agent/llm-client.ts` (main 分支)

```typescript
export class LLMClient {
  async streamChat(messages, tools, callbacks, options) {
    const apiUrl = `${this.baseUrl}/chat/completions`;
    
    // 1. 手写 fetch + SSE 解析
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        stream: true,  // 手动开启 SSE
      }),
    });
    
    // 2. 手写 ReadableStream + TextDecoder
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let sseBuffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      // 3. 手写 SSE 行分割和 JSON 解析
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        
        const parsed = JSON.parse(data);
        const delta = parsed.choices[0].delta;
        
        // 4. 手写回调分发
        if (delta.content) callbacks.onContent(delta.content);
        if (delta.tool_calls) {
          // 手写 tool_calls 累积逻辑
          for (const tc of delta.tool_calls) {
            toolCallsMap.get(tc.index).arguments += tc.function.arguments;
          }
        }
      }
    }
    
    // 5. 手写 finish_reason 处理
    callbacks.onComplete(finishReason);
  }
}
```

**问题:**
- 约 460 行代码，复杂度高
- 需手动处理 SSE buffer 跨 chunk 不完整行
- 需手动累积 tool_calls（分块到达）
- 需手动处理 reasoning_content
- 错误处理分散在各处

### 2.2 LangChain ChatOpenAI

**文件:** `src/agent/models/chat-model.ts` (langchain-refactor)

```typescript
import { ChatOpenAI } from "@langchain/openai";

export function createChatModels(main: ModelConfig, fast?: ModelConfig): ChatModels {
  const mainModel = new ChatOpenAI({
    openAIApiKey: main.apiKey,
    configuration: { baseURL: main.baseUrl },
    model: main.model,
    streaming: true,
    temperature: 0.3,
  });
  
  return { main: mainModel, fast: fastModel || mainModel };
}
```

**使用方式:**
```typescript
// S0 Router: withStructuredOutput
const router = fastModel.withStructuredOutput(RouterOutputSchema);
const result = await router.invoke([
  { role: 'system', content: PROMPT_S0_ROUTER },
  { role: 'user', content: userMessage },
]);

// S2 Analytical: bindTools + invoke
const modelWithTools = mainModel.bindTools(tools);
const response = await modelWithTools.invoke(messages);

// S4 Formatter: stream
const stream = await mainModel.stream(messages);
for await (const chunk of stream) {
  if (typeof chunk.content === 'string') {
    callbacks.onContent(chunk.content);
  }
}
```

**优势:**
- 仅 44 行代码，极简洁
- SSE 解析由 LangChain 内部处理
- `withStructuredOutput()` 自动 JSON 解析 + 校验
- `bindTools()` 自动处理 tool_calls 格式
- `stream()` 返回 AsyncIterable，无需手动管理 buffer

---

## 三、状态编排对比

### 3.1 手写编排器

**文件:** `src/agent/cognitive-engine/engine.ts` (main)

```typescript
export async function runCognitiveEngine(ctx, callbacks) {
  // 1. 手写状态实例化（单例）
  const routerState = new RouterState();
  const inspectionalState = new InspectionalState();
  const analyticalState = new AnalyticalState();
  const formatterState = new FormatterState(callbacks);
  
  // 2. 手写顺序执行
  callbacks.onProgress('正在研判问题深度...');
  await executeStateWithLogging('Router', routerState, ctx, callbacks);
  
  // 3. 手写 switch-case 路由
  switch (ctx.depth) {
    case 0:
      callbacks.onProgress('日常闲聊模式...');
      break;
    case 1:
      callbacks.onProgress('正在扫描书籍宏观框架...');
      await executeStateWithLogging('Inspectional', inspectionalState, ctx, callbacks);
      break;
    case 2:
      callbacks.onProgress('正在与作者达成共识...');
      await executeStateWithLogging('Analytical', analyticalState, ctx, callbacks);
      break;
  }
  
  // 4. 手写状态传递
  await executeStateWithLogging('Formatter', formatterState, ctx, callbacks);
  
  // 5. 手写输出生成
  return generateOutput(ctx);
}

// 手写超时包装
async function executeStateWithLogging(stateName, state, ctx, callbacks) {
  const timeout = stateName === 'S0-Router' ? 30000 :
                  stateName === 'S2-Analytical' ? 120000 : 60000;
  await withTimeout(state.execute(ctx), timeout, stateName);
}
```

**问题:**
- 状态传递通过 SharedContext 对象（手动管理）
- 路由逻辑是手写 switch-case（难以扩展）
- 无 checkpoint 持久化（重启后丢失状态）
- 无 Human-in-the-Loop 支持

### 3.2 LangGraph StateGraph

**文件:** `src/agent/graph/index.ts` (langchain-refactor)

```typescript
import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';

const workflow = new StateGraph(CognitiveEngineAnnotation)
  // 1. 声明式节点注册
  .addNode('router', routerNode)
  .addNode('inspectional', inspectionalNode)
  .addNode('analytical', analyticalNode)
  .addNode('formatter', formatterNode)
  
  // 2. 声明式边定义
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

// 3. 编译 + Checkpointer
export function createCognitiveEngine(checkpointer) {
  return workflow.compile({ checkpointer });
}
```

**条件边逻辑:**
```typescript
// src/agent/graph/edges.ts
function routeByDepth(state): string {
  if (state.depth === 0) return 'formatter';  // 闲聊跳过 S1/S2
  if (state.depth === 1) return 'inspectional';
  return 'analytical';
}

function routeAfterInspectional(state): string {
  if (state.depth <= 1 && state.structuralAnalysis) return 'done';
  return 'continue';
}
```

**优势:**
- 声明式节点注册（自动管理状态传递）
- 条件边替代 switch-case（可扩展）
- 支持 FileCheckpointer（跨重启恢复）
- 支持 `interrupt()` (Human-in-the-Loop)
- LangSmith 自动追踪所有节点

---

## 四、工具循环对比

### 4.1 手写循环

**文件:** `src/agent/cognitive-engine/states/run-state-loop.ts` (main)

约 625 行代码，核心逻辑：

```typescript
export async function runStateLoop(llmClientManager, toolRegistry, toolContext, options) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
  
  let iterations = 0;
  let totalToolCalls = 0;
  const toolResults = [];
  const loopHistory = new Map();  // 循环检测
  
  // 1. 手写 while 循环
  while (iterations < maxIterations) {
    iterations++;
    
    // 2. 手写 LLM 调用（Promise + callbacks）
    await new Promise<void>((resolve) => {
      llmClient.streamChat(messages, toolDefinitions, {
        onContent: (text) => { accumulatedContent += text; },
        onToolCall: (calls) => { toolCalls = calls; },
        onComplete: () => resolve(),
        onError: (error) => { llmError = error; resolve(); },
      });
    });
    
    // 3. 手写退出条件判断
    if (finishReason !== 'tool_calls') {
      // Self-Verification
      return { content: accumulatedContent, toolResults, iterations };
    }
    
    // 4. 手写消息构建
    messages.push({
      role: 'assistant',
      content: accumulatedContent,
      tool_calls: toolCalls,
    });
    
    // 5. 手写工具执行（并行）
    const executionResults = await Promise.all(
      toolCalls.map(async (tc) => {
        // 手写参数解析
        let args = JSON.parse(tc.arguments);
        
        // 手写拦截器应用
        if (toolInterceptor) args = toolInterceptor(tc.name, args);
        
        // 手写循环检测
        const queryKey = getQueryKey(tc.name, args);
        if (loopHistory.get(tc.name)?.has(queryKey)) {
          return { result: '重复调用警告' };
        }
        loopHistory.get(tc.name).add(queryKey);
        
        // 手写工具调用
        const result = await executeTool(toolRegistry, tc.name, args, toolContext);
        return { result: compressToolResult(result) };
      })
    );
    
    // 6. 手写 tool message 构建
    for (const { tc, result } of executionResults) {
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
      toolResults.push({ toolName: tc.name, args, result });
    }
  }
  
  // 7. 手写强制结论
  if (iterations >= maxIterations || totalToolCalls >= maxToolCalls) {
    messages.push({ role: 'user', content: forcedConclusionPrompt });
    await llmClient.streamChat(messages, [], callbacks);
  }
  
  return { content: accumulatedContent, toolResults, iterations };
}
```

**问题:**
- 手写 while 循环（无图结构）
- 手写消息格式转换
- 手写 tool_calls 累积
- 手写循环检测
- 手写结果压缩
- 无 checkpoint 中断恢复

### 4.2 LangGraph ReAct Subgraph

**文件:** `src/agent/graph/subgraphs/react-loop.ts` (langchain-refactor)

约 431 行代码，核心逻辑：

```typescript
import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import { messagesStateReducer } from '@langchain/langgraph';

// 1. 声明式状态定义
const ReactAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
  iterationCount: Annotation<number>(),
  toolCallCount: Annotation<number>(),
  queriesAsked: Annotation<Record<string, string[]>[]>(),  // 循环检测历史
  toolResults: Annotation<ToolResultRecord[]>(),
});

// 2. Agent Node（使用 LangChain）
async function agentNode(state, config) {
  const reactConfig = config.configurable?.reactLoopConfig;
  const modelWithTools = reactConfig.model.bindTools(reactConfig.tools);
  const response = await modelWithTools.invoke(state.messages, config);
  
  return {
    messages: [response],  // 自动追加
    iterationCount: state.iterationCount + 1,
  };
}

// 3. Tool Node（使用 LangChain StructuredToolInterface）
function createEnhancedToolNode(tools, toolInterceptor) {
  return async function enhancedToolNode(state, config) {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    
    for (const tc of lastMessage.tool_calls) {
      let args = parseToolCallArgs(tc);
      
      // 拦截器
      if (toolInterceptor) args = toolInterceptor(tc.name, args);
      
      // 循环检测
      if (hasLoopDetected(tc.name, args, state.queriesAsked)) {
        messages.push(new ToolMessage({
          content: '重复调用警告',
          tool_call_id: tc.id,
        }));
        continue;
      }
      
      // 执行工具
      const tool = tools.find(t => t.name === tc.name);
      const result = await tool.invoke(args, config);
      
      messages.push(new ToolMessage({
        content: compressToolResult(result),
        tool_call_id: tc.id,
      }));
    }
    
    return { messages, toolResults, toolCallCount };
  };
}

// 4. 条件退出函数
function shouldContinue(state): string {
  const lastMessage = state.messages[state.messages.length - 1];
  
  if (!lastMessage?.tool_calls?.length) return '__end__';
  if (state.iterationCount >= state._maxIterations) return '__end__';
  if (state.toolCallCount >= state._maxToolCalls) return '__end__';
  if (allDuplicates(state)) return '__end__';
  
  return 'tools';
}

// 5. 构建 StateGraph
export function createReactLoopGraph(config) {
  return new StateGraph(ReactAnnotation)
    .addNode('agent', agentNode)
    .addNode('tools', createEnhancedToolNode(config.tools, config.toolInterceptor))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue)
    .addEdge('tools', 'agent');
}

// 6. 执行入口
export async function runReactLoop(messages, config, runnableConfig) {
  const graph = createReactLoopGraph(config);
  const compiled = graph.compile();
  
  const result = await compiled.invoke({
    messages,
    iterationCount: 0,
    toolCallCount: 0,
  }, runnableConfig);
  
  // 强制结论（如果需要）
  if (needsForcedConclusion) {
    const forcedResponse = await config.model.invoke([...messages, forcedPrompt]);
    // Self-Verification
    return verifyAndCleanContent(forcedResponse.content, toolResults);
  }
  
  return { content, toolResults, iterations };
}
```

**优势:**
- StateGraph 声明式定义循环结构
- `messagesStateReducer` 自动追加消息
- `bindTools()` 自动处理 tool_calls 格式
- `tool.invoke()` 直接调用 StructuredToolInterface
- `shouldContinue()` 函数替代手写条件判断
- 可嵌入到主图（作为子图）
- 支持 checkpoint 中断恢复

---

## 五、状态定义对比

### 5.1 手写 SharedContext

**文件:** `src/agent/cognitive-engine/types.ts` (main)

```typescript
export interface SharedContext {
  // 输入
  rawUserQuery: string;
  chatHistory: ChatMessage[];
  
  // S0 输出（手动管理）
  depth: ReadingDepth;
  standaloneQuery?: string;
  
  // S1 输出（手动管理）
  scopeNodeIds?: string[];
  tocSummary?: string;
  betterQuestion?: string;
  
  // S2 输出（手动管理）
  analysisResult?: string;
  s2ToolResults?: ToolResultRecord[];
  
  // 运行时
  indexId: string;
  pdfName: string;
  
  // 引擎依赖
  llmClientManager?: LLMClientManager;
  toolRegistry?: ToolRegistry;
  toolContext?: ToolContext;
  
  // 状态追踪（手动管理）
  executedStates: Set<string>;
  stateResults: Map<string, StateResult>;
}
```

**问题:**
- 所有状态字段在一个对象中（难以区分 reducer 语义）
- 手动管理 `executedStates` 追踪
- 无消息追加语义（需手动 push）

### 5.2 LangGraph Annotation

**文件:** `src/agent/graph/state.ts` (langchain-refactor)

```typescript
import { Annotation, messagesStateReducer } from '@langchain/langgraph';

export const CognitiveEngineAnnotation = Annotation.Root({
  // 消息：append reducer（自动追加）
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  
  // S0 输出：overwrite reducer（直接替换）
  depth: Annotation<number>(),
  rewrittenQuery: Annotation<string>(),
  
  // S1 输出：overwrite reducer
  scopeNodeIds: Annotation<string[]>(),
  tocSummary: Annotation<string>(),
  betterQuestion: Annotation<string>(),
  
  // S2 输出：overwrite reducer
  analysisResult: Annotation<string>(),
  toolResultsSnapshot: Annotation<ToolResultSnapshot[]>(),
  
  // S4 输出：overwrite reducer
  formattedOutput: Annotation<string>(),
  
  // Runtime：overwrite reducer
  bookId: Annotation<string>(),
  pdfName: Annotation<string>(),
});

export type CognitiveEngineState = typeof CognitiveEngineAnnotation.State;
```

**优势:**
- `messagesStateReducer` 自动追加消息
- 明确区分 overwrite vs append reducer
- LangGraph 自动管理状态传递
- 无需手动追踪 `executedStates`

---

## 六、工具定义对比

### 6.1 手写 ToolExecutor

**文件:** `src/agent/tools/types.ts` (main)

```typescript
export interface ToolExecutor {
  definition: ToolDefinition;  // OpenAI function calling 格式
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}

// 手写 JSON Schema
const SEARCH_BOOK_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_book',
    description: '...',
    parameters: {
      type: 'object',
      properties: {
        keywords: { type: 'array', items: { type: 'string' } },
        scope_node_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['keywords'],
    },
  },
};

// 手写注册
function createToolRegistry(skillLoader, context): ToolRegistry {
  const registry = new Map();
  registry.set('search_book', searchBookTool);
  return registry;
}

// 手写执行
async function executeTool(registry, name, args, context) {
  const executor = registry.get(name);
  return executor.execute(args, context);
}
```

### 6.2 LangChain StructuredToolInterface

**文件:** `src/agent/tools/definitions/search-book.ts` (langchain-refactor)

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

// Zod Schema（自动生成 JSON Schema + 校验）
const searchBookSchema = z.object({
  keywords: z.array(z.string()).describe('关键词数组，AND 逻辑'),
  scope_node_ids: z.array(z.string()).optional().describe('限定搜索范围'),
});

export const createSearchBookTool: ToolFactory = (ctx) =>
  tool(
    async (args) => {
      return searchBookTool.execute(args, ctx);
    },
    {
      name: 'search_book',
      description: '...',
      schema: searchBookSchema,  // Zod schema 自动转换
    },
  );

// 注册
function createLangChainTools(ctx): StructuredToolInterface[] {
  return [
    createSearchBookTool(ctx),
    createReadBookSectionTool(ctx),
    // ...
  ];
}

// 使用（直接 invoke）
const tool = tools.find(t => t.name === 'search_book');
const result = await tool.invoke(args, config);
```

**优势:**
- Zod schema 自动生成 JSON Schema
- Zod 自动校验参数类型
- `tool()` 函数简化定义
- 直接 `tool.invoke()` 调用

---

## 七、Prompt 模块对比

### 7.1 迁移路径

| 手写引擎 (main) | LangGraph 引擎 (langchain-refactor) | 变化 |
|----------------|-------------------------------------|------|
| `cognitive-engine/prompts/router-prompt.ts` | `graph/prompts/router-prompt.ts` | 内容不变 |
| `cognitive-engine/prompts/inspectional-prompt.ts` | `graph/prompts/inspectional-prompt.ts` | 内容不变 + Zod schema |
| `cognitive-engine/prompts/analytical-prompt.ts` | `graph/prompts/analytical-prompt.ts` | 内容不变 |
| `cognitive-engine/prompts/formatter-prompt.ts` | `graph/prompts/formatter-prompt.ts` | 内容不变 |

### 7.2 新增 Zod Schema

**手写引擎:**
```typescript
// 无 structured output schema
const response = await llmClient.streamChat(messages, tools, callbacks);
// 手写 JSON 解析
const parsed = JSON.parse(accumulatedContent);
```

**LangGraph 引擎:**
```typescript
import { z } from 'zod';

// RouterOutputSchema
const RouterOutputSchema = z.object({
  depth: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  standalone_query: z.string().optional(),
  reason: z.string().optional(),
});

// InspectionalOutputSchema
const InspectionalOutputSchema = z.object({
  thought_process: z.string(),
  scopeNodeIds: z.array(z.string()),
  better_question: z.string().optional(),
  tocSummary: z.string(),
  structural_analysis: z.string().optional(),
});

// withStructuredOutput 自动解析 + 校验
const router = fastModel.withStructuredOutput(RouterOutputSchema);
const result = await router.invoke(messages);
// result 已是 TypeScript 对象，无需 JSON.parse
```

---

## 八、Checkpoint 持久化对比

### 8.1 手写引擎

```typescript
// 无 checkpoint 持久化
// 重启后所有状态丢失
// 无 Human-in-the-Loop 支持
```

### 8.2 LangGraph FileCheckpointer

**文件:** `src/agent/graph/checkpointer.ts` (langchain-refactor)

```typescript
export class FileCheckpointer extends BaseCheckpointSaver {
  private app: App;
  private checkpointsDir = '.obsidian/plugins/deepreader/checkpoints';
  
  async getTuple(config): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    const filePath = `${this.checkpointsDir}/${threadId}.jsonl`;
    
    const lines = await readJsonlLines(this.app, filePath);
    const record = JSON.parse(lines[lines.length - 1]);
    
    return {
      config: { configurable: { thread_id: threadId, checkpoint_id: record.checkpoint.id } },
      checkpoint: record.checkpoint,
      pendingWrites: await this.loadPendingWrites(threadId, record.checkpoint.id),
    };
  }
  
  async put(config, checkpoint, metadata, newVersions) {
    const threadId = getThreadId(config);
    const filePath = this.checkpointPath(threadId);
    
    await appendJsonlLine(this.app, filePath, JSON.stringify({
      checkpoint: copyCheckpoint(checkpoint),
      metadata,
      ts: Date.now(),
    }));
    
    return { configurable: { thread_id: threadId, checkpoint_id: checkpoint.id } };
  }
}

// 使用
const checkpointer = new FileCheckpointer(app);
const engine = workflow.compile({ checkpointer });

// 执行后自动保存 checkpoint
await engine.invoke(input, { configurable: { thread_id: 'thread-123' } });

// 重启后恢复
await engine.invoke(null, { configurable: { thread_id: 'thread-123' } });
```

---

## 九、Human-in-the-Loop 对比

### 9.1 手写引擎

```typescript
// 无 HITL 支持
// 无法在执行中暂停等待用户反馈
```

### 9.2 LangGraph interrupt()

**文件:** `src/agent/graph/nodes/analytical.ts` (langchain-refactor)

```typescript
import { interrupt } from '@langchain/langgraph';

async function analyticalNode(state, config) {
  const result = await runReactLoop(messages, config);
  
  // HITL interrupt
  const enableHumanReview = config.configurable?.enableHumanReview;
  if (enableHumanReview) {
    const resumeValue = interrupt({
      nodeId: 'analytical',
      question: 'S2 分析完成，是否满意？',
      content: result.content,
    }) as { approved: boolean; feedback: string } | undefined;
    
    if (resumeValue?.approved === false) {
      // 用户不满意，用 feedback 重新运行
      const refinedResult = await runReactLoop([...messages, feedback], config);
      return { analysisResult: refinedResult.content };
    }
  }
  
  return { analysisResult: result.content };
}

// FrontendAgent 处理 interrupt
async resumeGraphExecution(approved, feedback, context, callbacks) {
  const stream = await engine.stream(
    new Command({ resume: { approved, feedback } }),
    { configurable: { thread_id: this.activeThreadId } }
  );
}
```

---

## 十、追踪对比

### 10.1 手写 Langfuse

**文件:** `src/agent/tracing/tracer.ts` (main)

```typescript
// 手写 span 管理
const spanCtx = traceCtx?.withSpan(stateDisplayName, { input: {...} });
await state.execute(ctx);
spanCtx?.end({ output: {...} });

// 手写 generation 管理
const llmGen = loopSpan?.withGeneration(`llm-iter${iterations}`, { input: {...} });
await llmClient.streamChat(messages, tools, callbacks, { traceContext: llmGen });
llmGen?.end({ output: {...} });
```

### 10.2 LangSmith 自动追踪

**文件:** `src/agent/tracing/langsmith.ts` (langchain-refactor)

```typescript
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain';
import { Client } from 'langsmith/client';

export function getLangSmithTracer(config) {
  const client = new Client({ apiKey: config.apiKey });
  return new LangChainTracer({ client, projectName: config.projectName });
}

// 使用（自动追踪所有节点/LLM/工具调用）
const langsmithTracer = getLangSmithTracer({ apiKey, projectName: 'DeepReader' });

await engine.invoke(input, {
  configurable,
  callbacks: [langsmithTracer],  // 自动追踪
});

// 无需手动创建 span/generation
// LangChain 内部自动处理
```

---

## 十一、总结：改造要点

| 改造点 | 手写引擎 | LangGraph 引擎 | 代码量变化 |
|--------|----------|----------------|-----------|
| **LLM 客户端** | 461 行手写 SSE | 44 行 ChatOpenAI | -90% |
| **状态编排** | 207 行手写 switch-case | 51 行 StateGraph | -75% |
| **工具循环** | 625 行手写 while | 431 行 StateGraph | -31% |
| **状态定义** | 手动管理 SharedContext | Annotation 自动管理 | 更清晰 |
| **工具定义** | 手写 JSON Schema | Zod 自动生成 | 更简洁 |
| **Checkpoint** | 无 | FileCheckpointer | 新增 |
| **HITL** | 无 | interrupt() | 新增 |
| **追踪** | 手写 Langfuse span | LangSmith 自动 | -50% |

**核心改造思路:**

1. **替换 LLM 客户端** → 使用 LangChain `ChatOpenAI`
2. **替换状态编排** → 使用 LangGraph `StateGraph`
3. **替换工具循环** → 使用 LangGraph ReAct Subgraph
4. **替换工具定义** → 使用 LangChain `tool()` + Zod
5. **新增 Checkpointer** → FileCheckpointer 持久化
6. **新增 HITL** → `interrupt()` 中断恢复
7. **简化追踪** → LangSmith 自动追踪

**代码质量提升:**

- 类型安全：Zod schema 自动校验
- 可维护性：声明式图结构
- 可扩展性：条件边易于添加新状态
- 可观测性：LangSmith 自动追踪
- 可恢复性：Checkpoint 跨重启恢复