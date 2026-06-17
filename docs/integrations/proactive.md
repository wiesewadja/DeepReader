# Proactive Engine 集成

> 用户阅读时**主动**触发苏格拉底引导——基于"高亮数 + 章节切换 + 冷却"三条件。
>
> 配套阅读：[system-overview.md 第 7 节 设计巧思](../architecture/system-overview.md#tricks)、[state-machine-flow.md](../architecture/state-machine-flow.md)、ADR-008（proactive 引擎设计）、[features/memory-observability.md](../features/memory-observability.md)。

---

## 目录

1. [设计意图：从"被动应答"到"主动引导"](#why-proactive)
2. [三种触发器](#triggers)
3. [冷却机制：避免打扰用户](#cooldown)
4. [状态机 + 持久化](#state)
5. [关键源文件](#files)

---

## 设计意图 (why-proactive)

DeepReader 的"理想阅读"是 Adler 式的**主动阅读**——读者与作者对话、提问、批注。但用户**不会主动问**——他们只会高亮、翻页、看目录。

**Proactive Engine 解决**：当用户**累积了足够多"思考痕迹"**时，主动发起一次"苏格拉底式提问"——让用户从"被动看"变成"被迫想"。

**例子**：
- 用户高亮第 3 章 5 处内容 + 切换到第 4 章 → 触发"你在第 3 章的 5 个高亮都跟 X 相关，要不要 AI 帮你对比它们？"
- 用户读完 3 个连续章节但**没有任何高亮** → 触发"这 3 章没高亮，是没意思还是太有意思了？"

---

## 三种触发器 (triggers)

**位置**：`src/agent/proactive/engine.ts`

### 触发器 1：Inspection 触发（章节级）

`shouldTriggerInspectional(state, settings)` —— 高亮数 ≥ 阈值（默认 5）触发。

```typescript
function shouldTriggerInspectional(state: ProactiveState, settings: Settings): boolean {
  return state.totalHighlightsInChapter >= (settings.proactiveHighlightThreshold ?? 5);
}
```

**目的**：用户在某章节投入足够多注意力 → 值得发起一次"深读检查"。

### 触发器 2：Chapter 切换触发（跨章节）

`shouldTriggerChapter(state, settings)` —— 用户切换章节 + 上一章节高亮数 ≥ 阈值 + 上次触发后 ≥ N 章未触发。

```typescript
function shouldTriggerChapter(state, settings) {
  return state.chaptersSinceLastTrigger >= (settings.proactiveChapterInterval ?? 3);
}
```

**目的**：用户"读完一章"是主动信号——间隔 N 章后值得做一次"跨章节总结"。

### 触发器 3：被动纠正（用户反馈）

`correctionDetected` 状态（见 `state.ts`）—— 用户在对话中反驳 AI → 触发重新分析。

**与状态机集成**：`S2-Pre 节点`读 `correctionDetected` → 强制走 S2 Analytical（不走早停）。

---

## 冷却机制 (cooldown)

**位置**：`engine.ts:isInCooldown()`

```typescript
private isInCooldown(): boolean {
  if (!this.lastGlobalTriggerAt) return false;
  const elapsed = Date.now() - this.lastGlobalTriggerAt;
  return elapsed < (this.settings.proactiveCooldownMinutes ?? 5) * 60 * 1000;
}
```

**默认 5 分钟**——保证两次引导之间**至少 5 分钟**。防止用户短时间连点导致"刷屏式提问"。

**设置项**（`settings.proactiveCooldownMinutes`）用户可调。

---

## 状态机 + 持久化 (state)

**位置**：`src/agent/proactive/state.ts`

### 状态字段

| 字段 | 含义 | 重置时机 |
|---|---|---|
| `bookId` | 当前书 ID | 切书时 |
| `totalHighlightsInChapter` | 当前章节高亮数 | 切章节时归零 |
| `chaptersSinceLastTrigger` | 上次触发后过了多少章 | 触发时归零 |
| `lastTriggerAt` | 上次触发时间戳 | 触发时更新 |
| `lastGuidanceId` | 上次引导消息 ID（用于去重） | 触发时更新 |

### 持久化路径

`saveProactiveState(app, state)` → `<vault>/.obsidian/plugins/deepreader/proactive/<bookId>.json`

**与索引数据分离**——避免污染 PageIndex 目录。

### 加载时机

`engine.ts:getState(bookId)` 懒加载——首次访问 bookId 时从磁盘读，后续缓存到内存 Map。

---

## 与状态机的接口

**位置**：`src/agent/graph/state-machine-flow.md`（已有部分）+ `src/agent/proactive/types.ts:ProactiveParams`

```typescript
interface ProactiveParams {
  bookId: string;
  triggerType: 'inspectional' | 'chapter' | 'correction';
  chapterId?: string;
  totalHighlights?: number;
}
```

**调用链**：
```
ProactiveEngine.onTrigger(params)
  └─→ AgentChatController.injectProactiveMessage(params)
        └─→ SidebarView 显示引导气泡
              └─→ 用户点击 → AgentChatController.chat(proactiveQuery)
                    └─→ runGraphEngine（state.proactiveTrigger = params）
                          └─→ 路由层 proactive 直接走 S1 Inspectional
```

---

## 关键源文件 (files)

| 文件 | 职责 |
|---|---|
| `src/agent/proactive/engine.ts` | 触发器主逻辑（三种 + 冷却） |
| `src/agent/proactive/state.ts` | ProactiveState 类型 + 持久化 |
| `src/agent/proactive/types.ts` | ProactiveParams / ProactiveState 类型 |
| `src/views/sidebar/agent-chat-controller.ts` | 接收 `onTrigger` 回调 → 注入引导消息 |
| `docs/decisions/ADR-008-proactive-engine-design.md` | 设计决策 |
| `tests/unit/agent/proactive/engine.test.ts` | 触发器单测 |
| `tests/unit/agent/proactive/state.test.ts` | 状态持久化单测 |

---

## 已知限制 [INFERENCE]

- **不区分书难度**——同一阈值对《哈利波特》和《存在与时间》都生效
- **不基于阅读时长**——只看高亮数，不看"读了多久"
- **冷却全局而非按书**——5 分钟冷却对**所有书**生效
- **不支持 A/B 测试**——阈值是硬编码常量，没 A/B 实验框架

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/agent/proactive/*` 3 文件 + ADR-008 的架构视角深度文档。3 触发器 + 冷却 + 状态机 + 7 个源文件索引 |
