# 对话历史与状态机 Bug 修复报告

**日期**: 2026-04-24
**背景**: 审查多轮对话状态管理时发现的既有 bug。这些问题**不依赖任何新功能**，当前系统已存在并影响用户体验。Midwife 主动引导功能会放大这些问题的影响，但它们本身需要独立修复。

---

## Bug 1: LangGraph 状态不跨轮累积（thread ID 每次新建）

**文件**: `src/agent/index.ts:297`

```ts
const threadId = `thread-${Date.now()}`;
```

**问题**: 每次调用 `runGraphEngine` 都生成全新的 thread ID。`FileCheckpointer` 写入了完整的 checkpoint，但下次调用用不同的 thread ID，永远读不回来。LangGraph 的 `messages` 字段虽然有 `messagesStateReducer`（append 语义），但因为 thread 不复用，实际上每轮都从空状态开始。

**影响**: LangGraph 内建的状态管理（包括 `messages` 字段的多轮累积）是死代码。多轮对话的连续性完全靠 `config.configurable.chatHistory` 旁路传递。

**修复方向**:
- 方案 A：固定 thread ID（如 `thread-{bookId}`），让 LangGraph 状态真正跨轮累积
- 方案 B：确认当前 `chatHistory` 旁路方案已够用，移除 checkpointer 死代码避免混淆

**注意**: 如果选择方案 A，需要检查 `messagesStateReducer` 无限增长的问题，可能需要配合 window truncation。

---

## Bug 2: S0 Router 只看用户消息，不看 AI 回复

**文件**: `src/agent/graph/prompts/router-prompt.ts:43-51`

```ts
const recentUserQueries = chatHistory
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content);
```

**问题**: Router 从 chatHistory 中只提取 `role === 'user'` 的消息，完全过滤掉 AI 的回复。Router prompt 说"结合近期提问记录"，但 Router 实际上看不到 AI 说了什么。

**影响**:
- 用户的追问（如"说说看"、"展开讲讲"）会被当成独立问题处理，无法关联到 AI 之前的引导
- `standalone_query` 重写无法解析代词和引用（如"那个概念"、"刚才说的"）
- depth 分类可能错误（一个追问被误判为 depth=0 闲聊）
- 特别是在 AI 的 formatter prompt 已经被要求做"阅读引导"（规则 8），用户经常是对引导的响应，但 Router 完全不知道

**修复方向**: 让 Router 同时看到最近几轮的 AI 回复摘要（不需要全文，压缩版本即可）。至少需要知道 AI 最后一个问题的内容，才能理解用户是在回答问题还是发起新话题。

**具体建议**: 修改 `buildRouterUserMessage`，将历史格式从"纯用户问题列表"改为"对话轮次列表"，包含简化的 AI 回复：

```ts
// 期望格式：
// [第1轮] 用户: "这本书主要讲了什么" → AI: (检视阅读) 这本书讨论了...
// [第2轮] 用户: "我觉得作者说得有道理"
// 当前提问: "我觉得作者说得有道理"
```

这样 Router 就能看出第 2 轮是对第 1 轮 AI 回复的响应，而不是一个独立的新话题。

---

## Bug 3: S4 Formatter 历史被过度压缩

**文件**: `src/agent/graph/utils/history-summarizer.ts:36-52`

```ts
// assistant 内容截断到 100 字符
conclusion: truncate(assistantContent.replace(/\n/g, ' '), 100),
// user 话题截断到 50 字符
return truncate(cleanQuery, 50);
```

**问题**: 助手内容截断到 100 字符，用户话题截断到 50 字符。对于深度分析类多轮对话，这个压缩太激进了。

**影响**: Formatter 的 prompt 规则 5 说"简短承接历史语境，像在继续之前的对话"，但压缩后的摘要可能丢失关键上下文，导致 Formatter 无法准确延续之前的讨论。

**修复方向**:
- 将助手内容截断从 100 提升到 200-300 字符
- 将用户话题截断从 50 提升到 100 字符
- 或者改用 LLM 做智能摘要（但会增加延迟和 token 消耗，不建议作为首选）

---

## Bug 4: `buildFormatterSystemPrompt` 参数被静默丢弃

**文件**: `src/agent/graph/nodes/formatter.ts:115, 140` 调用处 vs `src/agent/graph/prompts/formatter-prompt.ts:50` 定义处

**调用**:
```ts
// formatter.ts:115
const casualPrompt = buildFormatterSystemPrompt(ctx?.memoryContext, ctx?.userProfileSummary, ctx?.userProfileSegments);
// formatter.ts:140
const systemPrompt = buildFormatterSystemPrompt(ctx?.memoryContext, ctx?.userProfileSummary, ctx?.userProfileSegments);
```

**定义**:
```ts
// formatter-prompt.ts:50
export function buildFormatterSystemPrompt(memoryContext?: string): string {
```

**问题**: 函数只接受 1 个参数，但调用处传了 3 个。`userProfileSummary` 和 `userProfileSegments` 被静默忽略。同时 `SharedContext` 类型上也没有这两个字段，所以它们永远是 `undefined`。

**影响**: 用户画像个性化功能（基于用户阅读习惯调整奚童的语气和引导方式）完全失效。

**修复方向**:
- 在 `SharedContext` 中增加 `userProfileSummary` 和 `userProfileSegments` 字段
- 修改 `buildFormatterSystemPrompt` 接受并使用这些参数
- 在 MemoryStore 或 Consolidator 中生成用户画像摘要

---

## 优先级建议

| 优先级 | Bug | 原因 |
|--------|-----|------|
| **P0** | Bug 2: Router 不看 AI 回复 | 多轮对话追问误判：用户对 AI 引导的响应被当成独立问题，depth 和 query 重写都出错 |
| **P1** | Bug 4: Formatter 参数丢弃 | 用户画像功能完全失效，奚童无法个性化回复 |
| **P2** | Bug 3: 历史压缩过度 | 深度多轮对话上下文丢失，Formatter 无法准确延续讨论 |
| **P2** | Bug 1: Thread ID 不复用 | 当前 chatHistory 旁路方案可用，但 checkpointer 是死代码 |

**建议修复顺序**: Bug 2 → Bug 4 → Bug 3 → Bug 1
