# L2 — LangGraph 状态机层

> `cognitiveEngine` 的注册表 + 边 + checkpointer
>
> 状态机层的"骨架"：节点做什么不归这里管，节点之间怎么走、谁先谁后、谁中断归这里管。

---

## 1. 现状

### 1.1 角色定位

L2 是 LangGraph 的**纯编排层**。它：

- ✅ 注册节点（`addNode`）和安全包装（`safeNode`）
- ✅ 定义条件边（`addConditionalEdges`）
- ✅ 编译图（`workflow.compile({ checkpointer })`）
- ✅ 提供 checkpointer（`MemorySaver`）支持 HITL interrupt
- ❌ 不实现节点逻辑（节点在 L4）
- ❌ 不构造 state（state schema 在 `state.ts`，初始值在 L1）

### 1.2 完整拓扑

```
                    +-----------------------+
                    | START                 |
                    +-----------+-----------+
                                |
                 +--------------+----------------+
                 |  routeFromStart               |
                 |  proactive -> INSPECTIONAL    |
                 |  无书+WeRead -> ADVISOR       |
                 |  无书 -> FORMATTER            |
                 |  有书 -> INSPECTIONAL         |
                 +-------+----------------------+
                         |
                         v
                 +-----------------------+
                 | INSPECTIONAL (S1)     |
                 | (含 S0 Router 功能)    |
                 | safeInspectional      |
                 +-----------+-----------+
                             |
               +-------------+-------------------+
               | (depth=0 casual / socratic)      |
               |               -> FORMATTER       |
               | (depth=3 syntopical)             |
               |               -> SYNTOPICAL(S3)  |
               | (depth=1 + 图)                   |
               |               -> VISUALIZER      |
               | (depth=1 无图 / depth=2)         |
               |               -> PRE_SEARCH      |
               +---------------------------------+
```

### 1.3 节点注册

`src/agent/graph/index.ts` 中：

| 节点名 | 实际函数 | safeNode 包装 | 备注 |
|--------|---------|---------------|------|
| `INSPECTIONAL` | `inspectionalNode` | ✅ `safeInspectional` | 合并了 S0 Router 功能，失败 → depth=2 空 scope |
| `PRE_SEARCH` | `preSearchNode` | ✅ `safePreSearch` | 失败 → pass-through 到 analytical |
| `ANALYTICAL` | `analyticalNode` | ✅ `safeAnalytical` | 失败 → 空 analysisResult |
| `SYNTOPICAL` | `syntopicalNode` | ✅ inline safe | 失败 → 空 analysisResult |
| `ADVISOR` | `advisorNode` | ✅ inline safe | 失败 → 空 analysisResult |
| `VISUALIZER` | `visualizerNode` | ✅ `safeNode` | 图表生成失败时返回原 analysisResult |
| `FORMATTER` | `formatterNode` | ✅ `safeFormatter` | 唯一 `fallbackAction='abort'` |

**关键不变量**：所有业务节点都有 safeNode 包装（**safeNode 是图的核心防御**）。没有单独的 "Router" 节点——路由判定现在在 inspectional 节点内部完成，而 `routeFromStart` 只是纯 TS 入口门卫。

### 1.4 边与路由决策

`src/agent/graph/edges.ts` 中四个条件边函数：

| 函数 | 来源节点 | 决策依据 | 目标 |
|------|---------|---------|------|
| `routeFromStart(state)` | START | `resolveMode(state)` + `pdfName` + `wereadAvailable` | proactive→INSPECTIONAL, 无书+WeRead→ADVISOR, 无书→FORMATTER, 有书→INSPECTIONAL |
| `routeAfterInspectional(state)` | INSPECTIONAL | mode + depth + nodeErrors | 多目标（见拓扑图） |
| `routeAfterPreSearch(state)` | PRE_SEARCH | `earlyStopContent` + `correctionDetected` + `verifiedFullBookHits` | 早停→VISUALIZER/FORMATTER, 纠错/L5→ANALYTICAL, 否则→ANALYTICAL |
| `routeAfterAnalysis(state)` | ANALYTICAL/SYNTOPICAL | `hasDiagramIntent` | 图表→VISUALIZER, 否则→FORMATTER |

**`resolveMode` 优先级**（`engine-helpers.ts`）：
```typescript
function resolveMode(state) {
  // 1. explicit state.mode
  // 2. proactiveTrigger 存在 → 'proactive'
  // 3. 默认 'normal'
}
```

**`hasDiagramIntent` 现状**：当前**永远返回 false**（图表生成已迁到 Hermes MCP，未在 LangGraph 节点内实现）。

### 1.5 SafeNode 防御机制

`src/agent/graph/utils/safe-node.ts` 的核心逻辑：

```typescript
function safeNode(name, node, fallback) {
  return async (state, config) => {
    try {
      return await node(state, config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const nodeError: NodeError = {
        message,
        recoverable: name !== NODE_NAMES.FORMATTER,  // ⚠️ formatter 不可恢复
        fallbackAction: FALLBACK_ACTIONS[name] || 'skip_to_formatter',
      };
      // 1. 写进 state.nodeErrors
      // 2. 返回 fallback 提供的"占位输出"
      return {
        ...fallback(state, err),
        nodeErrors: { ...state.nodeErrors, [name]: nodeError },
      };
    }
  };
}
```

**FALLBACK_ACTIONS**：
```typescript
{
  inspectional: 'global_search',
  pre_search:   'global_search',
  formatter:    'abort',           // ⚠️ 唯一可能中止
  // 其它节点默认 'skip_to_formatter'
}
```

### 1.6 Checkpointer 与 HITL Interrupt

```typescript
export const cognitiveEngine = workflow.compile({
  checkpointer: new MemorySaver(),  // 内存版（重启即失）
});
```

**HITL 流程**：
1. S4 formatter 在 `enableHumanReview=true` 时调 `interrupt({ nodeId: 'formatter', content: '...' })`
2. LangGraph 抛 `GraphInterrupt`，stream 在 stream-processor 中被检测（`__interrupt__` chunk）
3. `processGraphStream` 返回 `{ messages: [], interrupted: { nodeId, content } }`
4. UI 层弹窗展示 content
5. 用户点击"继续"或"重新生成" → `frontendAgent.resumeGraphExecution(approved, feedback, context, callbacks)`
6. `Command({ resume: { approved, feedback } })` 注入 streamInput
7. LangGraph 从中断点继续执行

**已知问题**：见 §2。

### 1.7 节点名称集中管理

`src/agent/graph/node-names.ts` 用 `as const` 集中节点名常量：

```typescript
export const NODE_NAMES = {
  ROUTER: 'router',          // 历史遗留，图结构中不再使用
  INSPECTIONAL: 'inspectional',
  PRE_SEARCH: 'pre_search',
  ANALYTICAL: 'analytical',
  SYNTOPICAL: 'syntopical',
  ADVISOR: 'advisor',
  VISUALIZER: 'visualizer',
  FORMATTER: 'formatter',
} as const;
```

边的虚拟目标 `DONE`（映射到 `FORMATTER`）也通过 `EDGE_KEYS` 集中。

---

## 2. 已知问题

### 2.1 hasDiagramIntent 永远返回 false

**现象**（已修复）：`hasDiagramIntent` 曾被硬编码为 `return false`，VISUALIZER 节点永远不会被路由到。

**现状**：`hasDiagramIntent` 已激活，基于正则匹配用户消息中的可视化关键词（11 种）。VISUALIZER 节点已从占位升级为真实的 Excalidraw 图表生成节点。详见 [L4 第 7 节](./L4-nodes.md#7-visualizer统一图表生成) 和 [excalidraw-visualization.md](../../features/excalidraw-visualization.md)。

### 2.2 SafeNode fallbackAction 命名混乱

`NodeError.fallbackAction` 枚举值是字符串字面量：

```typescript
type FallbackAction = 'global_search' | 'skip_to_formatter' | 'abort';
```

但**这些 action 没有任何代码会读它**。`safeNode` 的实现只是把 `fallbackAction` 写进 `NodeError` 对象，没有根据这个值做不同分支。

**后果**：
- 命名暗示有不同行为，实际无差异
- 是 S4 formatter 通过 `appendErrorHints` 读 `nodeErrors[*]` 然后追加 `> [!hint]` 提示给用户

**证据**：`safe-node.ts` 全文件搜索 `fallbackAction`，**没有任何 if 分支**。

### 2.3 MemorySaver 重启即失

**现象**：`new MemorySaver()` 是 LangGraph 自带的**内存版** checkpointer，进程重启后所有 threadId 失效。

**后果**：
- 用户关掉 Obsidian 再打开，HITL 中断状态丢失（但 S4 formatter 的 interrupt 通常在一次 stream 内完成，影响有限）
- 真正的"会话级记忆"无法持久化（用户切换书后想继续上次对话，会从零开始）

**优化方向**（见 §3）：实现 `FileSystemSaver` 或对接 SQLite。

### 2.4 INSPECTIONAL 失败时 scope 退化无提示

`safeInspectional` 在 tree 加载为空时：
```typescript
return {
  scopeNodeIds: [],
  tocSummary: '无法获取目录结构，使用全局搜索',
  ...
};
```

**现象**：fallback 把 `scopeNodeIds=[]`，下游 PRE_SEARCH / ANALYTICAL 会走"无 scope"路径，但**用户感知不到"目录加载失败"**——他们只看到 S2 返回了一个不太相关的答案。

**根因**：`NODE_ERROR_HINTS.inspectional` 字符串 `'⚠️ 结构分析暂时不可用，已使用全书范围搜索。'` 写在 `state.ts` 但**只在 S4 formatter 的 `appendErrorHints` 里读**，而 S4 只在 normal 路径才追加。

### 2.5 formatter 的 'abort' 让图静默失败

**现象**：`safeNode` 给 formatter 标 `fallbackAction='abort'`，但实际实现没读这个值。formatter 失败时**整个 stream 不返回任何消息**——用户看不到错误。

**对比**：其它节点失败会返回 `fallback` 提供的空结果，下游 S4 还能跑一遍。

**后果**：
- formatter 是 S4 美化输出，正常路径不该挂
- 但万一挂了（LLM 错误、prompt 解析失败），用户连错误信息都看不到
- `executeWithStream` 兜底会捕获 `GraphInterrupt` 但 formatter 异常是别的类型

### 2.6 PROACTIVE 模式直接走 INSPECTIONAL

**现象**：`routeFromStart` 在 proactive 模式直接走到 INSPECTIONAL。

**现状**：由于 S0 Router 已合并到 INSPECTIONAL，proactive 模式走 INSPECTIONAL 意味着也会走一遍 LLM 深度判定——但 INSPECTIONAL 内的 depth 分类会受 proactive 注入的 prompt 影响。

### 2.7 边决策函数没有单元测试

`edges.ts` 是状态机"调度"的核心，但**没有专门的单测**（推测，需要确认）。`routeFromStart` 的 3 个分支、`routeAfterInspectional` 的 5 个分支全是隐式行为。

**风险**：改 prompt 或新增 mode 时容易踩雷。

---

## 3. 优化探讨

### 3.1 VISUALIZER 节点（已实现）

**已选择选项 B**：VISUALIZER 已实现真实的 Excalidraw 图表生成。`hasDiagramIntent` 已激活，三个路由点（`routeAfterInspectional`、`routeAfterPreSearch`、`routeAfterAnalysis`）在检测到可视化意图时路由到 VISUALIZER。详见 [excalidraw-visualization.md](../../features/excalidraw-visualization.md)。

### 3.2 NodeError.fallbackAction 实际生效

当前 `fallbackAction` 是死字段。可以改造为：
- `'global_search'` → 在 INSPECTIONAL/PRE_SEARCH 失败时，**显式给 PRE_SEARCH 一个 fallback scope**（如 `pdfName` 根节点）
- `'skip_to_formatter'` → 在 ANALYTICAL 失败时，**用 S1 的 betterQuestion + tocSummary 拼一个最小分析**（不调 mainModel）
- `'abort'` → 真的中断 stream（throw），让 `executeWithStream` 暴露错误

**价值**：让"降级"有真实差异，而不是"统一降级到空"。

### 3.3 FileSystemSaver 替代 MemorySaver

**实现思路**：
- checkpointer 继承 LangGraph 的 `BaseCheckpointSaver`
- `put` 写 `sessions/{threadId}/checkpoints/{ts}.json`
- `get` 读最新一个
- `list` 列 threadId

**难点**：
- LangGraph 0.x/1.x 的 `BaseCheckpointSaver` 接口可能不同
- 并发读写的原子性
- 旧 checkpoint 的 GC

**建议**：先做 PoC，单 threadId 验证 IO 模式，再批量替换。

### 3.4 NODE_ERROR_HINTS 的统一曝光

**当前问题**：`NODE_ERROR_HINTS` 在 S4 的 `appendErrorHints` 里追加，但**只在 normal 路径**。

**建议**：
- 在 stream-processor 里检测 `state.nodeErrors`，统一把 hint 推给 `callbacks.onProgress`
- 用户的"表情"系统可以显示降级状态
- 不依赖 S4 formatter 跑完才看到

### 3.5 边函数的纯化 + 单测

把 `routeFromStart` / `routeAfterInspectional` 等函数的依赖项**显式注入**（而不是从 state 里取 hidden 字段），便于单测：

```typescript
// 当前
export function routeFromStart(state: CognitiveEngineState): string { ... }

// 建议
export function routeFromStart(deps: {
  depth: ReadingDepth;
  pdfName: string;
  crossBookMode: boolean;
  wereadAvailable: boolean;
  mode: EngineMode;
}): string { ... }
```

**收益**：每个分支可以写 1-2 个单测（`<5 个 it()` 就覆盖完）。

### 3.6 Proactive 模式重新设计

当前 proactive 直跳 INSPECTIONAL（INSPECTIONAL 内含 depth 分类，会受到 proactive prompt hint 影响）。可以演化为：
- 为 proactive 加独立的 PROACTIVE_GUIDE 节点（用 PROACTIVE_SYSTEM_PROMPT）
- 或让 proactive 走完整的 INSPECTIONAL 但使用特殊 system prompt

---

## 4. 关键文件路径

| 文件 | 角色 |
|------|------|
| `src/agent/graph/index.ts` | 图的编译（`cognitiveEngine = workflow.compile()`） |
| `src/agent/graph/state.ts` | State Schema（`CognitiveEngineAnnotation`） |
| `src/agent/graph/edges.ts` | 4 个条件边函数 |
| `src/agent/graph/node-names.ts` | 节点名常量 |
| `src/agent/graph/node-io.ts` | RouterInput / 其他输入类型 |
| `src/agent/graph/utils/safe-node.ts` | 节点安全包装 |
| `src/agent/graph/utils/engine-helpers.ts` | `resolveMode` / `resolveCurrentChapterName` |

## 5. 关联文档

- L1 FrontendAgent 入口层 — 调用 `cognitiveEngine.stream()`
- L3 流处理层 — 接收 `streamMode: 'updates'` 的 chunks
- L4 节点层 — 节点实现细节
- ADR-003 LangGraph 状态机 — 选型决策
- ADR-009 S2 多层早停 — PRE_SEARCH / ANALYTICAL 早停策略
