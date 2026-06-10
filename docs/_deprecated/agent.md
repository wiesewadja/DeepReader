# DeepReader Agent 架构文档

> 基于 Adler《如何阅读一本书》的认知状态机，使用 LangGraph StateGraph 实现工具调用的 Agent 循环。

---

## 目录

1. [架构概览](#架构概览)
2. [核心组件](#核心组件)
3. [认知状态详解](#认知状态详解)
4. [执行流程](#执行流程)
5. [LangGraph 认知引擎](#langgraph-认知引擎)
6. [工具系统](#工具系统)
7. [数据流](#数据流)
8. [追踪与可观测性](#追踪与可观测性)
9. [文件结构](#文件结构)

---

## 架构概览

### 单引擎架构

DeepReader 使用 **LangGraph** 作为唯一的认知引擎实现：

| 层级 | 实现 | 技术栈 |
|------|------|--------|
| **入口** | FrontendAgent | TypeScript |
| **LLM 客户端** | ChatOpenAI | @langchain/openai |
| **状态机** | StateGraph | @langchain/langgraph |
| **工具调用** | ReAct Subgraph | LangGraph + StructuredToolInterface |
| **Checkpoint** | FileCheckpointer | JSONL 文件持久化 |
| **追踪** | LangSmith | langsmith/client |

### 认知状态机 (S0-S4)

基于 Adler 阅读方法论的四层认知状态：

| 状态 | 名称 | 模型 | 功能 | 工具 |
|------|------|------|------|------|
| **S0** | Router | fast | 深度分类 + 查询重写 | 无 |
| **S1** | Inspectional | fast | 目录扫描 + 范围锁定 | 无 |
| **S2** | Analytical | main | 深度分析 + 工具调用 | search_book, read_book_section |
| **S4** | Formatter | main | 格式化输出 + Self-Verification | 无 |

```
用户查询 → S0 Router → 深度分类
                         ↓
          depth=0 ───────────────→ S4 Formatter → END (日常闲聊)
          depth=1 ─→ S1 Inspectional → S4 Formatter → END (检视阅读)
          depth=2 ─→ S2 Analytical → S4 Formatter → END (分析阅读)
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

### 2. SharedContext (运行时上下文)

**文件:** `src/agent/graph/shared-context.ts`

通过 `config.configurable` 传递给 LangGraph 节点：

```typescript
interface SharedContext {
  // 输入
  rawUserQuery: string
  chatHistory: ChatMessage[]
  
  // S0 输出
  depth: ReadingDepth        // 0 | 1 | 2 | 3
  
  // S1 输出
  scopeNodeIds?: string[]
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
  
  // 依赖
  llmClientManager?: LLMClientManager
  toolContext?: ToolContext
  recentHistorySummaries?: HistorySummary[]
  prevSearchedBlockIds?: string[]
}
```

### 3. CognitiveEngineState (LangGraph 状态)

**文件:** `src/agent/graph/state.ts`

LangGraph StateGraph 的状态定义，使用 Annotation 定义 reducer 语义：

```typescript
export const CognitiveEngineAnnotation = Annotation.Root({
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

// Tool result snapshot for S2 → S4 self-verification
interface ToolResultSnapshot {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  originalResultLength: number;
}
```

### 4. ChatModels (LLM 客户端)

**文件:** `src/agent/models/chat-model.ts`

创建 main/fast 双模型实例：

```typescript
interface ChatModels {
  main: ChatOpenAI;   // S2 Analytical + S4 Formatter (较强模型)
  fast: ChatOpenAI;   // S0 Router + S1 Inspectional (快速/廉价模型)
}

function createChatModels(main: ModelConfig, fast?: ModelConfig): ChatModels {
  const mainModel = new ChatOpenAI({
    openAIApiKey: main.apiKey,
    configuration: { baseURL: main.baseUrl },
    model: main.model,
    streaming: true,
    temperature: 0.3,
  });
  
  // fast 未配置时回退到 main
  const fastModel = fast ? new ChatOpenAI({...}) : mainModel;
  
  return { main: mainModel, fast: fastModel };
}
```

---

## 认知状态详解

### S0: Router (意图路由)

**文件:** `src/agent/graph/nodes/router.ts`

**职责:**
- 使用 fast 模型分类阅读深度 (0=闲聊, 1=检视, 2=分析, 3=主题)
- 重写查询为独立形式（替换代词如"这本书"）

**Prompt 结构 (`src/agent/graph/prompts/router-prompt.ts`):**

```xml
<role>
你是一个极速的阅读意图路由器与上下文重写器。
</role>

<task>
1. 结合【近期聊天记录】，阅读【用户的当前提问】
2. 将用户的当前提问重写为一个完整的、不带代词的独立句子
3. 判断该提问所需的阅读深度 (depth)
</task>

<depth_rules>
- 0 (日常闲聊): 打招呼、系统指令、或完全与书籍内容无关
- 1 (检视阅读): 询问全书大纲、目录结构、宏观总结
- 2 (分析阅读): 探究特定概念定义、询问作者的推演逻辑
- 3 (主题阅读): 明确要求跨书本对比（降级为 2 处理）
</depth_rules>

<output_format>
{
  "depth": 数字 (0, 1, 2, 3),
  "standalone_query": "重写后的独立提问",
  "reason": "一句话分类理由"
}
</output_format>
```

**实现要点:**
- 使用 `withStructuredOutput(RouterOutputSchema)` 确保可靠 JSON 解析
- depth=3 自动降级为 depth=2
- 错误时回退到 depth=2 (分析阅读)

### S1: Inspectional (检视阅读)

**文件:** `src/agent/graph/nodes/inspectional.ts`

**职责:**
- 加载 tree.json 目录结构
- 根据深度分支：
  - **depth=1**: 生成结构检视报告 (structural_analysis)
  - **depth=2**: 锁定章节范围 (scopeNodeIds) + 提供搜索关键词建议

**Tree Loader (`src/agent/graph/utils/tree-loader.ts`):**

```typescript
async function loadTreeJson(app, indexId, pdfName): Promise<OutlineNode[]> {
  // 从 .pageindex/{bookId}/tree.json 加载目录结构
  const treePath = `.pageindex/${bookId}/tree.json`;
  const treeData = JSON.parse(await app.vault.adapter.read(treePath));
  
  return treeToOutlineNodes(treeData.structure, treeData.nodeFileMap);
}

interface OutlineNode {
  node_id: string;
  heading: string;
  level: number;
  file_name?: string;  // Markdown 文件名（含数字前缀）
  summary?: string;
  children?: OutlineNode[];
}
```

**Prompt 结构 (`src/agent/graph/prompts/inspectional-prompt.ts`):**

```xml
<role>
你是一位严谨的结构图书管理员。精通艾德勒的检视阅读法。
</role>

<task_branch name="宏观检视">  <!-- depth=1 -->
用户的意图是了解全书结构、核心主题。
任务：生成详细的《全书结构检视报告》，解答宏观问题。
</task_branch>

<task_branch name="圈定战区">  <!-- depth=2 -->
用户的意图是探究具体细节。
任务：推断最相关的章节，填入 scopeNodeIds（不超过 5 个）。
在 tocSummary 中提供 2-3 组搜索关键词建议。
</task_branch>

<output_format>
{
  "thought_process": "定位思考过程",
  "scopeNodeIds": ["0004", "0005"],
  "better_question": "改写的更符合书籍内容的提问",
  "tocSummary": "为什么这些章节相关，建议搜索哪些关键词",
  "structural_analysis": "结构检视报告或圈定理由"
}
</output_format>
```

### S2: Analytical (分析阅读)

**文件:** `src/agent/graph/nodes/analytical.ts`

**职责:**
- 使用 ReAct 子图进行工具调用的分析循环
- 调用 search_book 和 read_book_section
- 支持 HITL 中断

**Prompt 结构 (`src/agent/graph/prompts/analytical-prompt.ts`):**

```xml
<role>
你是艾德勒学派的阅读分析师。忠于原著，执行分析阅读方式。
</role>

<constraints>
1. 搜索范围由 <locked_scope> 指定，不可跨界
2. 遵守"智慧礼记"：此阶段不对作者观点提出批评，只负责"懂他"
3. 总共只有 5 次工具调用机会，合理分配
</constraints>

<workflow>
0. 若搜索范围少于 3 个章节，直接批量读取完整内容
1. 探索 (不多于2次): 用 search_book 搜索关键词
   - matched_blocks 已含精确段落和 block_id，优先直接利用
2. 精读 (必要时): 用 read_book_section 读取完整内容
   - 推荐使用 node_ids 批量读取多个章节
3. 合成: 提取逻辑骨架（定义、主旨、论述）
</workflow>

<keyword_tips>
- 核心名词优先：提取专有名词，剔除修饰语
- 拆分复合词：不要搜"解决问题的前提"，改用 ["解决问题", "前提"]
- 数组是 AND 逻辑：必须同时出现
</keyword_tips>

<output_rules>
块引用格式：[[书名/文件名#^block_id|自然语言别名]]
- file_name 必须来自工具返回值（含数字前缀）
- 禁止双 ^：#^^p003 是错误的
</output_rules>
```

**Scope Interceptor:**

```typescript
function createScopeInterceptor(scopeNodeIds: string[]) {
  return (toolName, args) => {
    if (toolName === 'search_book' && scopeNodeIds.length > 0) {
      return { ...args, scope_node_ids: scopeNodeIds };
    }
    return args;
  };
}
```

### S4: Formatter (格式化输出)

**文件:** `src/agent/graph/nodes/formatter.ts`

**职责:**
- 将 S2 分析结果格式化为 Obsidian 双链笔记
- 流式输出到 UI
- Self-Verification 清理幽灵 block_id 引用
- HITL 中断（可选）

**Prompt 结构 (`src/agent/graph/prompts/formatter-prompt.ts`):**

```xml
<role>
你是奚童，用户的专属 AI 阅读助理。温和、专业、充满书卷气。
</role>

<rules>
1. 轻度书信体：称呼用户，不使用表格
2. 保持双链：引入原文相关的 wiki 链接
3. 拟人化：简短承接历史语境
4. 无幻觉：只排版后台数据，不编造
5. 书籍名称校验：必须使用 <book> 标签中的书籍名称
</rules>

<obsidian_linking_rules>
别名双链无缝融合法则：
[[书名/文件名#^block_id|符合当前句子语法的自然语言展示文本]]

完美示范：
正如作者所指出的，[[思辨与立场/知识管理实操#^b3a1|管理的最终目的必须走向闭环]]。
</obsidian_linking_rules>

<book_name_validation>
强制修正规则：
提取所有引用链接中的书籍名称，与 <book> 标签对比
如果不一致，强制修正为 <book> 标签中的书籍名称
</book_name_validation>
```

---

## 执行流程

### 完整流程图

```
FrontendAgent.chat(userMessage, context, callbacks)
  │
  └─→ runGraphEngine()
        │
        ├─→ buildGraphConfigurable()
        │     ├─→ createChatModels() → { main, fast }
        │     ├─→ createSharedContext()
        │     ├─→ getLangSmithTracer() (可选)
        │     └─→ return { thread_id, fastModel, mainModel, sharedContext, callbacks, ... }
        │
        └─→ cognitiveEngine.stream({ messages, bookId, pdfName }, { configurable })
              │
              ├─→ START
              │     │
              │     └─→ routerNode (S0)
              │           ├─→ extractLastHumanMessage(messages)
              │           ├─→ fastModel.withStructuredOutput(RouterOutputSchema)
              │           ├─→ invoke([system, user])
              │           └─→ return { depth, rewrittenQuery }
              │
              ├─→ routeByDepth(state)
              │     ├─ depth=0 → 'formatter'
              │     ├─ depth=1 → 'inspectional'
              │     └─ depth=2 → 'analytical'
              │
              ├─→ inspectionalNode (S1) ─────────────────────┐
              │     ├─→ loadTreeJson(app, bookId, pdfName)    │
              │     ├─→ formatTreeStructure(outlineNodes)     │ depth=1
              │     ├─→ fastModel.withStructuredOutput()      │ 或 depth=2
              │     └─→ return { scopeNodeIds, tocSummary,    │
              │                 betterQuestion, structuralAnalysis }
              │                                                 │
              ├─→ routeAfterInspectional(state)                │
              │     ├─ depth=1 + structuralAnalysis → 'done'  │
              │     └─ depth>=2 → 'continue'                  │
              │                                                 │
              ├─→ analyticalNode (S2) ────────────────────────│
              │     ├─→ buildAnalyticalSystemPrompt()          │ depth=2
              │     ├─→ createLangChainTools(toolContext)      │
              │     ├─→ filter: search_book, read_book_section │
              │     ├─→ runReactLoop([messages], config)       │
              │     │     ├─→ agentNode: bindTools + invoke    │
              │     │     ├─→ shouldContinue: check limits     │
              │     │     ├─→ enhancedToolNode: execute tools  │
              │     │     ├─→ loop: agent → tools → agent      │
              │     │     └─→ return { content, toolResults }  │
              │     ├─→ interrupt() (可选 HITL)               │
              │     └─→ return { analysisResult, toolResultsSnapshot }
              │
              ├─→ formatterNode (S4)
              │     ├─→ depth=0: mainModel.stream([casual])
              │     ├─→ depth>=1: buildFormatterSystemPrompt()
              │     ├─→ mainModel.stream([system, user])
              │     ├─→ verifyAndCleanContent(content, toolResults)
              │     ├─→ interrupt() (可选 HITL)
              │     └─→ return { formattedOutput }
              │
              └─→ END
                    │
                    └─→ processGraphStream()
                          ├─→ collect formattedOutput
                          ├─→ detect __interrupt__
                          └─→ return { messages, interrupted? }
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

// 编译（带持久化）
export function createCognitiveEngine(checkpointer: FileCheckpointer | MemorySaver) {
  return workflow.compile({ checkpointer });
}
```

### ReAct Subgraph

**文件:** `src/agent/graph/subgraphs/react-loop.ts`

**核心参数:**

```typescript
interface ReactLoopConfig {
  tools: StructuredToolInterface[];
  model: ChatOpenAI;
  maxIterations: number;    // 默认 8
  maxToolCalls: number;     // 默认 5
  forcedConclusionContext?: {
    pdfName?: string;
    scopeNodeIds?: string[];
  };
  toolInterceptor?: (toolName, args) => args;
  signal?: AbortSignal;
}
```

**流程:**

```
runReactLoop(messages, config)
  │
  ├─→ StateGraph(ReactAnnotation)
  │     .addNode('agent', agentNode)
  │     .addNode('tools', enhancedToolNode)
  │     .addEdge(START, 'agent')
  │     .addConditionalEdges('agent', shouldContinue)
  │     .addEdge('tools', 'agent')
  │
  ├─→ agentNode
  │     ├─→ model.bindTools(tools)
  │     └─→ invoke(messages) → AIMessage (含 tool_calls)
  │
  ├─→ shouldContinue(state)
  │     ├─→ 无 tool_calls → '__end__'
  │     ├─→ iterationCount >= 8 → '__end__'
  │     ├─→ toolCallCount >= 5 → '__end__'
  │     ├─→ 全部重复查询 → '__end__'
  │     └─→ 'tools'
  │
  ├─→ enhancedToolNode
  │     ├─→ 遍历 tool_calls
  │     ├─→ parseToolCallArgs(tc)
  │     ├─→ toolInterceptor(tc.name, args) → 注入 scope_node_ids
  │     ├─→ hasLoopDetected()? → 返回警告消息
  │     ├─→ updateQueriesAsked()
  │     ├─→ tool.invoke(args)
  │     ├─→ compressToolResult() (max 8000 chars)
  │     └─→ ToolMessage + toolResults 记录
  │
  ├─→ 强制结论 (needsForcedConclusion)
  │     ├─→ buildForcedConclusionPrompt()
  │     ├─→ model.invoke([filledMessages, HumanMessage(prompt)])
  │     └─→ verifyAndCleanContent() → Self-Verification
  │
  └─→ 返回: { content, toolResults, iterations, finishReason }
        finishReason: 'stop' | 'max_iterations' | 'max_tool_calls' | 'loop_detected'
```

**循环检测:**

```typescript
function extractQueryKey(toolName, args): string | null {
  if ('query' in args) return String(args.query);
  if ('keywords' in args) return args.keywords.sort().join(',');
  return null;
}

function hasLoopDetected(toolName, args, queriesAsked): boolean {
  const key = extractQueryKey(toolName, args);
  const history = queriesAsked[toolName] ?? [];
  return history.includes(key);
}
```

### Self-Verification

**文件:** `src/agent/graph/utils/self-verification.ts`

验证 S2 分析结果中的 block_id 引用是否真实存在于工具返回内容中：

```typescript
interface VerificationResult {
  content: string;              // 清理后的内容
  totalRefs: number;            // 总引用数
  ghostRefs: number;            // 幽灵引用数（不存在）
  truncatedRefs: number;        // 因截断不可见的引用
  llmCorrectionTriggered: boolean;
}

async function verifyAndCleanContent(content, toolResults) {
  // 1. 提取所有 block_id: [[文件#^block_id|别名]]
  const blockIds = extractBlockIds(content);
  
  // 2. 检查每个 block_id 是否在 toolResults 中存在
  for (const id of blockIds) {
    const status = checkBlockIdExists(id, toolResults);
    if (status === 'ghost') ghostIds.add(id);
  }
  
  // 3. 移除幽灵引用，保留别名文本
  // [[文件#^p001|别名]] → "别名"
  const cleanedContent = removeGhostLinks(content, ghostIds);
  
  // 4. 如果幽灵引用 > 50%，触发 LLM 修正（可选）
  if (ghostCount > totalRefs * 0.5 && options.llmClient) {
    const corrected = await llmClient.chat(correctionMessage);
  }
  
  return { content: cleanedContent, ... };
}
```

### History Summarizer

**文件:** `src/agent/graph/utils/history-summarizer.ts`

为 S2 Analytical 提供历史上下文，避免重复搜索：

```typescript
interface HistorySummary {
  topic: string;        // 本轮主题
  conclusion: string;   // 结论摘要
  blockIds: string[];   // 引用的 block_id
}

function summarizeRecentHistory(history, maxRounds = 3): HistorySummary[] {
  // 从最近的 assistant 消息反向提取
  return rounds.map(([user, assistant]) => ({
    topic: inferTopic(user.content),
    conclusion: truncate(assistant.content, 100),
    blockIds: extractBlockIds(assistant.content),
  }));
}

function extractPrevBlockIds(history): string[] {
  // 从最后一条 assistant 消息提取已搜索的 block_id
  const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
  return extractBlockIds(lastAssistant.content);
}
```

### FileCheckpointer

**文件:** `src/agent/graph/checkpointer.ts`

跨 Obsidian 重启的 checkpoint 持久化：

```
.obsidian/plugins/deepreader/checkpoints/
  {thread_id}.jsonl          — checkpoint 数据（追加写入）
  {thread_id}.writes.jsonl   — pending writes 数据
```

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

所有工具使用 `@langchain/core/tools` 的 `tool()` 函数：

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
      description: `在书中搜索关键词，返回匹配段落片段...`,
      schema: z.object({
        keywords: z.array(z.string()).describe('关键词数组，AND 逻辑'),
        scope_node_ids: z.array(z.string()).optional().describe('限定搜索范围'),
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

### S2 工具子集

S2 Analytical 只使用两个工具：

```typescript
const allTools = createLangChainTools(toolContext);
const s2ToolNames = ['search_book', 'read_book_section'];
const s2Tools = allTools.filter(t => s2ToolNames.includes(t.name));
```

### 核心工具详解

#### search_book

**定义:** `src/agent/tools/definitions/search-book.ts`
**实现:** `src/agent/tools/local/search-text.ts`

```typescript
schema: z.object({
  keywords: z.array(z.string()),      // AND 逻辑
  scope_node_ids: z.array(z.string()).optional(),
})

// 返回格式
{
  status: 'SUCCESS',
  total_hits: number,
  hits: [{
    node_id: string,
    title: string,
    file_name: string,
    matched_blocks: [{
      block_id: string,  // 已去掉 ^ 前缀
      content: string,
    }],
    score: number,
  }],
}
```

#### read_book_section

**定义:** `src/agent/tools/definitions/read-section.ts`
**实现:** `src/agent/tools/local/read-section.ts`

```typescript
schema: z.object({
  node_ids: z.array(z.string()).optional(),  // 批量读取（推荐）
  node_id: z.string().optional(),
  block_id: z.string().optional(),
  heading: z.string().optional(),
})

// 参数优先级: node_ids > node_id+block_id > heading
// 返回格式：章节完整内容，段落末尾标记 ^block_id
```

---

## 数据流

### 状态间数据传递

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
        │ depth: 0|1|2              │ scopeNodeIds: []          │ analysisResult: ""
        │ rewrittenQuery: ""        │ tocSummary: ""            │ toolResultsSnapshot: []
        │                           │ betterQuestion: ""        │
        │                           │ structuralAnalysis: ""    │
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    │
                                    ▼
                              ┌───────────┐
                              │    S4     │
                              │ Formatter │
                              └───┬───────┘
                                  │
                                  │ formattedOutput: ""
                                  │ (传递给 UI)
                                  ▼
```

### configurable 传递

```typescript
const configurable = {
  thread_id: string,
  fastModel: ChatOpenAI,
  mainModel: ChatOpenAI,
  sharedContext: SharedContext,
  chatHistory: ChatMessage[],
  toolContext: ToolContext,
  callbacks: EngineCallbacks,
  enableHumanReview: boolean,
};
```

---

## 追踪与可观测性

### LangSmith Tracing

**文件:** `src/agent/tracing/langsmith.ts`

```typescript
interface LangSmithConfig {
  apiKey: string;
  projectName?: string;  // 默认 "DeepReader"
  apiUrl?: string;       // 默认 LangSmith API
}

function getLangSmithTracer(config): LangChainTracer | null {
  const client = new Client({ apiKey, apiUrl });
  return new LangChainTracer({ client, projectName });
}

// 使用
cognitiveEngine.stream(input, {
  configurable,
  callbacks: [langsmithTracer],  // 自动追踪
});
```

**追踪内容:**
- StateGraph 节点执行
- ChatOpenAI LLM 调用
- StructuredTool 工具调用
- ReAct 循环迭代
- Self-Verification 结果

---

## 文件结构

```
src/agent/
├── index.ts                    # FrontendAgent 主入口
├── types.ts                    # 核心类型 (ChatMessage, ToolDefinition, etc.)
├── llm-client.ts               # LLMClient (非 LangGraph 场景)
│
├── graph/                      # LangGraph 认知引擎
│   ├── index.ts                # StateGraph 编译入口
│   ├── state.ts                # CognitiveEngineAnnotation
│   ├── edges.ts                # routeByDepth, routeAfterInspectional
│   ├── shared-context.ts       # SharedContext + createSharedContext()
│   ├── checkpointer.ts         # FileCheckpointer
│   │
│   ├── nodes/                  # 状态节点
│   │   ├── router.ts           # S0 Router (withStructuredOutput)
│   │   ├── inspectional.ts     # S1 Inspectional (tree.json + structured)
│   │   ├── analytical.ts       # S2 Analytical (runReactLoop)
│   │   └── formatter.ts        # S4 Formatter (stream + self-verification)
│   │
│   ├── prompts/                # 各状态 Prompt
│   │   ├── router-prompt.ts    # S0: 深度分类 + 查询重写
│   │   ├── inspectional-prompt.ts # S1: 目录分析 + 范围锁定
│   │   ├── analytical-prompt.ts # S2: 分析阅读 + 工具指引
│   │   └── formatter-prompt.ts # S4: 格式化 + 双链规则
│   │
│   ├── subgraphs/
│   │   └── react-loop.ts       # ReAct 子图 (工具循环)
│   │
│   └── utils/
│       ├── tree-loader.ts      # 加载 tree.json
│       ├── history-summarizer.ts # 历史摘要
│       ├── self-verification.ts # block_id 验证
│       └── parse.ts            # 输出解析
│
├── models/                     # ChatModel
│   ├── index.ts
│   └── chat-model.ts           # createChatModels(main, fast)
│
├── tools/                      # 工具系统
│   ├── index.ts                # createLangChainTools()
│   ├── types.ts                # ToolContext, ToolExecutor
│   │
│   ├── definitions/            # LangChain tool() 定义
│   │   ├── search-book.ts      # search_book schema + wrapper
│   │   ├── read-section.ts     # read_book_section schema + wrapper
│   │   ├── write-note.ts       # write_note
│   │   ├── memory.ts           # save_memory, search_memory
│   │   ├── profile.ts          # update_profile
│   │   ├── search-read-books.ts # search_read_books
│   │   ├── canvas.ts           # canvas
│   │   ├── excalidraw.ts       # excalidraw
│   │   ├── sub-agent.ts        # check_sub_agent
│   │   └── types.ts            # ToolFactory
│   │
│   ├── local/                  # 本地工具实现
│   │   ├── index.ts
│   │   ├── search-text.ts      # search_book 实现 (BM25 + vector)
│   │   ├── read-section.ts     # read_book_section 实现
│   │   ├── utils.ts            # 辅助函数
│   │   └── types.ts            # OutlineNode, SearchHit, LocalToolCache
│   │
│   ├── memory.ts               # save/search_memory 实现
│   ├── profile.ts              # update_profile 实现
│   ├── write-note.ts           # write_note 实现
│   ├── canvas.ts               # canvas 实现
│   ├── excalidraw.ts           # excalidraw 实现
│   ├── create-sub-agent.ts     # subagent 实现
│   ├── base.ts                 # 基础工具类
│   └── skill.ts                # skill 工具
│
├── tracing/                    # 追踪系统
│   ├── index.ts                # 入口
│   ├── langsmith.ts            # LangSmith Tracer
│   ├── tracer.ts               # Langfuse Tracer
│   ├── trace-context.ts        # TraceContext
│   ├── noop-tracer.ts          # Noop Tracer
│   └── types.ts                # ITracer, ITraceContext
│
├── context/                    # 上下文构建
│   ├── index.ts
│   ├── builder.ts              # ContextBuilder (buildSystemPrompt)
│   └── loader.ts               # ContextLoader
│
├── memory/                     # 长期记忆
│   ├── index.ts
│   ├── store.ts                # MemoryStore (MEMORY.md)
│   ├── consolidator.ts         # 记忆压缩
│   ├── milestones.ts           # 里程碑
│   └── types.ts
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
    ├── logger.ts               # agentLog
    ├── result.ts
    ├── book-note.ts
    ├── link-validator.ts
    └── plugin-data.ts
```

---

## 附录

### A. 配置字段

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

### B. ReAct 循环限制

| 参数 | 默认值 | 说明 |
|------|--------|------|
| maxIterations | 8 | agent → tools 循环次数 |
| maxToolCalls | 5 | 累计工具调用次数 |
| MAX_TOOL_RESULT_LENGTH | 8000 | 单次工具结果压缩上限 |

### C. 输出格式约定

**block_id 引用:**
```
[[书名/文件名#^block_id|别名]]

示例：
[[金钱心理学/14 - 存钱 第10章#^p003|储蓄率的关键作用]]
```

**注意事项:**
- file_name 必须来自工具返回（含数字前缀）
- block_id 来自 matched_blocks.block_id（已去 ^ 前缀）
- 禁止双 ^：`#^^p003` 是错误的

---

## 变更日志

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-04-13 | v0.10.0 | LangGraph 引擎首次实现 |
| 2026-04-14 | v0.10.0 | 删除 Legacy 引擎，统一为 LangGraph |
| 2026-04-14 | v0.10.0 | 迁移 cognitive-engine/states/ 到 graph/nodes/ |
| 2026-04-14 | v0.10.0 | 迁移 prompts 到 graph/prompts/ |
| 2026-04-14 | v0.10.0 | 添加 LangSmith tracing |
| 2026-04-14 | v0.10.0 | 删除 useLangGraphEngine 配置（始终使用 LangGraph） |