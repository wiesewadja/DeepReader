# Subgraphs 详解

> DeepReader LangGraph 状态机的**子图复用层**——`react-loop.ts`（ReAct 循环）+ `plan-execute.ts`（Plan-Execute-Replan）+ `tool-execution.ts`（共享基础设施）。
> S2 Analytical 节点是 **父图**——把控制权委托给**子图**执行 ReAct / Plan-Execute。
>
> 配套阅读：[tools-execution-model.md](./tools-execution-model.md)（ReAct / Plan-Execute 执行算法）、
> [system-overview.md 第 3 节状态机](../architecture/system-overview.md#state-machine)（S2 Analytical 节点）、
> [agent-state-machine/L5-subgraphs.md](../architecture/agent-state-machine/L5-subgraphs.md)（分层视角）。

---

## 目录

1. [设计意图：为什么需要子图](#why)
2. [3 文件职责与边界](#layers)
3. [父图 ↔ 子图 通信协议](#protocol)
4. [子图复用与切换策略](#reuse)
5. [关键源文件](#files)
6. [已知限制](#limitations-inference)

---

## 设计意图 (why)

LangGraph StateGraph 是**单层**——节点之间通过 Annotation 通信。S2 Analytical 节点跑 LLM 循环时，**需要嵌套子图**才能表达"循环 + 工具调用 + 早停"。

**为什么不直接在父图里写循环？**
- 父图每个节点是"一次性"——不能循环
- 循环 + 早停 + 多工具调用需要**StateGraph 子图**
- 子图可以独立测试、复用、文档化

**子图 vs 父图**：

| 维度 | 父图 | 子图 |
|---|---|---|
| 节点数 | 5 + 4 条件边 | 3-5 |
| 触发时机 | 每次用户问题 | S2 Analytical 调用时 |
| 终止条件 | 路由到 formatter | finishReason 之一 |
| 共享 State | 全图状态 | 子图私有 state（封装在子图内） |

---

## Layers

```
subgraphs/
├── tool-execution.ts  (200 行)  ← 共享基础设施
│   ├─ compressToolResult
│   ├─ extractBlockIdsFromResult
│   ├─ compressMessagesForLLM
│   ├─ executeToolBatch
│   └─ executeSingleToolCall
│
├── react-loop.ts  (349 行)  ← ReAct 循环子图
│   ├─ ReactAnnotation
│   ├─ extractQueryKey (loop 检测)
│   ├─ StateGraph
│   └─ 4 nodes: assistant / tools / conclude / finalize
│
└── plan-execute.ts  (130 行)  ← Plan-Execute-Replan 子图
    ├─ runPlanExecute
    ├─ buildSynthesisPrompt
    └─ maxPlanRounds = 2
```

**依赖关系**（单向）：

```
react-loop.ts  →  tool-execution.ts
plan-execute.ts  →  tool-execution.ts
（两个子图互不依赖，独立可用）
```

### 职责分离原则

| 关注 | 负责方 |
|---|---|
| 工具**怎么执行** | `tool-execution.ts` |
| 工具**什么时候执行**（循环） | `react-loop.ts` 或 `plan-execute.ts` |
| 循环**何时结束** | 子图自己的 finishReason 判定 |
| 循环**结果如何回传父图** | 子图 export 的 `ReactLoopResult` |

---

## Protocol

### 父图视角

**位置**：`src/agent/graph/nodes/analytical.ts`

```typescript
import { reactLoop, runPlanExecute } from '../subgraphs';

const result = state.usePlanExecute
  ? await runPlanExecute(state.messages, reactLoopConfig, runnableConfig)
  : await reactLoop(state.messages, reactLoopConfig, runnableConfig);
```

**输入**：
- `state.messages` —— 父图累积的消息
- `reactLoopConfig` —— 共享配置（工具集 / maxIterations / abortSignal）

**输出**：
- `ReactLoopResult { content, toolResults, iterations, finishReason }`

### 子图视角

**`ReactAnnotation` 私有 State**：

```typescript
const ReactAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ ... default: () => [] }),
  iterationCount: Annotation<number>({ ... default: () => 0 }),
  toolCallCount: Annotation<number>({ ... default: () => 0 }),
  queriesAsked: Annotation<Record<string, string[]>>({ ... }),  // loop 检测
  toolResults: Annotation<ToolResultRecord[]>({ ... default: () => [] }),
  _maxIterations: Annotation<number>({ default: () => 8 }),
  _maxToolCalls: Annotation<number>({ default: () => 5 }),
});
```

**7 字段**——子图内部用，**不暴露给父图**。

**父图只看到 4 字段**：
- `content` —— 最终文本
- `toolResults` —— 工具结果数组（用于 verifyAndCleanContent）
- `iterations` —— 实际循环次数（用于 UI 进度）
- `finishReason` —— `'stop' | 'max_iterations' | 'max_tool_calls' | 'loop_detected'`

### 通信流

```
父图 (S2 Analytical)
  │
  ├─→ 子图 state 输入：messages + config
  │
  │  （子图内循环）
  │   ├─→ 调 LLM（绑定 tools）
  │   ├─→ 解析 tool_calls
  │   ├─→ 调工具（executeToolBatch / executeSingleToolCall）
  │   ├─→ 压缩消息（compressMessagesForLLM）
  │   └─→ 检测循环（queriesAsked）
  │
  └─→ 子图返回：ReactLoopResult
        └─→ 父图写回 state.analysisResult / state.toolResultsSnapshot
```

---

## Reuse

### 何时选 Plan-Execute vs ReAct？

**位置**：`analytical.ts` 中的 `state.usePlanExecute` 判断

**经验性启发式** [INFERENCE]：

```typescript
if (userQuery 需要"批量检索"——如"对比两本书")
  → runPlanExecute (一次列多个查询，并行)
else
  → reactLoop (按需逐步调)
```

**Plan-Execute 优势**：
- LLM 调用少（2-3 vs 4-6）
- 并行执行快（多工具一次调完）

**Plan-Execute 劣势**：
- 第一轮没看到工具结果 → 计划可能错
- 重新规划能力有限（最多 2 轮）

### 节点细节（React 子图 4 节点）

**位置**：`react-loop.ts:70+`（具体节点定义）

| 节点 | 职责 |
|---|---|
| `assistant` | 调 LLM，决定下一步 |
| `tools` | 解析 + 执行工具 + 压缩 |
| `conclude` | 强制收尾（`forcedConclusionContext`） |
| `finalize` | 写 toolResults + finishReason |

**路由**（4 条件边）：

```
assistant  ──(有 tool_calls)──→  tools  ──→  assistant (循环)
         ──(无 tool_calls)──→  conclude  ──→  finalize  ──→ END
         ──(max 触发)──────→  finalize
```

### Plan-Execute 节点细节（3 阶段）

**位置**：`plan-execute.ts:50+`

| 阶段 | 节点 | 职责 |
|---|---|---|
| Round 1 | `plan` | LLM 列计划 |
| Round 1 | `execute` | 并行执行所有工具 |
| Round 1 | `shouldReplan` | 条件边：是否需要 Round 2 |
| Round 2 | `replan` | 调 LLM 重规划（看到 Round 1 结果） |
| Round 2 | `execute` | 并行执行补充工具 |
| Final | `synthesize` | 综合所有结果输出 |

**默认 maxPlanRounds = 2**（`Math.max(1, Math.min(maxToolCalls, 2))`）。

---

## Files

| 文件 | 职责 |
|---|---|
| `src/agent/graph/subgraphs/tool-execution.ts` | 共享基础设施（200 行） |
| `src/agent/graph/subgraphs/react-loop.ts` | ReAct 循环子图（349 行） |
| `src/agent/graph/subgraphs/plan-execute.ts` | Plan-Execute-Replan 子图（130 行） |
| `src/agent/graph/nodes/analytical.ts` | 父图 S2 节点（委托给子图） |
| `tests/unit/agent/graph/react-loop.test.ts` | ReAct 子图单测 |
| `tests/unit/agent/graph/plan-execute.test.ts` | Plan-Execute 子图单测 |
| `tests/unit/agent/graph/tool-execution.test.ts` | 共享工具执行单测 |

---

## Limitations [INFERENCE]

### 通用

- **子图 State 不暴露给父图** —— `iterationCount` / `toolCallCount` 等**不写入父 state**（UI 看不到）
- **子图异常被父图吞** —— 父图用 `safeNode` 包装，**子图崩 = safeNode 兜底**——**真实错误被隐藏**
- **子图复用** `tool-execution.ts` 是好事，但**修改它会同时影响两个子图**——**回归风险**
- **不实现子图嵌套** —— Plan-Execute 内部**不能再嵌套** ReAct（不必要，但缺灵活性）
- **不实现子图动态切换** —— `usePlanExecute` 是布尔开关，**不能循环内换子图**

### react-loop

- **`maxIterations: 8` 硬编码默认值** —— IntentRouter 设置的值会覆盖，但**默认 8 偏多**
- **loop 检测只看"完全相同查询"** —— 改一字就过（"X" vs "X 的含义"）
- **queriesAsked 内存 Map** —— 重启 Obsidian 后清零，**不能跨重启检测**
- **finishReason 写死 4 种** —— 新增 "user_cancelled" 等需改多处
- **ReAct 节点 executeToolBatch 不并行** —— `Promise.all` 是并行，但**单批工具数受 LLM 决策限制**

### plan-execute

- **maxPlanRounds 上限 2** —— 复杂任务可能不够
- **Replan 看不到 Round 2 之后的历史** —— 实际 Round 2 是最后的
- **不区分"工具调用成功但结果空"** —— 空结果也消耗 1 轮
- **Plan 阶段调 LLM 1 次** —— 计划可能 LLM 1 次就锁死，没 fallback
- **不实现 Plan 复杂度评估** —— maxPlanRounds 是常量，**不根据计划复杂度自适应**

### tool-execution

- **压缩是无损可逆的截断** —— 只丢尾部，**不抽象总结**
- **block_id 提取用 regex** —— 不解析 Markdown AST
- **calibre-pb-* 排除是硬编码正则** —— 未来换导出工具可能需要更新
- **executeToolBatch 错误隔离** —— 单个工具抛错**不阻塞**其他工具（用户可能不知道部分失败）

### 父图集成

- **不实现子图 trace 关联** —— LangSmith trace 里子图 vs 父图**不自动嵌套**显示
- **不实现子图状态可视化** —— 调试时**看不到子图内部 state 演变**

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/agent/graph/subgraphs/*` 3 文件 679 行的架构视角文档。3 文件职责分层 + 父图/子图通信协议 + 复用切换策略 + 4 节点/3 阶段细节 + 27 条已知限制 |
