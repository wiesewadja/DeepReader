# 错误模型与降级链

> DeepReader LangGraph 状态机的"单节点崩溃 = 不影响主图" 兜底机制——
> `safeNode()` 包装 + `NodeError` 统一错误模型 + `fallbackAction` 三选一。
>
> 配套阅读：[系统鸟瞰.md 第 9 条设计巧思"5 层 fallback"](../architecture/系统鸟瞰.md#tricks)、
> [state-machine-flow.md](../architecture/state-machine-flow.md)、
> [早停决策原理与问题.md §5 风险章节](../architecture/早停决策原理与问题.md)。

---

## 目录

1. [Why: 为什么需要统一错误模型](#why)
2. [NodeError 统一结构](#nodeerror-structure)
3. [safeNode 包装：try-catch + 降级](#safenode)
4. [fallbackAction 三选一](#fallback-actions)
5. [用户提示：NODE_ERROR_HINTS](#user-hints)
6. [下游节点消费 nodeErrors](#downstream-consumption)
7. [已知限制](#limitations-inference)

---

## Why

LangGraph StateGraph 默认行为：**节点抛错 = 整个图崩溃**。对 DeepReader 这种长链路（5 节点 + 4 条件边 + 工具循环）来说：

- S1 Inspectional 失败（网络超时）→ 整图崩 → 用户看不到 S2 已经准备好的内容
- Visualizer 失败（Hermes 不可达）→ S2 分析作废 → 用户拿不到本来可用的回答
- ReAct 工具循环中某个工具失败 → 整轮崩

**设计目标**：
1. **单节点失败 ≠ 图崩溃**——其他节点继续跑
2. **失败要可见**——S4 formatter 知道前面哪个节点挂了
3. **用户要看懂**——友好提示而非"Internal error"
4. **降级可配置**——不同节点有不同降级策略

---

## NodeError Structure

**位置**：`src/agent/graph/state.ts:46-60`

```typescript
export interface NodeError {
  message: string;       // 错误原始信息（开发调试用）
  recoverable: boolean;  // 是否可恢复（formatter 不可恢复，其他可恢复）
  fallbackAction: 'global_search' | 'skip_to_formatter' | 'abort';
}
```

**3 字段含义**：

| 字段 | 作用 |
|---|---|
| `message` | 原始错误（用 `Error.message ?? String(err)` 取） |
| `recoverable` | `name === 'formatter'` 时为 false（formatter 是最后节点，没法降级） |
| `fallbackAction` | 三选一降级策略（见 § fallbackAction） |

---

## safeNode 包装

**位置**：`src/agent/graph/utils/safe-node.ts`（57 行）

```typescript
export function safeNode(
  name: string,
  fn: NodeFn,
  fallback?: (state, err) => Partial<CognitiveEngineState>,
): NodeFn {
  return async (state, config) => {
    try {
      return await fn(state, config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      const nodeError: NodeError = {
        message: msg,
        recoverable: name !== 'formatter',
        fallbackAction: FALLBACK_ACTIONS[name] ?? DEFAULT_FALLBACK_ACTION,
      };

      const base: Partial<CognitiveEngineState> = {
        nodeErrors: { [name]: nodeError },
      };

      if (fallback) {
        return { ...fallback(state, err), ...base };
      }
      return base;
    }
  };
}
```

**3 步**：
1. `try` 跑节点 fn
2. 失败时构造 `NodeError`
3. 写 `state.nodeErrors[name]`，**有自定义 fallback 就跑 fallback**

**关键设计**：
- **errors 不会"吃掉"原有 state**——只追加 `nodeErrors`，其他字段保留
- **fallback 是可选的**——节点自己写 fallback，safeNode 只是把错误暴露出来
- **错误键用节点名**——`nodeErrors.pre_search` 而不是 `nodeErrors[0]`，便于精确查询

---

## Fallback Actions

**位置**：`safe-node.ts:14-19`

```typescript
const FALLBACK_ACTIONS: Record<string, NodeError['fallbackAction']> = {
  inspectional: 'global_search',
  pre_search: 'global_search',
  formatter: 'abort',
};
const DEFAULT_FALLBACK_ACTION: NodeError['fallbackAction'] = 'skip_to_formatter';
```

### 3 种 fallbackAction

| Action | 含义 | 触发节点 |
|---|---|---|
| `global_search` | 用全书范围搜索代替精细检索 | `inspectional` / `pre_search` |
| `skip_to_formatter` | 跳过该节点，直接走 formatter 输出 | 默认（其他节点） |
| `abort` | 整图终止（formatter 失败没救） | `formatter` |

### 为什么 inspectional/pre_search 用 global_search？

**场景**：S1 加载 PageIndex 树失败（vault 损坏 / 文件被锁）→ scope 选不准 → S2 检索可能漏。

**降级**：跳过 scope 锁定，让 S2 用**全书范围**搜（`scopeNodeIds = []`）。

**代价**：检索精度下降（无 scope 过滤）但**不会卡死**。

### 为什么 formatter 失败是 abort？

**位置**：S4 formatter = 最后节点——它失败 = 整图"干完了没产物"。

**决策**：不强行跑 fallback（没有"再 formatter 一次" 的意义）——直接 abort 让用户看到错误。

---

## User Hints

**位置**：`state.ts:53-60`

```typescript
export const NODE_ERROR_HINTS: Record<string, string> = {
  inspectional: '⚠️ 结构分析暂时不可用，已使用全书范围搜索。',
  analytical:   '⚠️ 深度分析暂时不可用，已提供基础回答。',
  pre_search:  '⚠️ 预检索暂时不可用，已直接进行深度分析。',
  visualizer:  '⚠️ 图表生成遇到问题。',
  syntopical:  '⚠️ 主题阅读暂时不可用。',
};
```

**5 个节点 × 5 条友好提示**。

**注意**：`formatter` 没有 hint——formatter 失败不显示"友好提示"，直接 abort 让用户看到原始错误。

### 拼接

**位置**：`src/agent/graph/nodes/formatter.ts:230`

```typescript
function appendErrorHints(nodeErrors?: Record<string, NodeError | string>): string {
  if (!nodeErrors) return '';
  const hints: string[] = [];
  for (const [node, err] of Object.entries(nodeErrors)) {
    if (typeof err === 'string') continue;  // 旧格式兼容
    const hint = NODE_ERROR_HINTS[node];
    if (hint) hints.push(hint);
  }
  return hints.length > 0 ? `\n\n---\n\n${hints.join('\n\n')}\n` : '';
}
```

**使用**：

```typescript
// formatter 节点
const errorHints = appendErrorHints(state.nodeErrors);
const finalOutput = formattedOutput + errorHints;
```

用户看到：

```
（AI 回答内容）

---

⚠️ 结构分析暂时不可用，已使用全书范围搜索。

⚠️ 预检索暂时不可用，已直接进行深度分析。
```

---

## Downstream Consumption

**位置**：`formatter.ts:518-523` 伪代码

```typescript
// S4 Formatter 节点
const errorHints = appendErrorHints(state.nodeErrors);

// 把 hints 拼到答案末尾
const finalOutput = analysisResult + errorHints;
```

**其他节点**（如 S2 Analytical）不读 `nodeErrors`——**让分析逻辑保持纯净**，仅在最终输出暴露问题。

---

## 与早停决策的关系

**位置**：[早停决策原理与问题.md §3 关键设计](../architecture/早停决策原理与问题.md)

- 早停走 S4 formatter **不走 S2 Analytical**——如果 S2 已经写入 `nodeErrors`，早停路径也会通过 formatter 看到
- **L5 负向声明核验** 失败时 `routeAfterPreSearch` 强制 S2 重跑（不走早停）——独立机制，跟 `safeNode` 错误无关

---

## 关键源文件 (files)

| 文件 | 职责 |
|---|---|
| `src/agent/graph/state.ts` | `NodeError` 接口 + `NODE_ERROR_HINTS` 字典 |
| `src/agent/graph/utils/safe-node.ts` | `safeNode` 包装器（57 行） |
| `src/agent/graph/nodes/formatter.ts` | `appendErrorHints` 函数 + S4 节点消费 |
| `tests/unit/agent/graph/utils/safe-node.test.ts` | safeNode 单测（5 节点 × 3 fallback） |
| `tests/unit/agent/graph/formatter-error-hints.test.ts` | appendErrorHints 单测 |

---

## Limitations [INFERENCE]

### 通用

- **NODE_ERROR_HINTS 硬编码 5 节点** —— 新增节点必须**手动加 hint**，否则用户看不到友好提示
- **fallbackAction 字段存在但不消费** —— 字段写到 `NodeError` 但**没代码读它**（S4 只是拼 hints 不根据 fallbackAction 行为）
- **`nodeErrors` 累计** —— 节点重复失败时**覆盖**而不是**追加**（reducer last-value）
- **错误不分类** —— 401 / 网络超时 / 限流 全部 `message: 'xxx'`，用户看到 raw message
- **不区分 silent error vs user-facing error** —— 内部 warning（如缓存未命中）也走 `agentLog`，但**不会被错误模型捕获**（应该不会被误报）

### safeNode

- **fallback 不能跑第二次** —— 节点 fn 失败时跑 fallback，**fallback 自身抛错不会再次 safeNode 包裹**
- **fallback 抛错则图崩** —— 双重保护缺失
- **不区分同步 vs 异步错误** —— 处理方式一样，但 AbortError 等需要特定处理

### 提示

- **不区分可恢复 vs 不可恢复** —— `recoverable: false` 字段存在但 formatter 不读
- **用户视角看到的是"⚠️ XX 暂时不可用"** —— 但**实际"已用 fallback"** 的事实用户不知道（用户会以为"真的不行"）
- **不支持多语言** —— hints 写死中文，国际化用户看不懂

### 缺失

- **没有错误码体系** —— `IndexError` 在 PageIndex 有，在 Agent 错误模型里没有
- **不支持错误聚合** —— 多个错误同时出现时只是 hints 累加，没去重
- **不实现 error boundary** —— 类似 React ErrorBoundary 的"局部失败不污染兄弟" 模式只在 safeNode 节点级，**更细粒度（工具调用）**没有

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/agent/graph/state.ts:46-60` + `utils/safe-node.ts` 57 行 + `formatter.ts:230-243` 的架构视角文档。3 字段 NodeError + safeNode 包装 + 3 fallbackAction + 5 节点 hints + 12 条已知限制 |
