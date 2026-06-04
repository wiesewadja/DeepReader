# ADR-008: 主动引擎（Proactive Engine）设计

## 状态
Accepted

## 日期
2026-05（Proactive Engine 首版）

## 背景

传统 AI 阅读助手是「被动响应」：用户问，Agent 答。但深度阅读需要**主动引导**：
- 用户首次打开一本书，可能不知道从哪开始
- 用户读完一章，可能不知道自己理解得对不对
- 用户连续画了 3 个高亮，可能暗示他对某个概念有困惑

如果让 Agent 等到用户主动提问，**关键教学时机已被错过**。但如果 Agent 频繁打断，**又会干扰阅读节奏**。

## 决策

引入 **Proactive Engine**（主动引擎）：基于「章节事件」+「冷却时间」+「触发条件」，在合适的时机自动发起引导式对话。

### 三类触发器

| Trigger | 触发时机 | 触发条件 | 引导方向 |
|---------|----------|----------|----------|
| `inspectional` | 用户首次打开一本书 | 无历史 + 阅读进度 < 30% | 全书结构概览（depth=1 检视阅读） |
| `highlight` | 用户在章节内画 3+ 个高亮 | `highlightCount >= 3` 且未触发过 | 苏格拉底式提问：你的高亮是否构成主线？ |
| `chapter` | 用户离开章节 | 同章节高亮 ≥ 3 + 未触发 | 章节回顾：你学到了什么？还困惑什么？ |

### 关键设计

**1. 事件驱动，非轮询**
```typescript
ProactiveEngine.onBookOpen(bookId, hasHistory, progressPercent)
ProactiveEngine.onHighlight(bookId, chapterId, content)
ProactiveEngine.onChapterLeave(bookId, chapterId)
```
阅读视图在特定生命周期点调用，引擎立即判断是否触发。

**2. 状态持久化到 `ProactiveState`**
- 存储位置：`Vault/.obsidian/plugins/deepreader/proactive/{bookId}.json`
- 状态字段：`guidanceInitiated` / `chapterTriggers[chapterId]` / `lastProactiveAt`
- 重启后状态恢复（避免重复触发）

**3. 全局冷却时间**
- 配置：`proactiveCooldownMinutes`（默认 5 分钟）
- 防止短时间内多次触发（用户体验灾难）
- 检查点：`lastGlobalTriggerAt` 内存字段

**4. 串行处理锁**
- `processing` 标志位防止重入
- 配合 `onTrigger` 回调暴露给上游

**5. 苏格拉底模式**
- 一旦初始引导触发（`guidanceInitiated = true`），后续由对话历史驱动
- 阅读进度 + 历史摘要决定是否需要再次主动介入

### 配置与开关

`DeepPDFSettings.proactiveGuidanceEnabled`（默认 true）
- 用户可全局关闭（不喜欢被主动打扰的用户）
- 关闭时所有 `onXxx` 事件直接 return

## 替代方案

### 始终被动（不主动引导）
- 优点：实现简单，不打扰用户
- 缺点：用户不知道从哪开始，深度阅读率低
- 放弃原因：产品定位是「深度阅读助理」，必须主动引导

### 定时轮询（每 30 分钟问一次「在想什么」）
- 优点：实现简单，状态无关
- 缺点：与阅读节奏脱节，可能在用户专注时打断
- 放弃原因：触发时机应由「阅读状态变化」驱动，不是「时间」

### 多 Agent 协作（专门的引导 Agent 监听阅读状态）
- 优点：职责清晰，可独立测试
- 缺点：增加架构复杂度，需要跨 Agent 通信
- 放弃原因：单一 ProactiveEngine 足够处理，引入新 Agent 是过度设计

### 基于 LLM 实时判断「该不该主动介入」
- 优点：智能化、个性化
- 缺点：每次事件都调 LLM，延迟 + 成本
- 放弃原因：触发条件本身可硬编码（高亮数、章节离开、首次打开），无需 LLM 介入

## 后果

**收益：**
- 用户首次打开书不再迷茫，Agent 主动给出结构导览
- 高亮累积触发「知识反刍」，强化理解
- 冷却时间避免「骚扰式」打断
- 状态持久化保证重启不重复触发

**风险与缓解：**
- **误触打扰** → 冷却时间 + 用户可全局关闭 + 状态去重
- **状态膨胀** → `chapterTriggers` 按章节清理，state 文件较小（KB 级）
- **并发竞态** → `processing` 标志位 + `acquireLock` 模式
- **章节事件丢失** → 阅读视图必须在 `onChapterLeave` / `onBookOpen` 处显式调用（依赖契约）

**架构约束：**
- Proactive Engine **不直接调 LLM**。它只决定「该不该触发」和「触发什么参数」
- 触发后通过 `onTrigger(params)` 回调把控制权交回上游（通常是 `runGraphEngine`）
- Proactive 触发的对话**复用同一 LangGraph 引擎**（`mode: 'proactive'`，depth 默认 1）
- 不要在 Proactive 引擎内做对话渲染或 UI 更新
