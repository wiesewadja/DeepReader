# 实现方案：formatter block prompt 注入（Epic #9）

> 规格书：`docs/specs/formatter-block-inject.md`。本文是任务拆解，配合 `deepreader-implement` 逐任务执行。

## 概览

把检索命中的 block 原文喂进 formatter prompt，让 LLM 原生就地引用 `[[书/文件#^blockId|别名]]`。normal 路径是核心闭环（数据→接入→激活三步），辅以 injector 降级（Step2 条件跳过）与早停格式对齐。

## 架构决策

1. **按 snapshot 记录聚合，非按 blockId 平铺**：一条 `toolResultsSnapshot` 记录 = 一段原文（含多 blockId），按记录聚合让原文只喂一次，省 60%+ token（见 spec 第 7.1）。
2. **固定上限而非动态预算**：`maxBlocks=5`、`maxCharsPerBlock=400`（≈520 token）。基线 normal S4 prompt 实测 4489，加 ~2000 远低于 context 窗口。动态按剩余预算分配 `maxBlocks` 列为未来优化（需估 token，成本高）。
3. **Rule5 改写与喂数据必须同切片**：光喂数据不改 Rule5（仍禁止创造）无效；光改 Rule5 不喂数据（LLM 无从引用）也无效。两者共成 normal 闭环，但按依赖拆成"接入"和"激活"两步，各带单测。
4. **injector Step2 不删，加条件**：检测 LLM 已为某 `realFile` 生成 `#^block` 时跳过该文件的内嵌；LLM 漏引时仍兜底。安全网最强。
5. **早停先对齐格式 + 实测，不盲改 prompt**：`preSearchPrompt` 已齐全却 0 链接，根因（遵循度 vs 格式）未定；本次只对齐 `blockLines` 格式，改后 langsmith 实测决定是否强化 prompt。

## 任务列表

### 阶段 1：normal 路径核心闭环

#### 任务 1：`extractRetrievedBlocks` 纯函数 + 单测（S）

**描述：** 新增工具函数，从 `toolResultsSnapshot` 按记录聚合提取 `{fileName, blockIds, excerpt}[]`，受 `maxBlocks`/`maxCharsPerBlock` 限制，跨记录去重同 blockId。

**验收条件：**
- [ ] 输入 snapshot + nodeFileMap + pdfName，返回按记录聚合的 blocks（每条记录一份 excerpt + 其全部 blockId）
- [ ] `args.node_id` 缺失 / `nodeFileMap` 无映射 / `extractedBlockIds` 空 / `result` 空 → 该记录跳过
- [ ] `maxCharsPerBlock`（默认 400）截断 excerpt
- [ ] `maxBlocks`（默认 5）限制入池记录数
- [ ] 跨记录相同 blockId 去重

**验证方法：**
- [ ] `npx vitest run tests/unit/agent/prompts/formatter-helpers.test.ts`（新增）通过
- [ ] `npm run build` 通过

**依赖：** 无（地基）

**涉及文件：**
- `src/agent/prompts/utils/formatter-helpers.ts`（新增 `extractRetrievedBlocks` + 导出）
- `tests/unit/agent/prompts/formatter-helpers.test.ts`（新建）

**预估范围：** S

---

#### 任务 2：`buildFormatterUserMessage` 注入 blocks + 清理 duplicate + formatter.ts 传参（S）

**描述：** `buildFormatterUserMessage` 增参 `retrievedBlocks`，注入 `<retrieved_blocks>` 段（多 blockId 共一段原文格式）；`formatter.ts` normal 分支调 `extractRetrievedBlocks` 并传参；顺手清理 :119-123 multiBook/单书 dead duplicate。

**验收条件：**
- [ ] `buildFormatterUserMessage` 接收 `retrievedBlocks?: {fileName, blockIds, excerpt}[]`
- [ ] 有 blocks 时 prompt 含 `<retrieved_blocks>` 段，格式 `【书/文件#^b1 #^b2】\n原文`，并附"每段可对应多 block，引用时择一"说明
- [ ] 空数组 / undefined 时不注入该段（不破坏现有 prompt）
- [ ] `formatter.ts` normal 分支（:307 调用处）传 retrievedBlocks；CASUAL（:164）/ ADVISOR（:159）分支不动
- [ ] :119-123 multiBook/单书两分支合并为单一 `bookInstruction`（内容本就相同）

**验证方法：**
- [ ] 新增/更新单测：注入格式、空数组不注入、normal 分支传参
- [ ] `npm run test:run` 全绿（含现有 formatter 测试不回归）
- [ ] `npm run build` 通过

**依赖：** 任务 1

**涉及文件：**
- `src/agent/prompts/utils/formatter-helpers.ts`（增参 + 注入 + 清理 duplicate）
- `src/agent/graph/nodes/formatter.ts`（normal 分支 :307 传参）
- `tests/unit/agent/prompts/formatter-helpers.test.ts`（补注入用例）

**预估范围：** S

---

#### 任务 3：`core/formatter.ts` Rule5 改写 — 激活 LLM 引用（S）

**描述：** 把 Rule5 从"严禁创造新链接"改写为"必须基于 `<retrieved_blocks>` 就地引用 ≥1 个 block 级 `[[书/文件#^blockId|别名]]`，别名 2-6 字核心概念词，不得引用 blocks 之外的 block"。zh/en 同步。这是 normal 闭环的"激活"步——改完端到端生效。

**验收条件：**
- [ ] zh systemPrompt Rule5 改为鼓励基于 retrieved_blocks 引用 block 级链接
- [ ] en systemPrompt 同步
- [ ] 保留"analysis 中已有章节级链接可原样保留"
- [ ] 现有 `formatter.test.ts` / `formatter-prompt.test.ts` 中断言旧 Rule5 文案的用例更新

**验证方法：**
- [ ] `npm run test:run` 全绿
- [ ] `npm run build` 通过
- [ ] **部署后手测**（检查点 1）：`npm run deploy` → test-vault 问一个有命中的问题，回复出现 block 级 `[[...#^...]]` 链接且可点开

**依赖：** 任务 2（数据流打通后激活才有意义）

**涉及文件：**
- `src/agent/prompts/core/formatter.ts`（Rule5 zh + en）
- `tests/unit/agent/prompts/core/formatter.test.ts`（更新断言）
- `tests/unit/agent/graph/prompts/formatter-prompt.test.ts`（若断言 Rule5）

**预估范围：** S

---

### 检查点 1：normal 路径端到端

- [ ] `npm run test:run` 全绿、`npm run build` 通过
- [ ] 部署后 normal 路径回复含 block 级链接（基线 raw 0 → ≥1）
- [ ] **langsmith 改后对比**：拉 normal 路径 formatter trace，raw block 链接数 vs 基线 0
- [ ] **请用户确认后再继续阶段 2**

---

### 阶段 2：安全网 + 早停（可并行）

#### 任务 4：injector Step2 "LLM 已引用则跳过" + 单测（S）

**描述：** `wiki-link-injector.ts` Step2 主题词内嵌循环内，对每个 `realFile` 先检测 result 是否已含 `[[${prefix}${realFile}#^` 模式；已有则跳过该文件内嵌（LLM 已原生引用，不重复补）。

**验收条件：**
- [ ] LLM 已为 file X 生成 `#^block` 时，Step2 跳过 X 的主题词内嵌
- [ ] LLM 未引用时，Step2 仍内嵌（兜底，回归现有行为）
- [ ] 跨书模式仍整体跳过 Step2（现有 :150 逻辑不动）
- [ ] 现有 14 个 injector 单测全绿（不回归）

**验证方法：**
- [ ] 新增单测：已引用跳过 / 未引用仍内嵌
- [ ] `npx vitest run tests/unit/agent/utils/wiki-link-injector.test.ts` 全绿
- [ ] `npm run build` 通过

**依赖：** 无（独立，但逻辑上 normal 生效后 Step2 才会遇到"已引用"情况）

**涉及文件：**
- `src/agent/graph/utils/wiki-link-injector.ts`（Step2 加条件，:149-176）
- `tests/unit/agent/utils/wiki-link-injector.test.ts`（补条件跳过用例）

**预估范围：** S

---

#### 任务 5：早停 `blockLines` 格式对齐 + 单测（S）

**描述：** `analytical-pre-search.ts` 的 `formatBlockLines`（:87-98）当前 `【title】(file_name: "...", block_id: ...)`，对齐为 syntopical 样式 `【书/文件#^blockId】\n原文`，降低 LLM 格式映射成本。改后 langsmith 实测早停 raw 链接数。

**验收条件：**
- [ ] `formatBlockLines` 输出格式与 normal 路径 `<retrieved_blocks>` 一致（`【书/文件#^blockId】\n原文`）
- [ ] 现有 analytical-pre-search 相关测试更新通过
- [ ] **实测**：部署后触发早停路径，langsmith 看早停 raw block 链接数（基线待测）→ 若仍 ≈0，记录并在检查点 2 提出是否强化 preSearchPrompt

**验证方法：**
- [ ] `npm run test:run` 全绿
- [ ] `npm run build` 通过
- [ ] 手测早停路径（简单问题触发 pre_search 直接出答）

**依赖：** 无（独立路径）

**涉及文件：**
- `src/agent/graph/nodes/analytical-pre-search.ts`（`formatBlockLines` :87-98）
- 相关测试

**预估范围：** S

---

### 检查点 2：全部完成

- [ ] `npm run test:run` 全绿、`npm run build` 通过
- [ ] normal + 早停双路径 langsmith 对比（改前 0 → 改后 ≥1）
- [ ] injector 安全网保留（Step1 修死链 + Step2 条件兜底）
- [ ] 真实 vault 抽样：回复链接可点开、不死链、不重复
- [ ] **可提交审查**（用户审查后由用户提交 git）

---

## 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| mimo 对 Rule5 改写遵循度不足，喂了 block 仍不引用 | 高 | 任务 3 后 langsmith 实测；若 raw 仍 0，强化 prompt（加 few-shot 正例）；injector 安全网全程保留 |
| Rule5 放开后 LLM 过度堆砌链接 | 中 | 措辞用"至少 1 个"非"全部"；injector Step1 去重兜底 |
| 任务 3 改 Rule5 触发现有测试断言失败 | 低 | 任务 3 含更新断言；先跑测试看哪些依赖旧文案 |
| 早停格式对齐后仍 0 链接（根因是遵循度非格式） | 中 | 任务 5 实测后据数据决定是否二期强化 preSearchPrompt；本次不盲改 |
| token 超 `maxBlocks=5` 预算 | 低 | 基线 4489 + 2000 = 6489 远低窗口；超预算再 Ask First 调参 |

## 待确认问题

- 任务 3 后若 langsmith 实测 mimo 遵循度差（raw 仍 0），是否二期加 few-shot？（检查点 1 决策）
- 早停实测后若需强化 `preSearchPrompt`，是否纳入本 epic？（检查点 2 决策）

## 执行

用 `deepreader-implement` 逐任务执行，每任务完成后立即验证（单测 + build），检查点处停下请用户确认。
