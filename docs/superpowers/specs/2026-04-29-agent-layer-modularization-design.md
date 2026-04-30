# Agent 层模块化改造设计

> **日期**: 2026-04-29
> **范围**: `src/agent/` (126 文件, ~17,800 行)
> **目标**: 解循环依赖、消全局单例、提接口契约，让核心模块可测试可替换

---

## 背景

Agent 层是 DeepReader 的 AI 认知引擎，基于 LangGraph 实现四层阅读模型。当前存在以下结构性问题：

1. **高危循环依赖**: `agent-loop.ts → tools/index.ts → create-sub-agent.ts → subagent/manager.ts → agent-loop.ts`
2. **全局可变单例**: `create-sub-agent.ts` 用模块级变量 `globalSubagentManager` 持有 Manager 实例，类型系统无法保证初始化顺序
3. **跨模块反向依赖**: `agent/utils/embedding-cache.ts` ↔ `pageindex/book-search-v2.ts` 形成双向循环
4. **接口缺失**: 除 `ToolExecutor` 和 `ITracer` 外，所有模块都是具体类直接导入，无法独立测试或替换
5. **零测试覆盖**: agent-loop(836行)、subagent/manager(527行)、memory、session、context 等核心模块无单元测试

这些问题导致 AI 协作时修改范围不可控：改 agent-loop 可能牵连 subagent，改 embedding-cache 可能影响 pageindex，无法对单个模块做隔离测试。

---

## 设计

### 1. 解循环依赖：注入函数接口

**问题链:**
```
agent-loop.ts → tools/index.ts → create-sub-agent.ts → subagent/manager.ts → agent-loop.ts
```

**解法:**

在 `subagent/types.ts` 新增函数签名，与 `runAgentLoop` 实际签名一致（agent-loop.ts:280-287）：

```typescript
// subagent/types.ts
export type AgentLoopRunner = (
  client: LLMClient,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  toolRegistry: ToolRegistry,
  context: ToolContext,
  options: AgentLoopOptions,
) => Promise<ChatMessage[]>;
```

`subagent/manager.ts` 不再 `import { runAgentLoop }`（第 15 行），改为构造时注入：

```typescript
class SubagentManager {
  private runLoop: AgentLoopRunner;

  constructor(opts: { runLoop: AgentLoopRunner; client: LLMClient; ... }) {
    this.runLoop = opts.runLoop;
    this.client = opts.client;
    // ...
  }

  // 原 runLoop() 内部调用 this.runLoop(this.client, messages, tools, this.toolRegistry, this.context, {...})
}
```

`FrontendAgent`（`agent/index.ts`）初始化时注入具体实现：

```typescript
this.subagentManager = new SubagentManager({
  runLoop: runAgentLoop,
  client: this.client,
  toolRegistry: this.toolRegistry,
  context: this.toolContext,
  ...
});
```

**涉及文件:**
- `src/agent/subagent/types.ts` — 新增 `AgentLoopRunner` 类型（需 import LLMClient, ChatMessage, ToolDefinition, ToolRegistry, ToolContext, AgentLoopOptions）
- `src/agent/subagent/manager.ts` — 移除第 15 行 `import { runAgentLoop }`，构造函数新增 `runLoop` 参数
- `src/agent/index.ts` — 注入 `runAgentLoop` 到 SubagentManager 构造函数

### 2. 消全局单例：通过 ToolContext 传入

**问题:**
`create-sub-agent.ts` 用模块级变量 `let globalSubagentManager`（约第 94 行）持有 Manager，通过 `setSubagentManager()` / `getSubagentManager()` 操作。`createSubAgentTool` 和 `checkSubAgentTool` 两个 tool executor 都调用 `getSubagentManager()`。

**解法:**

在 `ToolContext`（`agent/tools/types.ts`）新增字段：

```typescript
interface ToolContext {
  // ... existing fields
  subagentManager?: ISubagentManager;
}
```

`create-sub-agent.ts` 的 `createSubAgentTool` 和 `checkSubAgentTool` 从 `toolContext` 拿 manager：

```typescript
const manager = toolContext.subagentManager;
if (!manager) return 'SubagentManager not available';
```

删除以下导出：
- `globalSubagentManager` 变量
- `setSubagentManager()` 函数
- `getSubagentManager()` 函数

`FrontendAgent` 构造 ToolContext 时注入：

```typescript
const toolContext: ToolContext = {
  ...existingFields,
  subagentManager: this.subagentManager,
};
```

**涉及文件:**
- `src/agent/tools/types.ts` — ToolContext 新增 `subagentManager?: ISubagentManager` 字段
- `src/agent/tools/create-sub-agent.ts` — 删除全局变量和 setter/getter，`createSubAgentTool` 和 `checkSubAgentTool` 都改为从 toolContext 读取
- `src/agent/index.ts` — 构造 ToolContext 时注入 subagentManager；删除对 `setSubagentManager()` 的调用

### 3. 跨模块反向依赖：embedding-cache 下沉

**问题:**
```
agent/utils/embedding-cache.ts → pageindex/vault/vectors.ts
pageindex/book-search-v2.ts   → agent/utils/embedding-cache.ts
```

embedding-cache 缓存的是 pageindex 的向量生成能力，放在 agent 层不合理。

**解法:**

将 `agent/utils/embedding-cache.ts` 移到 `pageindex/vault/embedding-cache.ts`。

依赖方向变为单向：
```
agent/utils/syntopical-search.ts → pageindex/vault/embedding-cache.ts
pageindex/book-search-v2.ts      → pageindex/vault/embedding-cache.ts (同模块)
pageindex/vault/embedding-cache.ts → pageindex/vault/vectors.ts (同模块)
```

**涉及文件:**
- `src/agent/utils/embedding-cache.ts` → 移动到 `src/pageindex/vault/embedding-cache.ts`
- `src/pageindex/book-search-v2.ts` — 更新 import 路径
- `src/agent/utils/syntopical-search.ts` — 更新 import 路径
- `src/agent/utils/__tests__/syntopical-search.test.ts` — 更新 import 路径

### 4. 接口提取

在每个模块已有的 `types.ts` 中新增接口定义，不创建新文件。接口签名基于实际代码，不是臆造。

#### 4.1 IMemoryStore (`memory/types.ts`)

基于 `memory/store.ts` 的实际公共方法（store.ts:68-363）：

```typescript
export interface IMemoryStore {
  readLongTermMemory(): Promise<string | null>;
  writeLongTermMemory(content: string): Promise<void>;
  getMemoryContext(): Promise<string>;
  getMemoryLineCount(): Promise<number>;
  appendHistory(entry: string): Promise<void>;
  readHistory(limit?: number): Promise<string>;
  searchHistory(query: string, limit?: number): Promise<string[]>;
  searchDialogueSummaries(bookName: string, limit?: number): Promise<string[]>;
  getReadingSummary(): Promise<string>;
  needsCompression(): Promise<boolean>;
  initializeMemory(): Promise<void>;
}
```

消费方（FrontendAgent、sidebar-view）改为依赖 `IMemoryStore`。

#### 4.2 ISessionStore (`session/types.ts`)

基于 `session/store.ts` 的实际公共方法：

```typescript
export interface ISessionStore {
  create(sessionId: string, indexId: string, isCrossBook?: boolean): Promise<Session>;
  save(session: Session): Promise<void>;
  get(sessionId: string): Promise<Session | null>;
  getMessages(sessionId: string): Promise<ChatMessage[]>;
  getLLMHistory(sessionId: string): Promise<ChatMessage[]>;
  appendMessage(sessionId: string, message: ChatMessage): Promise<void>;
  appendMessages(sessionId: string, messages: ChatMessage[]): Promise<void>;
  delete(sessionId: string): Promise<void>;
  deleteMessages(sessionId: string, messageIndices: number[]): Promise<void>;
  listSessions(): Promise<SessionMeta[]>;
  findSessionByIndexId(indexId: string): Promise<SessionMeta | null>;
}
```

定义在 `session/types.ts`（已有 Session、SessionMeta 类型）。

#### 4.3 ISubagentManager (`subagent/types.ts`)

基于 `subagent/manager.ts` 的实际公共方法（manager.ts:116-514）：

```typescript
export interface ISubagentManager {
  spawn(description: string, label?: string, sessionId?: string): string;
  waitFor(taskId: string, timeout?: number): Promise<SubagentTask | undefined>;
  cancel(taskId: string): Promise<boolean>;
  getTask(taskId: string): SubagentTask | undefined;
  listTasks(sessionId?: string): SubagentTask[];
}
```

`create-sub-agent.ts` 依赖 `ISubagentManager` 而非具体类。ToolContext 中引用 `ISubagentManager` 接口。

#### 4.4 IContextBuilder (`context/index.ts`)

基于 `context/builder.ts` 的实际公共方法：

```typescript
export interface IContextBuilder {
  buildSystemPrompt(skillsSummary: string, documentMetadata?: any, docDescription?: string): Promise<string>;
  loadRelevantDialogueSummaries(bookName: string, limit?: number): Promise<string>;
}
```

Graph nodes 通过 config.configurable.sharedContext 接收，已解耦。此接口主要服务于测试。

---

## 不做的事

| 不做 | 原因 |
|------|------|
| 重组 agent 目录结构 | 126 文件改 import 路径，纯机械劳动，收益低 |
| 给 agent-loop 提接口 | 内部编排逻辑，只有 FrontendAgent 调用 |
| 给 graph nodes 提接口 | LangGraph 框架已约束节点函数签名 |
| 给 LLMClient 提接口 | 已通过 LangChain ChatOpenAI 抽象 |
| 动 config/ 循环依赖 | 运行时无感，优先级低 |
| 动 pageindex 内部循环 | 类型层循环，运行时无影响 |

---

## 验证

每步改造后执行：

```bash
# 1. 循环依赖检测
npx madge --circular src/main.ts

# 2. 类型检查
npx tsc --noEmit

# 3. 现有测试
npx vitest run src/agent/

# 4. 手动验证：Obsidian 中触发子 Agent、搜索、记忆功能正常
```

改造完成后目标状态：
- `npx madge --circular src/main.ts` 报告中 agent 相关循环为 0
- 无全局可变状态（`globalSubagentManager` 已删除）
- `SubagentManager` 可通过注入 mock `AgentLoopRunner` 独立测试
- `MemoryStore`、`SessionStore` 可通过接口 mock 替换

---

## 实施顺序

1. **新增 `AgentLoopRunner` 类型 + 改 `SubagentManager` 构造注入** — 断循环
2. **`ToolContext` 新增 subagentManager + 删除全局变量** — 消单例
3. **移动 `embedding-cache.ts`** — 解跨模块循环
4. **提取 `IMemoryStore`、`ISessionStore`、`ISubagentManager`、`IContextBuilder`** — 可测试可替换
5. **验证 + 清理** — madge、tsc、vitest 全过
