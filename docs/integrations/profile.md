# User Profile 集成

> 增量构建用户画像——多轮对话 + 长期阅读积累，作为 Agent 上下文的"个性化层"。
>
> 配套阅读：[system-overview.md 第 7 节 设计巧思](../architecture/system-overview.md#tricks)（"记忆双层" 部分）、ADR-007（记忆与会话架构）、[features/memory-observability.md](../features/memory-observability.md)。

---

## 目录

1. [设计意图：让 Agent "认识" 用户](#why-profile)
2. [三层 Profile 数据模型](#profile)
3. [增量构建流程](#build-flow)
4. [轮次累加 + 摘要压缩](#accumulate)
5. [嵌入与 Agent 注入](#agent)
6. [关键源文件](#files)

---

## 设计意图 (why-profile)

DeepReader 的 Agent 默认只看到**当前问题**——"用户问 X" → "检索 → 答 X"。

但用户**有偏好**：
- 偏好简洁回答（5 句话以内） vs 偏好长篇分析（3 段）
- 偏好术语（不解释） vs 偏好白话（解释术语）
- 关注"作者意图" vs 关注"实际应用"

**Profile 把这些"隐式偏好"显式化**——每次回答前注入到 prompt，**让 LLM 调整风格**。

**典型场景**：
- 用户连续 3 次"少废话" → Profile 记"偏好简洁" → 第 4 次回答自动缩短
## 嵌入与 Agent 注入

---

## 三层 Profile 数据模型

**位置**：`src/services/profile-builder.ts` + `src/services/profile-facts.ts`

### Layer 1: Fact（原子事实）

```typescript
interface ProfileFact {
  id: string;          // uuid
  category: 'preference' | 'expertise' | 'reading_pattern' | 'context';
  key: string;         // e.g. "answer_length", "expertise_level"
  value: string;       // e.g. "concise", "intermediate"
  confidence: number;  // 0-1
  evidence: string[];  // 触发该 fact 的对话轮次 ID
  createdAt: number;
  updatedAt: number;
}
```

**类型枚举**：
- `preference` —— 回答风格 / 长度 / 术语偏好
- `expertise` —— 领域熟悉度（beginner / intermediate / expert）
- `reading_pattern` —— 阅读速度 / 高亮频率 / 章节切换间隔
- `context` —— 用户职业 / 角色 / 关注点

### Layer 2: Summary（每章/每书）

每次 Agent 会话结束时（不是每轮），对**当前 chapter** 的所有 facts 聚合 → 生成一段 prose summary。

```typescript
interface ChapterSummary {
  bookId: string;
  chapterId: string;
  prose: string;            // 200-500 字 prose
  factCount: number;
  generatedAt: number;
  sourceConversationIds: string[];
}
```

**位置**：`src/services/profile-builder.ts:generateChapterSummary()`

### Layer 3: Global Profile（跨书）

所有 chapter summaries 嵌入向量存储在**profile 库**，按需检索**最相关**的 N 条注入 prompt。

```typescript
interface GlobalProfile {
  userId: string;
  chapterSummaries: ChapterSummary[];
  recentFacts: ProfileFact[];  // 最近 50 条原始 facts
  generatedAt: number;
}
```

---

## 增量构建流程 (build-flow)

**位置**：`src/services/profile-builder.ts`

```
每轮对话结束
  └─→ extractFactsFromConversation(turn)
        │  LLM 提取 0-3 条新 fact
        │  与已有 facts 去重
        │  计算 confidence（多次出现 → 高）
        └─→ 写 facts.json (append-only JSONL)

每章结束 (chapter 切换)
  └─→ generateChapterSummary(chapterFacts)
        │  LLM 聚合 prose
        └─→ 写 chapter-summaries.json

每 N 天 (settings.profileEmbedInterval)
  └─→ embedChapterSummaries()
        └─→ 嵌入向量存 vectors.jsonl
```

**关键设计**：

- **每轮 LLM 提取** —— 但有**频率限制**（最多 1 条新 fact / 5 轮）—— 避免"刷 LLM"
- **append-only** —— 旧 facts 不删，confidence 自然上升
- **不存储原文对话** —— 只存提炼后的事实（**隐私** + **存储小**）

---

## 轮次累加 + 摘要压缩 (accumulate)

**位置**：`profile-builder.ts:accumulateFacts()`

```typescript
async function accumulateFacts(newFacts: ProfileFact[]): Promise<ProfileFact[]> {
  const existing = await loadAllFacts();
  const merged = new Map<string, ProfileFact>();

  // 同 key 的 fact：confidence 累加，evidence 累加
  for (const f of [...existing, ...newFacts]) {
    const prev = merged.get(f.key);
    if (prev) {
      merged.set(f.key, {
        ...f,
        confidence: Math.min(1, prev.confidence + f.confidence * 0.5),
        evidence: [...new Set([...prev.evidence, ...f.evidence])],
        updatedAt: Date.now(),
      });
    } else {
      merged.set(f.key, f);
    }
  }

  return Array.from(merged.values());
}
```

**算法**：
- 同 key 多次出现 → confidence 累加（0.5 衰减因子）
- evidence 去重累加（保留所有触发来源）
- 上限 confidence = 1.0（**避免高到无意义**）

---

## 嵌入与 Agent 注入

**位置**：`src/services/profile-builder.ts:embedChapterSummaries()`

### 嵌入

`chapter-summaries.json` 写入后**异步**嵌入到 `vectors.jsonl`——每条 summary 是 L2 块。

**去重**：嵌入时检查**余弦相似度** ≥ 0.95 → 跳过（避免重复摘要浪费 token）。

### 注入

**位置**：`src/agent/index.ts:buildSharedContext()`

```typescript
const topK = 3;
const relevantSummaries = await cosineSearch(embedding, profileVectors, topK);
// 注入到 system prompt
const userProfileSummary = formatSummariesForPrompt(relevantSummaries);
```

**top-3 注入**——只把"最相关"的 3 条用户摘要塞进 system prompt，**不超长**。

---

## 关键源文件 (files)

| 文件 | 职责 |
|---|---|
| `src/services/profile-builder.ts` | Profile 主体（fact 提取 / 累加 / 摘要） |
| `src/services/profile-facts.ts` | Fact 数据结构 + 持久化 |
| `src/agent/index.ts` | `buildSharedContext` 注入 top-K summary |
| `src/config/presets.ts` | profile 角色模型配置（默认 LLM） |
| `tests/unit/services/profile-builder-embedding.e2e.test.ts` | 嵌入 + 检索 e2e 单测 |
| `tests/unit/services/profile-facts.test.ts` | Fact 累加算法单测 |

---

## 已知限制 [INFERENCE]

- **不跨用户** —— Profile 与 vault 绑定，**换 vault 等于丢 Profile**
- **不支持手动编辑** —— 用户不能直接改 Profile（只能通过对话间接影响）
- **不存储反向关联** —— Profile fact 没有"来自哪本书" 的元数据
- **嵌入与索引共享向量空间** —— `vectors.jsonl` 是 PageIndex 与 Profile 共用，可能互相干扰
- **不实现 forget 机制** —— 用户不能"删除某条 profile fact"

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/services/profile-builder.ts` 836 行的架构视角文档。3 层数据模型 + 增量构建 + 轮次累加 + 嵌入注入。已知限制 5 条 |
