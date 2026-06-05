# L5 — 子图层

> S2 Analytical 内部：Plan-Execute vs ReAct 两套循环模式
>
> 状态机节点内部又嵌套了一层"状态机"——这里是 LangGraph 子图（StateGraph）和子循环（for/while）。

---

## 1. 现状

### 1.1 角色定位

L5 是 S2 Analytical 节点**内部**的"二级调度"：

- S2 Analytical 节点本身只是个 entry point
- 真正"决定怎么调工具、什么时候停、调几次"的是 L5
- L5 把 S2 节点从"调 mainModel 一次"变成"可能调 mainModel 多次 + 工具多次"

### 1.2 三个文件

| 文件 | 角色 |
|------|------|
| `src/agent/graph/subgraphs/plan-execute.ts` | Plan-Execute-Replan 子图（**当前首选**） |
| `src/agent/graph/subgraphs/react-loop.ts` | 经典 ReAct 子图（**已 deprecated**，仅 HITL 等场景保留） |
| `src/agent/graph/subgraphs/tool-execution.ts` | 两者共享的工具执行层 |

### 1.3 入口签名

```typescript
// plan-execute.ts
export async function runPlanExecute(
  messages: BaseMessage[],
  config: ReactLoopConfig,
  runnableConfig?: RunnableConfig,
): Promise<ReactLoopResult>

// react-loop.ts
export function createReactLoopGraph(config: ReactLoopConfig): StateGraph
export async function runReactLoop(...): Promise<ReactLoopResult>
```

两者返回相同的 `ReactLoopResult`：
```typescript
interface ReactLoopResult {
  content: string;
  toolResults: ToolResultRecord[];
  iterations: number;
  finishReason: 'stop' | 'max_iterations' | 'max_tool_calls' | 'loop_detected';
}
```

### 1.4 Plan-Execute-Replan 流程

`runPlanExecute` 的核心循环（`maxPlanRounds = clamp(config.maxToolCalls, 1, 2)`，默认 2）：

```
Round 0 (Plan):
  compressedHistory = messages (no compression yet)
  planResponse = modelWithTools.invoke(history)
  if no tool_calls:
    → return content (含 XML 残留清洗)
  records = executeToolBatch(planResponse.tool_calls)
  history.push(planResponse, ...toolMsgs)

Round 1 (Replan, optional):
  compressedHistory = compressMessagesForLLM(conversationHistory)
  historyWithHint = [...compressed, HumanMessage("基于上一轮检索结果，如有必要请补充检索更多信息。如果已足够，直接回答问题。")]
  planResponse = modelWithTools.invoke(historyWithHint)
  → 同上分支

Final (Synthesize):
  synthesisMessages = compressMessagesForLLM(conversationHistory)
  synthesisResponse = model.invoke([...synthesisMessages, HumanMessage(synthesisPrompt)])
  → return content (verifyAndCleanContent 后)
```

**调用数**：
- 有 tool_calls：1 + 1 + 1 = **3 次 LLM**（plan + replan + synthesize）
- 无 tool_calls：1 次 LLM（plan 直接答）
- 单轮：1 + 1 = 2 次 LLM（plan + synthesize）

**对比 ReAct**：
- ReAct：4-6 次 LLM（每轮 1 次 + 收尾 1 次）
- Plan-Execute：**2-3 次 LLM**

### 1.5 ReAct 循环流程（已 deprecated）

`runReactLoop` 的 `shouldContinue` 退出条件：
1. `!lastMessage?.tool_calls?.length` → `__end__`
2. `iterationCount >= _maxIterations=8` → `__end__`
3. `toolCallCount >= _maxToolCalls=5` → `__end__`
4. `allDuplicates && length > 0`（Loop Detection 命中） → `__end__`

退出后还会做"强迫收尾"：
- 把没回答的 tool_call_id 用 "已跳过" ToolMessage 填充
- 调 `model.invoke` 再做一次 LLM 总结
- 标记 `finishReason` 为 `loop_detected` / `max_tool_calls` / `max_iterations`

### 1.6 共享层：tool-execution.ts

`ReactLoopConfig` / `ReactLoopResult` / `ToolResultRecord` 类型都在这里定义。

核心函数：
- `executeSingleToolCall(tc, tools, interceptor, runnableConfig)` — 调一个工具
- `executeToolBatch(toolCalls, tools, config, runnableConfig)` — 并行调多个
- `compressToolResult(result)` — 超 `MAX_TOOL_RESULT_LENGTH=4000` 截断
- `compressMessagesForLLM(messages)` — 超 `MAX_FULL_TOOL_MESSAGES=2` 把旧 ToolMessage 压成 150 字摘要
- `extractBlockIdsFromResult(result)` — 提取 block_id（防 S4 误判）
- `reportPlan(config, toolCalls, round, maxRounds)` — UI 进度提示

**关键设计**：
- 工具调用**全部 try/catch**，失败转 `Error: <msg>` ToolMessage —— **不 throw**
- 这是 LLM 循环的"防中断"机制
- `interceptor` 钩子让 S2 Analytical 可以注入 `scope_node_ids`（`createScopeInterceptor`）

### 1.7 maxIterations / maxToolCalls / maxPlanRounds 三者关系

| 概念 | 出现于 | 默认值 | 含义 |
|------|--------|--------|------|
| `maxIterations` | `ReactLoopConfig` | ReAct=8, Plan-Execute=6 | LLM 调用（Plan/Replan/Synthesize）次数上限 |
| `maxToolCalls` | `ReactLoopConfig` | ReAct=5, Plan-Execute=3 | 工具调用总次数（累加所有轮） |
| `maxPlanRounds` | 仅 Plan-Execute 内部 | `clamp(maxToolCalls, 1, 2)` = 1\~2 | Plan-Execute 的"轮次数"（每轮 = 1 次 Plan LLM + 1 次并行执行） |

**Plan-Execute 内部关系**：
- `maxToolCalls=3` → `maxPlanRounds=2`（Plan × 2 + Synthesize = 3 次 LLM）
- `maxToolCalls=1` → `maxPlanRounds=1`（Plan × 1 + Synthesize = 2 次 LLM）
- `maxIterations=6` 实际上成了 Plan-Execute 内的兜底上限（**当前实现并未显式检查** `totalIterations >= maxIterations`——plan-execute.ts 中 `maxIterations` 没被使用，实际靠 `maxPlanRounds` 控制）

**ReAct 关系**：`maxIterations` 与 `maxToolCalls` 是**双上限**（`shouldContinue` 同时检查），任一触发就退出。

**S2 节点配置**：
- `maxIterations: 6, maxToolCalls: 3`（正常路径）
- HITL 精修：`maxIterations: 4, maxToolCalls: 3`

**三者配合目的**：
- `maxPlanRounds` 控制**结构复杂度**（避免无限规划）
- `maxToolCalls` 控制**外部副作用次数**（避免反复调搜索消耗 token）
- `maxIterations` 控制**LLM 算力消耗**（避免反复推理）

### 1.8 与 S2 Analytical 节点的关系

S2 Analytical 节点的"主体"：

```typescript
const result = await runPlanExecute(messages, {
  tools: ctxTools.filter(t => s2ToolNames.includes(t.name)),
  model: mainModel,
  maxIterations: 6,
  maxToolCalls: 3,
  forcedConclusionContext: { pdfName, scopeNodeIds: validatedScopeNodeIds },
  toolInterceptor: createScopeInterceptor(validatedScopeNodeIds),
  onProgress,
  signal: abortSignal,
}, config);

state.analysisResult = result.content;
state.toolResultsSnapshot = result.toolResults;
```

工具白名单 `s2ToolNames = ['search_book', 'read_book_section']` **屏蔽** 其它 9+ 工具。

---

## 2. 已知问题

### 2.1 Plan-Execute 的 maxIterations 是死字段

**现象**：`plan-execute.ts` 内 `maxIterations` 参数从 `config` 读到但**从未在循环中使用**。

**根因**：作者意图是"如果总调用次数过多就退出"，但实现上只看 `maxPlanRounds`。

**风险**：如果未来调整 `maxToolCalls` 上限（比如改成 10），`maxPlanRounds` 仍会 cap 在 2，但 LLM 仍会一直调。

**修复**：在 `runPlanExecute` 顶部加 `if (totalIterations >= config.maxIterations) break;`。

### 2.2 ReAct deprecated 但仍占代码

**现象**：`react-loop.ts` 标注 `@deprecated`，但仍保留。

**当前用途**：HITL 路径仍可能用，但 `analytical.ts` 默认走 `runPlanExecute`。

**问题**：
- 双循环模式维护成本
- 测试覆盖分化

**建议**：评估 ReAct 是否仍需保留。HITL 路径走 Plan-Execute 也行。

### 2.3 Loop Detection 只在 ReAct

**现象**：`hasLoopDetected` 逻辑只在 ReAct 子图内，Plan-Execute 没实现。

**后果**：Plan-Execute 的"同一关键词反复搜"不会被检测，浪费 token。

**修复**：把 `hasLoopDetected` 抽到 tool-execution.ts，两个子图共享。

### 2.4 工具白名单写在 S2 节点

**现象**：`s2ToolNames = ['search_book', 'read_book_section']` 写在 `analytical.ts:93-94`。

**问题**：
- S2 / S3 / Advisor 节点各有自己的白名单，分散维护
- 新增工具需要在 3 个地方同步

**建议**：把白名单移到 `src/agent/config/tool-permissions.ts`（按 mode 分组）。

### 2.5 compressMessagesForLLM 阈值硬编码

**现象**：
```typescript
if (messages.length <= 4) return messages;  // ⚠️ magic
if (toolMsgIndices.length <= MAX_FULL_TOOL_MESSAGES) return messages;  // 2
```

**问题**：4 和 2 都是 magic number。

**建议**：挪到 `agent-constants.ts`。

### 2.6 工具错误的"统一 Error: 字符串"

**现象**：所有工具失败转成 `Error: <msg>` ToolMessage。

**问题**：
- LLM 看到的是无结构字符串
- 后续 verifyAndCleanContent 没法区分"工具失败" vs "工具成功但内容空"
- Eval 跑分也难以归类

**建议**：用结构化错误（`{ status: 'ERROR', code, message }`）。

### 2.7 收尾的 verifyAndCleanContent 重复

**现象**：
- Plan-Execute Round 1 退出时调一次 verifyAndCleanContent
- Final Synthesize 后又调一次

**问题**：
- 同一内容被校验两次
- 如果 LLM 修正触发，第二次又会重新生成，浪费 token

**建议**：Final Synthesize 后的 verifyAndCleanContent 改为可选（如果 Round 已 verify 过）。

### 2.8 工具并行调用的顺序依赖

**现象**：`executeToolBatch` 用 `Promise.all` 并行。

**问题**：
- 工具调用是无依赖的，理论上 OK
- 但 `createScopeInterceptor` 注入 `scope_node_ids` 是同步的，没有"上一轮结果"的概念
- 如果 LLM 想"先 search 看一眼再决定 read"，并行会拿不到 search 结果

**根因**：Plan-Execute 模式就是"先想清楚再批量执行"，所以并行是设计意图。但如果 LLM 在 plan 时没想清楚，会在两轮之间重新规划（Replan 机制）。

---

## 3. 优化探讨

### 3.1 ReAct 移除

**选项 A**：完全移除 `react-loop.ts`，只保留 Plan-Execute。
**选项 B**：保留 ReAct 作为"实验模式"，通过 `feature flag` 切换。
**选项 C**：保留 ReAct 但只用于 S3 Syntopical（跨书场景更复杂时）。

**建议**：A 或 B。S2 Analytical 已稳定用 Plan-Execute。

### 3.2 maxIterations 实际生效

```typescript
export async function runPlanExecute(messages, config, runnableConfig) {
  const maxIterations = config.maxIterations ?? 6;
  // ...
  for (let round = 0; round < maxPlanRounds; round++) {
    if (totalIterations >= maxIterations) break;  // ← 新增
    // ...
  }
}
```

### 3.3 Loop Detection 跨子图共享

把 `hasLoopDetected` 抽到 `tool-execution.ts`：

```typescript
export function hasLoopDetected(
  toolCall: ToolCall,
  previousCalls: ToolCall[],
): boolean {
  const signature = `${toolCall.name}:${JSON.stringify(toolCall.args)}`;
  return previousCalls.filter(c => 
    `${c.name}:${JSON.stringify(c.args)}` === signature
  ).length >= 2;  // 同一调用出现 ≥2 次算 loop
}
```

### 3.4 工具白名单集中化

`src/agent/config/tool-permissions.ts`：
```typescript
export const TOOL_PERMISSIONS = {
  s2: ['search_book', 'read_book_section'],
  s3: ['cross_book_search', 'cross_book_read'],  // 假设
  advisor: ['weread_search', 'weread_recommend', 'weread_book_info', 'search_journal'],
  // ...
} as const;
```

### 3.5 工具错误的结构化

```typescript
// 工具实现
return JSON.stringify({ status: 'ERROR', code: 'TIMEOUT', message: '...' });

// executeSingleToolCall 检测
if (content.startsWith('{') && content.includes('"status":"ERROR"')) {
  // 结构化错误路径
}
```

**收益**：LLM 可用不同 prompt 处理不同错误（重试 / 跳过 / 改用其它工具）。

### 3.6 Plan-Execute 的"工具依赖图"模式

**问题**：当前 LLM 在 plan 时不知道工具之间的依赖。

**方案**：让 LLM 输出带依赖关系的 plan：
```json
[
  { "tool": "search_book", "args": {...}, "depends_on": [] },
  { "tool": "read_book_section", "args": {...}, "depends_on": [0] }
]
```

**执行器**：拓扑排序，串行 + 并行混合。

**风险**：实现复杂度高；LLM 输出 JSON 的稳定性需要测试。

### 3.7 Synthesize 阶段的可选 verify

Plan-Execute 已 verify 过的中间结果 → Final Synthesize 时跳过 verify：

```typescript
const alreadyVerified = result.finishReason === 'stop' && round === maxPlanRounds - 1;
if (!alreadyVerified && allToolResults.length > 0) {
  content = (await verifyAndCleanContent(content, allToolResults)).content;
}
```

---

## 4. 关键文件路径

| 文件 | 角色 |
|------|------|
| `src/agent/graph/subgraphs/plan-execute.ts` | Plan-Execute-Replan 子图（首选） |
| `src/agent/graph/subgraphs/react-loop.ts` | ReAct 子图（已 deprecated） |
| `src/agent/graph/subgraphs/tool-execution.ts` | 共享工具执行层 |
| `src/agent/graph/nodes/analytical.ts` | S2 Analytical 节点（调用 L5） |

## 5. 关联文档

- L4 节点层 — S2 Analytical 节点的入口
- L6 工具层 — 子图调用的工具实现
- L8 基础设施层 — `MAX_TOOL_RESULT_LENGTH` / `MAX_FULL_TOOL_MESSAGES` 常量
- ADR-009 S2 多层早停 — S2-Pre 与 S2 Analytical 的早停策略
