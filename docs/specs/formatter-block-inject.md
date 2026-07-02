# formatter block prompt 注入 retrieved blocks — 功能规格书（Epic #9）

> 让 formatter LLM 看着检索命中的 block 原文，**原生就地引用** block 级 `[[书/文件#^blockId|别名]]`，而非依赖事后 `wiki-link-injector` 补链。injector 从"补链接"降级为"校验安全网"。

---

## 1. 背景

`8d92ab98`（已合并 main）落地了 `wiki-link-injector.ts` 作为**兜底安全网**：在 `sanitizeOutput` 之后做事后补丁——Step1 升级现有章节链接（修死链 + 补 alias + blockId 上下文择优），Step2 主题词内嵌。

但这是**治标**：formatter LLM 生成时 prompt 里**根本没有检索到的 block 原文**，LLM 没机会就地引用 block 级，全靠 injector 事后补。本 epic 是**治本**——把 retrieved blocks 喂进 formatter prompt，让 LLM 原生生成 block 级链接。

### 现状三路径（已 ground 坐实）

| 路径 | 入口 | 喂 block 原文 | 引导生成链接 | 系统 prompt | #9 改动量 |
|---|---|---|---|---|---|
| **normal** | `formatter.ts:307` → `buildFormatterUserMessage` | ❌ **从不**（只传 `analysisResult` 摘要） | ❌ Rule5 反而**禁止创造新链接** | `core/formatter.ts` Rule5 双重封锁 | **重写（主战场）** |
| **早停** | `analytical-pre-search.ts:472` → `buildEarlyStopPrompt` | ✅ `blockLines` + `refBasket` | ✅ `preSearchPrompt` 已齐全（格式+正例反例+覆盖率要求） | 已齐全 | 对齐格式 + 实测遵循度 |
| **syntopical** | `syntopical-helpers.ts:48` | ✅ `【file#^block】\n原文` | ✅ | — | **不动（参考样板）** |

### 根因证据

- **normal**：`formatter-helpers.ts:69` `buildFormatterUserMessage` 签名里**没有** retrieved blocks 参数；`formatter.ts:307` 调用时只传 `effectiveAR`（上游 L4 摘要）。`toolResultsSnapshot` 在 state 里（`formatter.ts:134` 解构），但只用于事后：`buildRetrievalCoverage`（:60 只取 `args.node_id`）、`verifyAndCleanContent`（:347 校验幽灵 block_id）、`upgradeInlineWikiLinks`（:413 兜底补链）。**从未进 prompt**。
- **normal prompt 封锁**：`core/formatter.ts` Rule5「保留 wiki 链接」明确写"严禁自行创造输入中不存在的任何新链接"——与"让 LLM 自己生成 block 级链接"**直接冲突**，必须同步改。
- **早停矛盾**：`preSearchPrompt`（`core/pre-search.ts`）引导非常完整，数据也喂了，但 LangSmith trace `019f16ad`（《疯传》社交货币，早停路径）实测 formatter raw 输出 **0 个** wiki 链接——说明问题在 GLM 遵循度或 `blockLines` 格式（`【title】(file_name, block_id)\ncontent`）未被 LLM 正确映射成 `[[书/file#^block]]`，而非缺 prompt。
- **数据结构就绪**：`ToolResultSnapshot`（`state.ts:37`）已含 `args.node_id` / `result`（原文）/ `extractedBlockIds`（block_id 数组），配合 `nodeFileMap`（node_id→文件名）即可拼出注入内容，**无需改 state schema**。

### 现有资产

| 资产 | 位置 | 说明 |
|---|---|---|
| `buildFormatterUserMessage` | `src/agent/prompts/utils/formatter-helpers.ts:69` | 待改：新增 retrieved blocks 注入 |
| `formatterNode` (normal 分支) | `src/agent/graph/nodes/formatter.ts:205-422` | 待改：提取 block 传给 prompt builder |
| `formatterPrompt` Rule5 | `src/agent/prompts/core/formatter.ts` | 待改：从"禁止创造"→"基于 block 就地引用" |
| `buildEarlyStopPrompt` + `formatBlockLines` | `src/agent/prompts/utils/early-stop.ts:5` / `analytical-pre-search.ts:87-98` | 待对齐格式 + 实测 |
| `preSearchPrompt` | `src/agent/prompts/core/pre-search.ts` | 早停引导（已齐全，视实测决定是否强化） |
| `upgradeInlineWikiLinks` | `src/agent/graph/utils/wiki-link-injector.ts:115` | Step1 保留、Step2 加"LLM 已引则跳过"条件 |
| syntopical 注入样板 | `src/agent/prompts/utils/syntopical-helpers.ts:46-49` | **正确参考**：`【${fileName}#^${blockId}】\n${content.slice(0,400)}` |
| 数据来源 | `toolResultsSnapshot`（state）+ `nodeFileMap` | 拼注入内容的原料 |

---

## 2. 目标

- **治本**：normal 路径 formatter LLM 看着 block 原文原生生成 block 级 `[[书/文件#^blockId|别名]]`，不再全靠 injector 补。
- **降级安全网**：injector 从"补链接"降为"校验 + 兜底"——Step1（修死链）必留，Step2（主题词内嵌）仅在 LLM 漏引时补。
- **双路径一致**：normal 与早停都达成 LLM 原生引用；早停因 prompt 已齐，以格式对齐 + 实测为主。
- **不回归**：链接真实性 100%（file/blockId 源自 snapshot，不捏造），现有 injector 14 单测 + formatter 测试全绿。

---

## 3. 命令（Commands）

- 构建：`npm run build`
- 单元测试：`npm run test:run`
- 单个测试：`npx vitest run tests/unit/agent/utils/wiki-link-injector.test.ts`
- 部署：`npm run deploy`（→ test-vault `deepreader-dev/`，worktree 统一覆盖）
- 冒烟：`node scripts/smoke/smoke.mjs`（core 11）/ `--level full`（25）
- 轻量 E2E：`scripts/smoke/lib/obsidian-cli.mjs` 的 `evalObsidian()`
- LangSmith trace：`langsmith-tracer` skill（session `DeepReader`，API key 在 `test-vault/.obsidian/plugins/deepreader-dev/data.json` 的 `langsmithApiKey`，**勿入文档/提交**）

---

## 4. 受影响模块

- `src/agent/prompts/utils/formatter-helpers.ts` — `buildFormatterUserMessage` 新增 retrieved blocks 参数 + 注入 `<retrieved_blocks>` 段；顺手清理 :119-123 multiBook/单书 dead duplicate
- `src/agent/prompts/core/formatter.ts` — Rule5 改写（禁止创造 → 基于 block 就地引用）
- `src/agent/graph/nodes/formatter.ts` — normal 分支（:205-422）从 `toolResultsSnapshot` 提取 block，传给 prompt builder
- `src/agent/graph/utils/wiki-link-injector.ts` — Step2 加"LLM 已为该文件引用则跳过"条件
- `src/agent/prompts/utils/early-stop.ts` / `analytical-pre-search.ts` — 早停 `blockLines` 格式对齐（视实测）
- `tests/unit/agent/` — 新增/更新 prompt 注入 + injector 条件跳过测试

**不碰**：CASUAL 分支（`formatter.ts:164-202`，闲聊无 block 检索）、ADVISOR passthrough（:159）、PageIndex、UI、索引、state schema。

---

## 5. 技术约束

- 遵循现有 LangGraph 节点 + prompt module 模式（`PromptModule` locale 结构）
- **不改 state schema**：`ToolResultSnapshot` 接口不动，复用现有字段
- 文件路径/文件名一律经 `nodeFileMap` 解析，不硬编码
- 日志用 `utils/logger.ts`（`agentLog`），不用 `console.log`
- Agent 唯一入口：`FrontendAgent.chat()` → `runGraphEngine()` → `stream()`
- TypeScript 严格模式（strictNullChecks）
- prompt 双语：`zh` 必改，`en` 同步

## 6. 代码风格

```typescript
// 注入格式参考 syntopical-helpers.ts:48-49（已验证 LLM 可用）
const blockLine = `【${pdfName}/${fileName}#^${cleanBlockId}】\n${content.slice(0, 400)}`;

// 提取 + 截断：函数命名 动词+名词，明确抛错不静默吞
function extractRetrievedBlocks(
  snapshot: ToolResultSnapshot[],
  nodeFileMap: Record<string, string>,
  pdfName: string,
  opts: { maxBlocks?: number; maxCharsPerBlock?: number },
): { fileName: string; blockId: string; excerpt: string }[] { /* ... */ }
```

---

## 7. 方案概要

### 7.1 normal 路径（核心）

1. **新增 `extractRetrievedBlocks(snapshot, nodeFileMap, pdfName, opts)`**：遍历 `toolResultsSnapshot`，**按 snapshot 记录聚合**（非按 blockId 平铺）——每条记录取 `args.node_id` → `nodeFileMap` 得 `fileName`，`extractedBlockIds` 得该段的全部 blockId，`result` 得原文（截断）。返回 `{fileName, blockIds: string[], excerpt}[]`。
   - **关键去重**：一条 snapshot 记录 = 一段原文 = 可能含多个 blockId（见 injector `:68-69` 注释）。按 blockId 平铺会让同一段原文重复 N 次；按记录聚合则**每段原文只喂一次**，附其全部 blockId（省 60%+ token）。
   - 跨记录去重相同 blockId（不同关键词命中同 block）。
   - 受**总 token 预算**约束（见下），动态决定入池记录数；`maxCharsPerBlock`（建议 400 字 ≈ 520 token）做单段截断。
2. **`buildFormatterUserMessage` 增参** `retrievedBlocks?: {fileName, blockIds: string[], excerpt}[]`，注入（多 blockId 共一段原文）：
   ```
   <retrieved_blocks>
   【书/文件#^b1 #^b2 #^b3】
   原文片段…（本段对应上述 block，引用时按语义择一）

   【书/文件#^b4】
   原文片段…
   </retrieved_blocks>
   ```
   空数组则不注入该段。prompt 说明：每段原文可对应多个 block_id，引用时挑最贴切的 1 个生成 `[[书/文件#^blockId|别名]]`。
3. **`formatter.ts` normal 分支**：调 `extractRetrievedBlocks` 拿 blocks，传入 `buildFormatterUserMessage`。
4. **`core/formatter.ts` Rule5 改写**：从"禁止创造新链接"→"必须基于 `<retrieved_blocks>` 就地引用至少 1 个 block 级 `[[书/文件#^blockId|别名]]`；别名 2-6 字核心概念词；不得引用 `<retrieved_blocks>` 之外的 block（防捏造）；analysis 中已有章节级链接可保留"。同步 `en`。

### 7.2 早停路径

1. **格式对齐**：`formatBlockLines`（`analytical-pre-search.ts:87-98`）当前 `【title】(file_name: "...", block_id: ...)`，与 normal 的 `【书/file#^block】` 不一致。对齐为 syntopical 样式，降低 LLM 格式映射成本。
2. **实测驱动**：格式对齐后用 `langsmith-tracer` 重跑早停场景，对比 raw 输出链接数。若仍 ≈0，再考虑强化 `preSearchPrompt`（如加 few-shot 正例）——但**先测再改**，不盲目改 prompt。

### 7.3 injector 降级

- **Step1（:123-147）保留**：修死链 + alias + blockId 择优，仍是 LLM 输出的真实性安全网。
- **Step2（:149-176）加条件**：循环内对每个 `realFile`，先检测 result 中是否已存在 `[[${prefix}${realFile}#^` 模式；**已有则 `continue` 跳过该文件的主题词内嵌**（LLM 已原生引用，不重复补）。LLM 漏引时 Step2 仍兜底。

---

## 8. 测试策略

- **单元（Vitest）**：
  - `extractRetrievedBlocks`：正常提取、`node_id` 缺失/`nodeFileMap` 无映射跳过、`extractedBlockIds` 空跳过、`maxBlocks`/`maxCharsPerBlock` 截断、同 blockId 去重
  - `buildFormatterUserMessage`：有 blocks 时含 `<retrieved_blocks>` 段且格式正确；空数组时不注入
  - injector Step2：LLM 已为 file X 生成 `#^block` 时跳过 X 的内嵌；未生成时仍内嵌（回归现有 14 单测不破）
- **LangSmith 量化**（implement 前后各一次）：
  - normal 路径 formatter 节点 raw 输出（injector/sanitize 前）的 block 级 `[[...#^...]]` 数量：基线（推断 ≈0，实测确认）→ 目标平均 ≥1/回答
  - 早停路径同指标
- **真实 vault**（部署后）：`~/Documents/昭见森奚童大脑/DeepReader/<书名>/` 问一个有命中的问题，回复链接可点开、不死链、不重复
- 测试位置：`tests/unit/agent/prompts/` + `tests/unit/agent/graph/utils/`
- 不依赖外部 API：单元测试 mock LLM，不触真实 LangSmith（trace 仅人工抽样）

---

## 9. 验收标准

- [ ] normal 路径 formatter prompt 含 `<retrieved_blocks>` 段（有命中时），至少 1 个 block
- [ ] normal 路径 LLM raw 输出（injector 前）block 级 `[[...#^...]]` 数：**基线实测 = 0**（normal formatter raw，《Power and Prediction》对话样本，prompt ≈4489 tok；同期有 1 个章节级 `[[书/文件|别名]]` 但无 `#^`）→ 目标平均 ≥1/回答
- [ ] 链接真实性 100%：file/blockId 均源自 `toolResultsSnapshot`，无捏造（injector Step1 + `verifyAndCleanContent` 保证）
- [ ] injector Step2 不与 LLM 重复：日志显示"LLM 已引用，跳过内嵌"的次数 > 0（当 LLM 引用时）
- [ ] token 膨胀可控：retrieved_blocks 段经**记录级去重**后增量可控（**具体值按实际配置模型的 tokenizer 实测**——模型用户可配，默认 xiaomi `mimo-v2.5-pro`，不绑死任一模型，故不写死估算值）；S4 总 prompt 控在 context 窗口合理占比内
- [ ] 早停 `blockLines` 格式与 normal 对齐
- [ ] `npm run test:run` 全绿（含现有 14 injector 单测 + 新增）
- [ ] `npm run build` 通过
- [ ] 真实 vault 部署后，命中场景回复链接可点开、不死链、不重复

---

## 10. 边界

**Always**
- 改完跑 `npm run test:run` + `npm run build` 再交付审查
- prompt `zh`/`en` 双语同步
- 新增函数写 JSDoc
- injector 安全网**保留**（LLM 不可控，不能裸奔）

**Ask First**
- 改 `maxBlocks`/`maxCharsPerBlock` 默认值（影响 token）
- 改 `preSearchPrompt` 文案（早停实测后若需强化）
- 改 state schema / `ToolResultSnapshot` 接口

**Never**
- 删 injector Step1（修死链是真实性底线）
- 删 `verifyAndCleanContent` 调用
- 把 LangSmith API key 写进代码/文档/提交
- 绕过 Obsidian Vault API 直接 fs 操作用户内容
- 提交密钥、改 `bin/` 产物、删失败测试用例

---

## 11. 验证策略（顺序）

1. **拉 normal 基线**（implement 前）：`langsmith-tracer` skill 拉几条 normal 路径（depth≥1，非早停）formatter trace，确认 raw 输出 block 级链接数（推断 ≈0）。回填本 spec 第 9 节"基线"。
2. 写代码（按 `deepreader-plan` 拆的任务）。
3. 单元测试 + build。
4. 部署到 test-vault，真实 vault 抽样验证。
5. **改后 langsmith 对比**：同场景重跑，量化 raw 链接数提升。

---

## 12. 风险 / 待确认问题

- **模型遵循度未知**：主模型**用户可配**（`settings.ts` 默认 xiaomi `mimo-v2.5-pro`，**非 GLM**——曾误传 GLM，已核实更正），其对"就地引用 block"的遵循度未知；喂了 block 也可能不引用/引用错 → injector 安全网必须留（已纳入方案）。改后 langsmith 实测是唯一判据。
- **token 膨胀（已优化，仍需实测）**：normal S4 prompt **实测 ≈4489 tokens**（langsmith 基线，handoff 称 6614 偏高）。本次靠**记录级去重**让同一段原文不重复喂。仍存在的重复：`analysisResult`（L4 已转述 block）与 retrieved_blocks 原文是同一信息的两种表示——这是"让 S4 精确到 block 级"的必要代价。4489 基线下加 ~1000-1500 token 的 retrieved_blocks 余量充足。用**总预算上限**（retrieved_blocks ≤ S4 user message ~25%）+ 动态 `maxBlocks` 控制；**token 数按实际配置模型（默认 xiaomi mimo-v2.5-pro）的 tokenizer 实测**，模型可配故不写死估算值。
- **早停 vs normal 双路径**：早停 prompt 已齐全却 0 链接，根因（遵循度 vs 格式）未定 → 方案定"先对齐格式 + 实测"，不盲目改 prompt。
- **Rule5 放开后过度堆砌**：LLM 可能每个 block 都引 → "至少 1 个"措辞 + injector 去重兜底。
- **`extractedBlockIds` 共用 excerpt**：同条 snapshot 多 blockId 共用 `result` 原文（injector 注释 :69 已知），按 block 精确切分是后续优化，本次按整段 excerpt 注入可接受。

---

## 13. worktree

- 本 epic 在 worktree `.worktrees/feat-formatter-block-inject`（branch `feat/formatter-block-inject`，base main `8d92ab98`）。
- `feat/wiki-link-inject` worktree 已合并 main（ff 到 `8d92ab98`），可清理。
