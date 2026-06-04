# 测试策略：Wiki 链接完整重构

> 制定日期：2026-06-04 | 状态：DRAFT | 制定者：test-engineer subagent
> 关联 Task List：`tasks/wiki-link-refactor-todo.md`（14 个任务，5 阶段）
> 关联实现：S4 formatter post-processing 链路（validateLinkPairs → verifyAndCleanContent → cleanOutput → validateWikiLinks → stripFabricatedLinks）

---

## 1. 任务定性

**垂直切片重构 + Bugfix 混合任务** ——

- **重构维度**：把 `validateAndCorrectLinks`（`link-validator.ts`，dead code 之前）替换为 `validateWikiLinks`（`wiki-link-hook.ts`），统一跨书守卫、流式截断、文件存在性校验三套逻辑到 S4 主链路。
- **Bugfix 维度**：修复 4 类 wiki 链接幻觉与解析错误（跨书误加前缀 / 流式末尾残片 / 幽灵 block_id / 变形 file_name 误删）。

**不是**新功能（无新外部 API），**不是**性能任务（核心目标是正确性），**不是**纯删除（5 个核心文件被改造 + 1 个文件被删除）。

## 2. 5 项前置假设

1. **S4 formatter 是唯一入口**：所有 wiki 链接幻觉问题都应能在 S4 post-processing 链路上被拦截。
2. **三个工具已就绪**：`validateLinkPairs`（T3.1）、`validateWikiLinks`（T1.1+T1.2）、`stripFabricatedLinks`（T1.4 修复版）三个纯函数/单参数函数可独立测。
3. **LangGraph state 是可构造的最小输入**：`CognitiveEngineState` 字段约 16 个，本次集成测试只构造 `formatterNode` 实际读取的 12 个字段（其他用 `as CognitiveEngineState` 强转）。
4. **LLM 可被 mock**：`ChatOpenAI.stream` 返回 `AsyncIterable<AIMessageChunk>`，可用 `vi.mock('@langchain/openai', ...)` 拦截。
5. **`app.vault.adapter` 是接口契约**：`exists` / `list` 是核心 API，已用 `tests/__mocks__/obsidian.ts` 路径解析。

## 3. 风险评估

| 维度 | 评估 |
|------|------|
| 业务影响 | **极高**（wiki 链接是 Agent 输出的核心 UI 元素，坏链 = 用户体验崩盘）|
| 修改范围 | **跨模块**（`agent/graph/nodes/formatter.ts` + `agent/utils/wiki-link-hook.ts` + `agent/utils/wiki-link-pair-validator.ts` + `views/sidebar/agent-chat-controller.ts` + 删除 `link-validator.ts`）|
| 依赖 | **混合**（mock：LLM stream + Obsidian app；真实：3 个工具纯函数）|
| 回归风险 | **高**（影响所有 Agent 输出，坏链会出现在每条消息里）|
| 残留风险 | **中**（`link-validator.ts` 已删，但 chat-controller.ts 仍可能有遗漏 import）|

## 4. 选用策略

- [x] **策略 A：新功能**（主）—— 4 层全覆盖，按垂直切片从工具到集成
- [x] **策略 B：Bugfix**（辅）—— 4 类 bug 全部有复现测试
- [x] **策略 C：重构**（辅）—— 删除 `link-validator.ts` 后的回归验证

不适用：D（不是性能任务，n+1 风险已由 T1.1 批量缓存消除）、E（不是新集成）。

## 5. 测试层级（5 阶段 × 4 层覆盖矩阵）

### 5.1 现有测试资产（重构前已固化 baseline）

| # | 路径 | 形式 | it() 数 | 覆盖阶段 |
|---|------|------|---------|----------|
| 1 | `tests/unit/agent/utils/link-validator.test.ts` | 单元 | 5 | T0.1 baseline |
| 2 | `tests/unit/agent/utils/wiki-link-hook.test.ts` | 单元 | 14 | T0.1 baseline + T1.1+T1.2 |
| 3 | `tests/unit/agent/graph/utils/self-verification.test.ts` | 单元 | 8 | T0.1 baseline |
| 4 | `tests/unit/agent/graph/nodes/formatter-wiki-link.test.ts` | 单元 | 17 | T0.2 + T1.3 + T1.4 + T3.2 链式 |

**小计**：44 个 it()，818 测试基线（2026-06-04 验证）。

### 5.2 新增测试资产

| # | 层级 | 路径 | 形式 | 职责 | it() |
|---|------|------|------|------|------|
| 5 | 单元 | `tests/unit/agent/graph/nodes/formatter-integration.test.ts` | vitest 集成 | S4 端到端：6 类场景 + 2 静态反例 | ~17 |
| 6 | 冒烟 | `scripts/smoke/checks/S-WL-INT.check.mjs` | evalObsidian | 运行时验证：插件加载后 `link-validator` 不在 import 树 | 1 |
| 7 | 轻量 E2E | `scripts/e2e-light/specs/wiki-link-pipeline.spec.mjs` | evalObsidian | 真实 Obsidian 跑 5 步：单书查询 → 链接合法 + 跨书模式 → 链接指向对应书 | 5 |
| 8 | 全量 E2E | `tests/e2e/specs/wiki-link-formatter.e2e.ts` | WebdriverIO | 多步 UI 交互：sidebar → 提问 → 验证 hover 链接可点击 | 1 |

**新增后总数**：单元 44 → 61 / 冒烟 core 10 → 11 / 轻量 17 → 18 / 全量 新增 1。

### 5.3 5 阶段 × 4 层覆盖矩阵

| 阶段 | 工具 | 单元 | 冒烟 | 轻量 E2E | 全量 E2E |
|------|------|------|------|----------|----------|
| **Phase 0**（基线） | link-validator / wiki-link-hook / self-verification | 3 文件 / 27 it | — | — | — |
| **Phase 1**（核心修复） | validateLinkPairs / validateWikiLinks / fixupWikiLinks / stripFabricatedLinks | 1 文件（追加 14 it）| — | — | — |
| **Phase 2**（接入 formatter） | formatter.ts 顺序串联 | formatter-integration.test.ts（17 it）| S-WL-INT（1 step） | wiki-link-pipeline.spec.mjs（5 step） | wiki-link-formatter.e2e.ts（1 spec）|
| **Phase 3**（流式截断） | validateLinkPairs 已在 Phase 1 | （Phase 2 已含）| — | （Phase 2 已含）| （Phase 2 已含）|
| **Phase 4**（删除 link-validator） | 静态反例（grep）| 集成测试 2 静态断言 | S-WL-INT 兜底 | — | — |
| **Phase 5**（端到端验证）| T5.2 用户手动 5 用例 | — | — | — | （用户已确认 stub）|

### 5.4 6 类风险点 + 应对测试

| 风险点 | 触发场景 | 应对测试 | 位置 |
|--------|---------|---------|------|
| **R1** 跨书误加书名前缀 | `crossBookMode=true` 时 `[[01-序\|序]]` 被改成 `[[西方史纲/01-序\|序]]` | D1/D5 | formatter-integration §D1.2 + D5 |
| **R2** 流式末尾残片 | LLM 流中断，输出 `[[book/01-序` 末尾 | D2 | formatter-integration §D2 |
| **R3** 幽灵 block_id | LLM 幻觉出 `[[a/01#^ghost\|序]]`，vault 实际不含 `ghost` | D3 | formatter-integration §D3.2 |
| **R4** 变形 file_name 误删 | LLM 输出 `[[a/99-不存在的章节\|不存在]]`，inputTexts 中无 | D4 | formatter-integration §D4 |
| **R5** LLM 拒答时残留空链接 | LLM 拒绝回答但留下 `[[空]]` | D6.1 | formatter-integration §D6.1 |
| **R6** `link-validator` 残留 import | 删除后 chat-controller.ts 仍 import 旧模块 | D7（静态反例）| formatter-integration §D7 |

## 6. 集成测试场景清单（D1-D7）

`tests/unit/agent/graph/nodes/formatter-integration.test.ts` 包含 7 个 describe block，共 ~17 个 it()。

### D1. 端到端 happy path（3 it）
- **D1.1** 单书：mock LLM 输出 `[[西方史纲/01-序|序]]`，mock app 让文件存在 → 输出包含原链接
- **D1.2** 跨书：crossBookMode=true，输出 `[[另一本书/02|二]]` → 不被加 `西方史纲/` 前缀
- **D1.3** 完整工具链路：toolResults 有 `^b1`，输出 `[[西方史纲/01#^b1|序]]` → block_id 校验通过

### D2. 端到端流式末尾截断（2 it）
- **D2.1** 模拟流中断：mock stream 仅 yield 半个 chunk `[[book/01-序` → `validateLinkPairs` 修复后下游不崩
- **D2.2** 混合：mock stream 末尾 `[[good|x]] [[broken` → 完整保留 + 残片剥成 `[broken`

### D3. formatter × wiki-link-hook 真实校验（3 it）
- **D3.1** 存在：mock `app.vault.adapter.exists` 返回 true → 链接保留
- **D3.2** 不存在：mock `exists` 返回 false + `list` 含相似文件 → 模糊匹配修复
- **D3.3** 跨书：crossBookMode=false，链接 bookName 与当前书不符 → wrong_book issue 触发

### D4. formatter × wiki-link-pair-validator（2 it）
- **D4.1** 正常配对：4 个完整 `[[x]]` → 0 修复
- **D4.2** 单边 `]]`：末尾多余 `]]` → 替换为 `]`

### D5. crossBookMode 集成（2 it）
- **D5.1** 跨书模式 + fixupWikiLinks：crossBookMode=true → fixup 不加前缀
- **D5.2** 跨书模式 + validateWikiLinks：crossBookMode=true → 无 wrong_book issue

### D6. 错误路径 + HITL（3 it）
- **D6.1** LLM 拒答（空响应）：mock stream yield 空 → formatterNode 不崩
- **D6.2** LLM 抛错：mock `model.stream` reject → 返回 fallback output
- **D6.3** HITL enableHumanReview + interrupt 路径：mock interrupt 触发 → state 不直接消费

### D7. 静态反例（2 it）
- **D7.1** `agent-chat-controller.ts` 不再 import `link-validator`（grep 反例）
- **D7.2** `src/` 内 `validateAndCorrectLinks` 引用数为 0（grep 反例）

## 7. 执行顺序

### Phase 0：基线核验（5 min）
- [ ] 跑 `npm run test:run`（基线 818 通过 + 92 skipped）
- [ ] 跑 `npm run build`（确认无编译错误）

### Phase 1：写集成测试（30 min）
- [ ] 新建 `tests/unit/agent/graph/nodes/formatter-integration.test.ts`
- [ ] mock 模式：`vi.mock('obsidian', ...)` + `vi.mock('@langchain/openai', ...)`
- [ ] 写完 7 个 describe × 17 it（按 §6 清单）
- [ ] 跑 `npm run test:run -- formatter-integration.test.ts`
- [ ] 全部通过（819 → 835）

### Phase 2：注册冒烟（5 min）
- [ ] 新建 `scripts/smoke/checks/S-WL-INT.check.mjs`
- [ ] 编辑 `scripts/smoke/smoke.mjs` core level
- [ ] 跑 `npm run smoke:core`（10 个 → 11 个全 pass）

### Phase 3：写轻量 E2E（20 min）
- [ ] 新建 `scripts/e2e-light/specs/wiki-link-pipeline.spec.mjs`
- [ ] 5 步：单书 happy / 跨书守卫 / 模糊匹配 / 流式截断 / 静态反例
- [ ] 跑 `npm run e2e-light`（17 → 18 specs 全 pass）

### Phase 4：写全量 E2E（可选，30 min）
- [ ] 新建 `tests/e2e/specs/wiki-link-formatter.e2e.ts`
- [ ] WDIO 跑 Obsidian 真实交互（sidebar 提问 → 验证 hover 链接）
- [ ] 跑 `npx wdio run tests/wdio.conf.ts --spec wiki-link-formatter.e2e.ts`

### Phase 5：效果评估（5 min）
- [ ] 跑 `npm run test:run` 确认无回归（818 + 17 = 835 全 pass）
- [ ] 跑 `npm run smoke:core` 确认 11 个不退化
- [ ] 跑 `npm run e2e-light` 确认 18 个全 pass
- [ ] 填 §10 评估表

## 8. 退出条件

- [ ] 单元：formatter-integration.test.ts 新增 ≥ 17 it 全 pass
- [ ] 单元：6 个子模块的 it 总数（formatter-wiki-link + wiki-link-hook + wiki-link-pair-validator + formatter-integration）覆盖 D1-D7 全部场景
- [ ] 冒烟：S-WL-INT 通过 + 其他 10 个不退化
- [ ] 轻量 E2E：wiki-link-pipeline 5 step 全 pass + 其他 17 个不退化
- [ ] 全量 E2E（可选）：wiki-link-formatter.e2e.ts 1 spec 通过
- [ ] 静态反例：`grep -r "validateAndCorrectLinks\|link-validator" src/` 返回 0 命中
- [ ] 假阳性 = 0（所有 mock 严格对齐实际行为）
- [ ] 已知限制：LLM 拒答场景的 E2E 不强制（mock 局限性）

## 9. 预估时间

| 阶段 | 时长 |
|------|------|
| Phase 0 基线 | ~5 min |
| Phase 1 集成测试 | ~30 min |
| Phase 2 冒烟 | ~5 min |
| Phase 3 轻量 E2E | ~20 min |
| Phase 4 全量 E2E（可选）| ~30 min |
| Phase 5 评估 | ~5 min |
| **总计（必做项）** | **~65 min** |
| **总计（含全量 E2E）** | **~95 min** |

## 10. 效果评估（4 问）

| 评估项 | 预期 | 不达标时调整 |
|--------|------|-------------|
| 目标达成 | 4 层全跑（除 Phase 4 可选），共 +20 测试资产 | 补缺失层 |
| 时间预算 | ≤ 95 min（含全量 E2E）| 跳过全量 E2E 走轻量 + 手动 |
| 假阳性率 | < 5%（17 it 中允许 1 个边缘 case 退化）| 收紧 mock 严格度 |
| 覆盖空白 | 6 类风险点全部有测试；3 个工具函数被集成测试串起来 | 加 spec 覆盖新风险 |

## 11. 关键技术决策

### 11.1 mock 模式选择

**`vi.mock('obsidian', ...)` 静态 mock** + **`vi.mock('@langchain/openai', ...)` 动态 factory**。

理由：
- 静态 mock 模块级生效，覆盖 `formatter.ts` 的 `import type { ChatOpenAI }` 与实际 `new ChatOpenAI(...)` 实例化
- factory 返回 mock class，含可配置的 `.stream()` 方法

### 11.2 状态构造策略

不直接 `mount` LangGraph state，构造最小 `CognitiveEngineState` 字段子集：

```ts
const state = {
  analysisResult: '...',
  pdfName: '西方史纲',
  crossBookMode: false,
  toolResultsSnapshot: [...],
  scopeNodeIds: [],
  mode: 'normal',
  depth: ReadingDepth.NORMAL,
  // 其他字段省略
} as unknown as CognitiveEngineState;
```

理由：`formatterNode` 只读 12 个字段，强转可避免类型噪声。

### 11.3 不测 `formatterNode` 完整运行

**不**在测试里实际执行 `await formatterNode(state, config)` —— 这需要 mock `streamToContent` 的完整链路。

**测** `cleanOutput` + `validateLinkPairs` + `validateWikiLinks` + `stripFabricatedLinks` 4 个独立函数的链式调用结果，断言「如果它们按预期顺序执行，输出会是什么」。

理由：简化 mock 复杂度，提高测试稳定性（参见 `formatter-wiki-link.test.ts` §D3.2 已有的链式风格）。

## 12. 关联物

- 策略元数据：`docs/test-strategies/wiki-link-refactor.md`（本文件）
- Task List：`tasks/wiki-link-refactor-todo.md`（14 个任务）
- 实现：S4 formatter post-processing 链路（`src/agent/graph/nodes/formatter.ts:381-489`）
- 三个核心工具：
  - `src/agent/utils/wiki-link-hook.ts`（validateWikiLinks）
  - `src/agent/utils/wiki-link-pair-validator.ts`（validateLinkPairs）
  - `src/agent/graph/nodes/formatter.ts`（fixupWikiLinks / fixupEmptyBlockIds / stripFabricatedLinks）
- 旧基线：`tests/unit/agent/utils/link-validator.test.ts`（5 it，2026-06-04 后已 dead）
- 现行基线（2026-06-04）：`npm run test:run` → 818 passed + 92 skipped
