# 早停决策黄金测试集

> 制定日期：2026-06-10 | 状态：**草案**（6 个 case，未跑过）
> 配套阅读：[early-stop-decision.md](../architecture/early-stop-decision.md)（6 个 bug 的故障地图）
> 用途：给后续接手者一份"理想行为"清单——**改源码前，先让这 6 个 case 都能跑通**。

---

## 0. 为什么需要这份黄金集

`S2-Pre` 早停决策有 6 个已知问题（详见配套文档）。**改源码修这 6 个问题前**，必须先有可重复断言的测试场景：

1. **修 Bug 1（wScore 含义）**：怎么算"修对了"？需要 case 验证"短查询 vs 长查询的早停概率差异不超 X%"
2. **修 Bug 2（betterQuestion 丢失）**：怎么算"修对了"？需要 case 验证"早停输出包含 `<refined_query>` 块"
3. **修 Bug 5（幽灵引用降级）**：怎么算"修对了"？需要 case 验证"幽灵引用超阈值时输出包含 `[⚠️ 来源核验]`"

**没有黄金集 = 修了不知道修没修对**——LLM 类 bug 最大的陷阱是"症状消失但语义漂移"。

---

## 1. 6 个黄金 Case 总览

| # | Case ID | 覆盖问题 | 输入 | 期望输出 |
|---|---------|---------|------|---------|
| 1 | `es-1-skip-stop-no-betterq` | Bug 2 | S1 给出 betterQuestion，但早停 prompt 包含原 query | prompt 必须包含 `<refined_query>` |
| 2 | `es-2-skip-stop-no-structure` | Bug 2 | S1 给出 structuralAnalysis，但早停 prompt 漏掉 | prompt 必须包含 `<book_structure>` |
| 3 | `es-3-wscore-two-hits` | Bug 4 | 预检索恰好 2 条命中（闸门 ≥ 2 通过） | wScore 归一化到实际权重，0.6 阈值含义稳定 |
| 4 | `es-4-rrf-current-vs-multi` | Bug 3 | 同节点被 5 个关键词命中 vs 当前章节被 1 关键词命中 | 当前章节排序应在前 |
| 5 | `es-5-ghost-warning-injection` | Bug 5 | 早停时 LLM 用了 3 个幽灵 block_id | 输出顶部有 `[⚠️ 来源核验]` 警告 |
| 6 | `es-6-substantive-calibration` | Bug 6 | block 长度 100 字 + 有 block_id | substantive score = 30 整（边界值） |

---

## 2. Case 详解

### Case 1: 早停 prompt 必含 `<refined_query>`

**覆盖问题**：Bug 2（CRITICAL）—— 早停路径完全丢失 S1 的 betterQuestion

**目的**：当 S1 推导的 `betterQuestion` 与用户 `userQuery` 不同时，早停 prompt 必须把两者都暴露给 LLM。

**Setup**：
- 索引：任意已索引的 PDF（5 章以上）
- S1 输出：`betterQuestion = "作者在第 3 章如何论证 X 的本质"`，`userQuery = "X 是什么"`
- S2-Pre 触发早停（`wScore >= 0.6`, `hits.length >= 2`, `substantive >= 30`）

**断言**（伪代码）：

```typescript
const result = runPreSearch({
  userQuery: 'X 是什么',
  stateBetterQuestion: '作者在第 3 章如何论证 X 的本质',
  stateStructuralAnalysis: '第 3 章讲 X 的本质',
  // ... 强制触发早停
});

const prompt = result.directPrompt;
assert(prompt.includes('<original_query>X 是什么</original_query>'));
assert(prompt.includes('<refined_query>作者在第 3 章如何论证 X 的本质</refined_query>'));
```

**回归保护**：未来重构 `buildEarlyStopPrompt` 时，重构后没保留 betterQuestion 注入会立即 fail。

---

### Case 2: 早停 prompt 必含 `<book_structure>`

**覆盖问题**：Bug 2（CRITICAL）—— 早停路径完全丢失 S1 的 structuralAnalysis

**目的**：S1 推导的章节结构分析必须传给 LLM，让 LLM 知道 chunk 所在章节的语义角色。

**Setup**：
- 索引：任意 PDF
- S1 输出：`structuralAnalysis = "第 3 章讲 X 的本质；第 7 章讲 X 的应用"`
- 早停触发

**断言**：

```typescript
const prompt = result.directPrompt;
assert(prompt.includes('<book_structure>'));
assert(prompt.includes('第 3 章讲 X 的本质'));
assert(prompt.includes('</book_structure>'));
```

**关键**：`structuralAnalysis` 与 `betterQuestion` 是独立信号——**修 Bug 2 时不能只修一个**。

---

### Case 3: wScore 归一化（恰好 2 条命中）

**覆盖问题**：Bug 4（HIGH）—— 闸门 `hits.length >= 2` 通过后，`hits[1]?.score ?? 0` 零填充把 2 条命中伪装成 3 条

**目的**：当预检索恰好 2 条命中时，wScore 必须按实际可用权重归一化，不应"用 0 分填第三个 slot"。

**Setup**：
- 模拟 2 条命中：`hits = [{ score: 0.9 }, { score: 0.5 }]`
- 闸门 `hits.length >= 2` 通过
- 期望（修复后）：`wScore = (0.9×0.6 + 0.5×0.3) / (0.6+0.3) = 0.7667`
- 不期望（修复前）：`wScore = 0.9×0.6 + 0.5×0.3 + 0×0.1 = 0.69`（看似 0.69，实际权重失真）

**断言**：

```typescript
const hits = [
  { nodeId: 'n1', score: 0.9, matched_blocks: [{ block_id: 'b1', content: '...' }] },
  { nodeId: 'n2', score: 0.5, matched_blocks: [{ block_id: 'b2', content: '...' }] },
];
const wScore = computeWScore(hits);
assert(Math.abs(wScore - 0.7667) < 0.01);
```

**纯函数测试**：把 wScore 计算逻辑抽成 `computeWScore(hits: Hit[]): number`，单测 6 个场景（0/1/2/3 条、相等分数、top-1 主导、top-2 主导）。

---

### Case 4: 当前章节必须排在 5 关键词命中之前

**覆盖问题**：Bug 3（HIGH）—— RRF 加性 bias 让 5 关键词命中 (> 0.5) 大于 1 关键词+当前章节 (+ 0.3)

**目的**：当前章节是"用户在读"的强信号，应该比"被多关键词命中"更优先。

**Setup**：
- `currentNodeId = 'n_current'`
- 节点 A：当前章节，被 1 个关键词命中 → 修复前 score = base + 0.1 + 0.2 = base + 0.3
- 节点 B：普通章节，被 5 个关键词命中 → 修复前 score = base + 0.5
- 修复前：B 排在 A 之前（违反直觉）
- 修复后：A 必须排在 B 之前（乘性权重下 currentNodeId 1.3 倍压过 hitCount 加分）

**断言**：

```typescript
const mergedMap = new Map();
mergedMap.set('n_current', { result: { nodeId: 'n_current', score: 0.9 }, hitCount: 1 });
mergedMap.set('n_other', { result: { nodeId: 'n_other', score: 0.9 }, hitCount: 5 });

const sorted = sortByRRF(mergedMap, currentNodeId);
assert(sorted[0].nodeId === 'n_current'); // 修复前 fail，修复后 pass
```

---

### Case 5: 幽灵引用超阈值时注入警告

**覆盖问题**：Bug 5（MEDIUM）—— 早停路径不传 `llmClient`，幽灵引用被静默降级为文件级链接，**用户/下游看不到降级**

**目的**：当 LLM 输出包含 ≥30% 幽灵 block_id 时，必须在输出顶部注入 `[⚠️ 来源核验]` 警告。

**Setup**：
- 预检索命中 block_id 集合：`['valid_b1', 'valid_b2']`
- LLM 早停输出：`"X 主张 A [[book/ch1#^valid_b1|来源]]，Y 主张 B [[book/ch1#^ghost1|x]]，Z 主张 C [[book/ch1#^ghost2|y]]"`
- 3/3 = 100% ghost，> 30% 阈值
- 早停路径调用 `verifyAndCleanContent(content, preSearchRecords)`（**不传 llmClient**）

**断言**：

```typescript
const result = await verifyAndCleanContent(content, preSearchRecords);
assert(result.llmCorrectionTriggered === false); // 早停路径不传
assert(result.content.includes('[⚠️ 来源核验]'));
assert(result.content.includes('3/3'));
assert(!result.content.includes('#^ghost1')); // ghost 降级为文件级
assert(result.content.includes('[[book/ch1|x]]')); // 降级形式
```

**降级路径对比**：
- **正常 S2/S3 路径**（传 llmClient）：LLM 修正 + 不注入警告
- **早停路径**（不传 llmClient）：降级 + 警告注入

---

### Case 6: 实质分数边界值校准

**覆盖问题**：Bug 6（MEDIUM）—— `SUBSTANTIVE_THRESHOLD = 30` 校准基准未知

**目的**：当 block 恰好 100 字 + 有 block_id 时，substantive score = 20 + 10 + 15 = 45（> 30 阈值），应该过闸门。

**Setup**：
- `block = { block_id: 'b1', content: '100 字的内容' }`（content.length === 100）
- 期望：`subScore = 20 (block_id) + min(100/10, 20) (长度) + 15 (>20字) = 20 + 10 + 15 = 45`
- 期望：≥ 30 阈值 → 过闸门

**断言**：

```typescript
const hit = { matched_blocks: [{ block_id: 'b1', content: 'A'.repeat(100) }] };
const score = computeSubstantiveScore([hit]);
assert(score === 45);
assert(score >= 30); // 过闸门
```

**边界值覆盖**：
- `content.length === 20`：刚好 15 分（无 block_id 加成）→ 30-20 = 10 差值
- `content.length === 100`：45 分 → 过 30 阈值
- `content.length === 200`：55 分（封顶）→ 接近 65 满分
- `content.length === 0`：0 + 0 + 0 = 0（无 block_id 加成）

---

## 3. 实施步骤（从黄金到可跑）

### 阶段 1: 单测（无需 LLM 真实调用）

**门槛**：本周内完成

```bash
# 单元测试位置（基于现有约定）
tests/unit/agent/graph/prompts/pre-search-prompt.test.ts  # Case 1, 2
tests/unit/agent/graph/pre-search-bug4-wscore.test.ts       # Case 3
tests/unit/agent/graph/pre-search-bug3-rrf.test.ts         # Case 4
tests/unit/agent/graph/utils/self-verification-bug5.test.ts # Case 5
tests/unit/agent/graph/pre-search-bug6-substantive.test.ts  # Case 6
```

**每个 case 至少 3 个断言**：
1. **正例**：期望行为发生
2. **边界值**：刚好触发 / 刚好不触发
3. **负例**：期望行为**不**发生（防止过度修复）

### 阶段 2: e2e 集成测试（需要 LLM）

**门槛**：Bug 1 / Bug 2 修复后

```javascript
// scripts/e2e-light/specs/early-stop.spec.mjs（新增）
export default {
  id: 'es-e2e-1-betterq-injection',
  name: '早停 prompt 包含 betterQuestion',
  feature: 'F-25',
  timeout: 60_000,
  async run({ evalObsidian, ... }) {
    // 1. 准备：注入 S1 输出（含 betterQuestion 但与 userQuery 不同）
    // 2. 触发：用户发送 question
    // 3. 抓取：LangSmith trace 中 S2-Pre 节点的 directPrompt
    // 4. 断言：directPrompt 包含 <refined_query>
  },
};
```

### 阶段 3: 黄金集黄金化（参数化）

**门槛**：6 个 case 都跑通后

把 6 个 case 抽成一个 `early-stop-golden` 配置，存为 YAML/JSON：

```yaml
cases:
  - id: es-1-skip-stop-no-betterq
    input: { userQuery: 'X 是什么', stateBetterQuestion: '作者在第 3 章如何论证 X 的本质' }
    assertions:
      - prompt_includes: '<refined_query>作者在第 3 章如何论证 X 的本质</refined_query>'
  - id: es-2-skip-stop-no-structure
    input: { userQuery: 'X 是什么', stateStructuralAnalysis: '第 3 章讲 X 的本质' }
    assertions:
      - prompt_includes: '<book_structure>第 3 章讲 X 的本质</book_structure>'
  # ... 共 6 个
```

存为 `tests/golden/early-stop.yaml`——后续任何 LLM 决策类 bug 修复都用相同模式。

---

## 4. 不做什么

> 防止范围蔓延。

- **不修任何源代码**——本文档是"行为约束"，不是"修复方案"
- **不绑定具体 LLM provider**——黄金集关注 prompt 结构和输出断言，与底层 LLM 无关
- **不做基准性能测试**——本黄金集是行为正确性，不含吞吐 / token 成本
- **不写 v1 历史兼容**——v1 没有这些功能（`betterQuestion` 早停根本没传），黄金集只校验 v2 行为

---

## 5. 已知限制

1. **Case 3 的 "0.7667" 是计算值不是 benchmark 值**——真实 0.6 阈值在不同 query 上的"应不应该触发"没有黄金答案，需要跑真实 query 收集数据
2. **Case 4 的 "当前章节最强" 是设计意图**——但如果用户的问题**确实**跟当前章节无关，这条反而是 bug。**需要 case 4 有一个对照 case**：当用户问题不相关时，当前章节加分不应该让搜索结果走偏
3. **Case 5 的 30% 阈值是经验值**——黄金集只校验"超过阈值必触发警告"，不校验"低于阈值不触发警告"——避免阈值是"魔法数字"的事实暴露

---

## 6. 与其他文档的关系

- [early-stop-decision.md](../architecture/early-stop-decision.md) —— 6 个 bug 的"故障地图"（设计层）
- [llm-bug-e2e-pattern.md](./llm-bug-e2e-pattern.md) —— LLM 类 bug 调查的通用 5 阶段流程
- [5-layer-defense-E2E.md](./5-layer-defense-E2E.md) —— L5 负向声明复核（旁支 1）的同类先例
- [reading-progress-anti-regression.md](./reading-progress-anti-regression.md) —— 单一回归点的同类先例

**本黄金集 = 故障地图 + 通用调查流程 + 单一回归先例** 的合并产物。

---

## 7. 状态追踪

| 日期 | 状态 | 备注 |
|---|---|---|
| 2026-06-10 | **草案** | 6 个 case 定义，未实施单测，未跑 e2e |
| TBD | 阶段 1 | 6 个单测文件落地，跑通 |
| TBD | 阶段 2 | 至少 1 个 e2e spec 跑通 |
| TBD | 阶段 3 | 黄金集参数化，可重复跑 |

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：6 个黄金 case 定义，每个覆盖 1 个早停 bug。3 阶段实施路径（单测 → e2e → 黄金化）。不修代码——只锁定"理想行为" |
