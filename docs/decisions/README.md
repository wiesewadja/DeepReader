# 架构决策记录（ADR）

> 记录项目中的关键架构决策。读 ADR 是理解「为什么这么设计」的最快方式。
>
> 命名格式：`ADR-NNN-{kebab-case-slug}.md`
> 状态流转：`PROPOSED` → `ACCEPTED` → `SUPERSEDED` / `DEPRECATED`

---

## 索引

| 编号 | 主题 | 状态 | 日期 |
|------|------|------|------|
| [ADR-001](./ADR-001-four-layer-reading.md) | 四层阅读法作为 Agent 认知架构 | Accepted | 2026-03 |
| [ADR-002](./ADR-002-local-first-no-backend.md) | 本地优先，纯前端，无后端 | Accepted | 2026-03 |
| [ADR-003](./ADR-003-langgraph-state-machine.md) | LangGraph 状态机作为 Agent 框架 | Accepted | 2026-03 |
| [ADR-004](./ADR-004-hybrid-search-bm25-vector.md) | BM25 + 向量混合搜索 | Accepted | 2026-03 |
| [ADR-005](./ADR-005-data-files-use-fs-not-vault-api.md) | 数据文件用 fs 直接读写而非 Vault API | Accepted | 2026-04 |
| [ADR-006](./ADR-006-dual-model-routing.md) | 双模型分层架构（main + fast） | Accepted | 2026-04 |
| [ADR-007](./ADR-007-memory-and-session-architecture.md) | MEMORY.md + JSONL 长期记忆与会话架构 | Accepted | 2026-03（5 月完善） |
| [ADR-008](./ADR-008-proactive-engine-design.md) | 主动引擎（Proactive Engine）设计 | Accepted | 2026-05 |
| [ADR-009](./ADR-009-s2-multi-layer-early-stop.md) | S2 多层早停机制设计 | Accepted | 2026-05（6 月归档） |

---

## 按主题分类

### Agent 认知层
- [ADR-001](./ADR-001-four-layer-reading.md) — 四层阅读法（S0/S1/S2/S4）
- [ADR-003](./ADR-003-langgraph-state-machine.md) — LangGraph 状态机
- [ADR-006](./ADR-006-dual-model-routing.md) — 双模型分层（main/fast）

### 数据与存储
- [ADR-002](./ADR-002-local-first-no-backend.md) — 本地优先
- [ADR-005](./ADR-005-data-files-use-fs-not-vault-api.md) — fs vs Vault API
- [ADR-007](./ADR-007-memory-and-session-architecture.md) — MEMORY.md + JSONL Sessions

### 搜索
- [ADR-004](./ADR-004-hybrid-search-bm25-vector.md) — BM25 + 向量混合

### 交互模式
- [ADR-008](./ADR-008-proactive-engine-design.md) — 主动引擎

### 成本与质量控制
- [ADR-009](./ADR-009-s2-multi-layer-early-stop.md) — S2 多层早停

---

## 模板

新 ADR 使用如下模板：

```markdown
# ADR-NNN: {决策标题}

## 状态
Accepted | Superseded by ADR-XXX | Deprecated

## 日期
YYYY-MM

## 背景
为什么需要这个决策？要解决什么问题？

## 决策
我们做了什么选择？核心要点 + 关键实现位置。

## 替代方案
### 方案 A
- 优点
- 缺点
- 放弃原因

### 方案 B
- 优点
- 缺点
- 放弃原因

## 后果
**收益：** ...
**风险与缓解：** ...
**架构约束：** ...（后续必须遵守的边界）
```

---

## 维护规则

- **不要删除旧 ADR**：它们记录了历史决策的上下文
- **决策变更时**：写新 ADR 并 `SUPERSEDED by ADR-XXX` 旧 ADR
- **每个 ADR 必须包含**：背景、决策、至少 2 个替代方案、后果
- **ADR 标题中英文对照**：用一句话讲清楚核心决策
