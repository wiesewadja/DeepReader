# Midwife 主动引导设计文档

**日期**: 2026-04-24
**状态**: 设计中

## 核心理念

DeepReader 的角色从"总结者 (Summarizer)"转型为"助产士 (Midwife)"——通过苏格拉底式的引导，强迫用户进行主动思考。AI 不直接给答案，而是提出好问题，让用户自己"生出"理解。

## 设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 架构方案 | 走完整 LangGraph 图 S0→S1→S4 | 复用 S1 结构分析 + S4 人格化，改动增量 |
| 触发点 | 首次打开 + 章节划线累积 + 划线累积 | 基于行为事件而非进度百分比 |
| 展示形式 | 侧边栏消息气泡 | 融入对话流，不打断阅读 |
| 阶段一引导 | 多步渐进 | 2-3 步渐进引导，每步等用户回应 |
| 节流 | 同一章节只触发一次 | 避免来回翻页重复触发 |

## 前置依赖

**Bug 2（Router 不看 AI 回复）必须先修**。否则用户对奚童主动提问的回答会被 Router 误判为独立问题，引导流程断裂。详见 `docs/plans/2026-04-24-conversation-history-bugs.md`。

## 主动干预场景

### 场景一：初遇——检视阅读引导

**触发条件**：首次打开一本书（无对话记录 或 阅读进度 < 10%）

**引导流程**（多步渐进）：

**第一步：结构概览**
- 奚童主动发消息，给出目录概览 + 一个结构性问题
- 示例："这本书分三部分，第一部分讲 X，第二部分讲 Y。你觉得作者把 X 放在第一部分是想先解决什么问题？"
- 技术路径：S0 Router 识别 `intervention` 意图 → S1 Inspectional 生成结构分析 → S4 以"提问模式"输出

**第二步：核心问题定位**
- 用户回应后，奚童追问核心问题
- 示例："你提到作者想解决 X，那你觉得 X 在你自己的经验里对应什么？"
- 技术路径：S0 Router 看到历史中 AI 的引导提问，正确识别为 depth=1 追问 → S1 → S4

**第三步：阅读判断**
- 用户回应后，奚童引导判断
- 示例："基于你现在对这本书结构的了解，你打算怎么读？是精读还是选读部分章节？"
- 完成后检视阅读阶段结束

**节流规则**：每本书只触发一次检视引导。如果用户已有对话记录，不重复触发。

### 场景二：深入——章节 + 划线追问

**触发条件 A**（优先）：用户在某个章节内划线 ≥ 2 条后离开该章节
**触发条件 B**（兜底）：用户在当前章节内划线 ≥ 3 条（不等到离开）

**A/B 关系**：条件 A 和条件 B 是"或"关系，先到先触发。一旦某个章节的 `triggered` 标记为 true，该章节所有后续条件全部失效，不会重复触发。

**引导内容**：基于划线内容生成苏格拉底式追问

- 示例（两条划线有关联时）："你划了 A 和 B 两处，它们其实是一个论证的两面。你觉得作者为什么要从这两个角度切入？"
- 示例（划线内容有张力时）："你划的这段和上一章的观点似乎有矛盾，你觉得是作者自相矛盾，还是论证在深化？"

**节流规则**：
- 同一章节只触发一次追问
- 全局冷却时间 5 分钟（两次主动提问之间至少间隔 5 分钟）

### 场景三：回溯——跨章节联想（后续迭代）

**触发条件**：用户读完多个章节后触发 S2 分析阅读

**引导内容**：对比不同章节的论证关系，引导用户发现矛盾或递进

**阶段**：后续迭代，当前不实现

## 风险与应对

### 阻塞依赖：Bug 2 修复

Bug 2 修复是硬性前提。但主动引导的第一步（系统主动发消息）本身不依赖 Bug 2——因为第一步没有"用户回复 AI 问题"的场景。Bug 2 只影响第二步和第三步（用户回复引导问题后 Router 需要理解上下文）。

**缓解策略**：实现分两期：
- **第一期**：只实现场景一的第一步（系统主动发一条检视引导消息）。不涉及用户回复的意图识别，不依赖 Bug 2。
- **第二期**：实现多步渐进 + 场景二。依赖 Bug 2 修复。

### 问题清单与决策

| # | 风险 | 决策 |
|---|------|------|
| 1 | Router intervention 意图复杂度 | **主动引导跳过 S0 Router**。通过 Graph edge 前置判断 `isProactive`，直接进入 S1。不碰 Router prompt |
| 2 | S4 提问模式边界模糊 | 独立 `proactive-formatter-prompt.ts`，不复用现有 formatter prompt |
| 3 | 触发竞态条件 | 防抖 + 队列：所有触发事件进入一个异步队列串行处理，同一时刻只有一个主动引导在生成 |
| 4 | 状态持久化 | 写入 `.pageindex/{bookId}/proactive-state.json`，与现有 `reading-progress.json` 同级。存储路径参考 `reading-progress.ts:103` |
| 5 | 节流豁免歧义 | "用户最近 2 分钟内主动提问"→ 该次提问不计入冷却计时起点（推迟冷却），而非立即重置冷却。避免"追着问"的感觉 |
| 6 | 主动引导消息的可区分性 | 在消息气泡上加一个小标签"阅读引导"，视觉上与普通 AI 回复区分。具体样式待定（第一期先用文本标签，后续迭代可改为图标） |
| 7 | 多语言/多模型 | 当前不做。插件 UI 和 prompt 全部中文，用户群体明确 |
| 8 | Edge routing 是否只走 S1→S4 | 主动引导**当前只走 S1→S4**（depth=1）。`proactiveTrigger` 为 `chapter`/`highlight` 时，即使划线涉及多章节，也不走 S3 主题阅读。理由：主动引导的核心是提问而非回答，S1 的结构分析已足够生成好问题。跨章节关联留给第二期 |

## 架构改动

### 1. 绕过 S0 Router — 修改 Graph 入口 edge

**文件**: `src/agent/graph/index.ts`（行 29）, `src/agent/graph/edges.ts`

当前 `index.ts:29` 使用无条件边 `addEdge(START, 'router')`。需要替换为条件边，根据 `isProactive` 决定是否跳过 Router。

**改动 1：`edges.ts` 新增 `routeFromStart` 函数**

```ts
// 在 edges.ts 中新增（不修改现有函数）
export function routeFromStart(state: CognitiveEngineState): string {
  if (state.isProactive) return 'inspectional';
  return 'router';
}
```

**改动 2：`index.ts` 替换 START edge**

```ts
// 原来（行 29）:
.addEdge(START, 'router')

// 改为:
.addConditionalEdges(START, routeFromStart, {
  router: 'router',
  inspectional: 'inspectional',
})
```

同时需要在 import 中添加 `routeFromStart`。

这样主动引导时 graph 的初始 state 设 `isProactive=true, depth=1`，直接跳过 Router 进入 S1。正常对话流程不受影响。

### 2. 独立的主动引导 Formatter Prompt

**新文件**: `src/agent/graph/prompts/proactive-formatter-prompt.ts`

不复用现有 `formatter-prompt.ts`，而是写一个专门用于"提问模式"的 prompt。核心指令：

```
<role>
你是奚童，用户的阅读伙伴。你现在不是在回答问题，而是在引导用户主动思考。
</role>

<rules>
1. 基于结构分析，提出一个具体的问题。不要给出答案或总结
2. 问题必须让用户思考才能回答，不能用"是/否"敷衍
3. 问题必须锚定在书的具体章节或概念上，不能泛泛而谈
4. 语气自然、温暖，像朋友在聊天中随口问了一句
5. 不超过 3 句话。简短有力
</rules>
```

### 3. Graph State — 扩展字段

**文件**: `src/agent/graph/state.ts`

增加：
- `isProactive: boolean` — 标记当前是主动引导（默认 false）
- `proactiveTrigger: 'inspectional' | 'highlight' | 'chapter'` — 触发源类型
- `highlightContext: string[]` — 划线内容（用于场景二的追问）

### 4. Graph Edge — routeAfterInspectional 增加 proactive 分支

**文件**: `src/agent/graph/edges.ts`

当前 `routeByDepth`（行 15-19）不变——S0 的跳过逻辑已在 `routeFromStart` 中处理。

`routeAfterInspectional`（行 28-39）增加前置判断：主动引导一律走 `'done'`（直接到 S4），不进 S2/S3：

```ts
export function routeAfterInspectional(state: CognitiveEngineState): string {
  // 主动引导：跳过 S2/S3，直接到 Formatter
  if (state.isProactive) {
    return 'done';
  }
  // 原有逻辑不变
  if (state.depth === 3) return 'syntopical';
  if (state.depth <= 1 && state.structuralAnalysis) return 'done';
  return 'continue';
}
```

注意：主动引导时 `depth` 必须初始化为 `1`，确保 S1 走 depth=1 的"宏观检视"分支。

### 5. 触发引擎 — ProactiveEngine（新类）

**新文件**: `src/agent/proactive/engine.ts`

独立类，不嵌入 `sidebar-view.ts`。职责：
- 接收事件通知（由 sidebar-view 和 main.ts 主动调用，非订阅模式）
- 判断触发条件
- 管理节流和冷却
- 持久化状态

**回调注册方式**：采用 push 模式（sidebar-view 主动调用），不采用订阅/观察者模式。原因：
- 事件源分散在 `sidebar-view.ts`（章节切换）和 `main.ts`（划线回调），统一订阅机制增加复杂度
- push 模式下 cleanup 由调用方控制，不需要 ProactiveEngine 管理生命周期

```ts
class ProactiveEngine {
  constructor(
    private app: App,
    private settings: DeepPDFSettings,
    private onTrigger: (params: ProactiveParams) => void
  ) {}

  // 由 sidebar-view.trackReadingProgress 调用
  onChapterEnter(bookId: string, chapterId: string): void;
  onChapterLeave(bookId: string, chapterId: string): void;

  // 由 main.ts 的 ReadingModeCallbacks.onSaveHighlight 调用
  onHighlight(bookId: string, chapterId: string, content: string): void;

  // 由 sidebar-view 打开新书时调用
  onBookOpen(bookId: string, hasHistory: boolean, progressPercent: number): void;

  // 用户主动发送消息时调用（用于冷却计时）
  onUserMessage(): void;

  // cleanup：卸载插件时调用
  destroy(): void;
}
```

**sidebar-view.ts 中的接入点**：

前置改动——sidebar-view 需要维护章节切换检测：

```ts
// 新增实例变量
private currentChapterId: string | null = null;
```

在 `trackReadingProgress()`（行 1107-1140）中：
```ts
// 在现有的 markChapterVisited 之前，检测章节变化
const prevChapterId = this.currentChapterId;
this.currentChapterId = nodeId;
if (prevChapterId && prevChapterId !== nodeId) {
  this.proactiveEngine?.onChapterLeave(bookId, prevChapterId);
}
this.proactiveEngine?.onChapterEnter(bookId, nodeId);
```

其他接入点：
- 书籍初始化时调用 `onBookOpen`
- `sendMessage()`（行 2101）中调用 `onUserMessage`

**main.ts 中的接入点**：
- `ReadingModeCallbacks.onSaveHighlight`（行 411）的回调签名是 `(text: string, color: HighlightColorId)`，不包含 `chapterId`。需要从当前活动文件的 frontmatter 中提取（复用 `sidebar-view.trackReadingProgress` 中的同类逻辑），或通过 `this.app.workspace.getActiveFile()` + frontmatter 解析获取 `node_id`。

**回调参数类型定义**：

```ts
interface ProactiveParams {
  trigger: 'inspectional' | 'highlight' | 'chapter';
  bookId: string;
  chapterId?: string;
  highlightContext?: string[];
}
```

**`hasHistory` 的获取方式**：
- 在 `sidebar-view` 中，`SessionStore.getSessionCount(bookId)` 或检查 `agentChatHistory` 长度是否 > 0（排除仅有的 system message）
- 作为 `onBookOpen` 的参数传入，ProactiveEngine 不需要直接访问 SessionStore

### 6. 状态持久化

**文件**: `.pageindex/{bookId}/proactive-state.json`

```json
{
  "schema": 1,
  "bookId": "...",
  "inspectionalDone": false,
  "inspectionalStep": 0,
  "chapterTriggers": {
    "chapter-1": { "highlightCount": 2, "triggered": true },
    "chapter-2": { "highlightCount": 0, "triggered": false }
  },
  "lastProactiveAt": "2026-04-24T10:30:00Z"
}
```

### 7. 用户控制

设置项中增加：
- `proactiveGuidanceEnabled: boolean`（默认 true）— 主动阅读引导开关
- `proactiveCooldownMinutes: number`（默认 5）— 全局冷却时间

## 数据流

### 场景一：检视阅读引导（第一期只做第一步）

```
用户首次打开新书
  → sidebar-view.ts 调用 proactiveEngine.onBookOpen(bookId, false, 0)
  → proactiveEngine 检测到无历史 + 进度 0%
  → 检查 inspectionalDone=false，决定触发
  → 调用 runGraphEngine，初始 state 设 isProactive=true, proactiveTrigger='inspectional'
  → Graph edge: isProactive → 跳过 S0，直接进 S1 Inspectional
  → S1 生成结构分析
  → S4 使用 proactive-formatter-prompt，输出一条引导问题
  → 问题作为 AI 消息气泡出现在侧边栏，带"阅读引导"小标签
  → proactiveEngine 持久化 inspectionalDone=true, inspectionalStep=1
```

### 场景二：划线追问

```
用户在某章划线第 2 条
  → proactiveEngine.onHighlight(bookId, chapterId, content)
  → highlightCount 达到阈值，但未到离开章节，暂不触发（等待条件 A 或 B）

用户翻到下一章
  → proactiveEngine.onChapterLeave(bookId, prevChapterId)
  → 检查 prevChapter 的 highlightCount >= 2 && !triggered
  → 检查全局冷却时间
  → 满足条件 → 触发主动引导
  → 调用 runGraphEngine，isProactive=true, proactiveTrigger='chapter', highlightContext=[...]
  → Graph: S1(结构 + 划线上下文) → S4(proactive-formatter-prompt)
  → 追问出现在侧边栏
```

### 用户回复引导问题后（第二期，依赖 Bug 2 修复）

```
用户回复"我觉得核心是..."
  → 正常 runGraphEngine 流程
  → S0 Router 看到历史中 AI 的引导问题（Bug 2 修复后）
  → Router 正确识别为 depth=1 追问
  → S1 → S4 正常模式输出
```

## 不做的事

- **沉默检测**：不监控用户空闲时间来触发提问
- **进度百分比驱动**：不根据阅读百分比判断阅读阶段
- **场景三（跨章节联想）**：后续迭代
- **苏格拉底模式（S2 阶段）**：后续迭代，当前只在 S1 检视阶段做主动引导
- **多语言适配**：当前只考虑中文 prompt 和中文 UI

## 实现分期

### 第一期（不依赖 Bug 2）

- ProactiveEngine 类 + 状态持久化
- Graph edge: isProactive 跳过 S0
- proactive-formatter-prompt.ts
- 场景一第一步：首次打开新书，发一条检视引导消息
- 场景二：划线累积后章节追问
- 设置项：开关 + 冷却时间

### 第二期（依赖 Bug 2 修复）

- 场景一多步渐进：第二、三步
- 用户回复引导问题后的意图识别
- "阅读引导"小标签的视觉区分

### 后续迭代

- 场景三：跨章节联想
- 苏格拉底模式（S2 阶段）
