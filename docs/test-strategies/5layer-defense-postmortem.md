# 5-Layer Defense Bug 复盘 (Postmortem)

> 事件时间：2026-06-07 | 文档目的：把这次"回报函数工程找不到"案例的过程、决策、教训沉淀下来
> 关联文档：`5-layer-defense-E2E.md`（策略） / `5layer-defense-E2E-RUN-REPORT.md`（运行报告） / `llm-bug-e2e-pattern.md`（通用方法论）
> 受众：未来遇到类似 LLM-bug 调查的工程师

---

## 0. 事件概述（一句话）

> 用户报告：DeepReader 奚童在《AI极简经济学》中**4 轮对话**反复声称"未出现"回报函数工程"，但概念实际存在于第 8 章"判断的价值"的 H3 小节里。

---

## 1. 时间线（关键决策点）

| 阶段 | 时间 | 关键事件 | 决策 |
|------|------|----------|------|
| **报告** | 04:51 | 用户 prompt：4 轮未找到 | 启动 bug 调查 |
| **错误假设** | 04:55 | 推测根因：S2 `pre_search` scope 太小 | 写 plan：`pre_search` 应包含 `validatedScopeNodeIds` 所有子节点 |
| **首次复现** | 04:51-04:54 | Phase 2 跑 4 轮 → LLM 4/4 声称"未出现" | 复现成功（表象层面） |
| **Forward 验证** | 04:57-04:58 | Phase 3a pushback 路径 → LLM 找到第 8 章 | 看似修复有效 |
| **Anti-Hallu** | 05:01 | Phase 3b 反例探针 → LLM 正确否认不存在的概念 | 修复路径看起来"没引入新 bug" |
| **Silent-fix** | 04:54-05:01 | Phase 4 扫 sentinel 词 → 10/10 clean | 内部状态未泄露 |
| **分支分析** | 12:51 | 重读 `02-bug-repro-turn-1.md` 等 4 个文件 | 发现 LLM 实际**有提到**"回报函数工程"，但把答案放在了"对应原文"里，**未触发 5 层防御中的 L4 跳早停** |
| **数据层验证** | 12:54 | 读 `tree.json` 60 节点 → 31 个 `title === "##"` | **根因 pivot**：parser 层问题，不是 LLM 层 |
| **二次复现** | 12:55-13:01 | 修复 Fix 1（splitLargeEpubPages）+ Fix 2（collectNodeSummaries nodeId-keyed） | 索引重建后 0/60 节点 `title === "##"` |
| **最终回归** | 12:55-13:01 | 4 阶段重跑 → 4/4 pass | 修复确认 |

**总时长**：约 8 小时（含人机交互等待 + 索引重建 + 4 轮对话）

---

## 2. 根因：双层 bug 叠加

### Bug 1：`splitLargeEpubPages` 标题提取错误

**文件**：`src/pageindex/parsers/epub.ts:1182-1202`（修复前在 963-973）

**症状**：当单 XHTML 文件 `tokenCount > 4500` 时，按 `\n(?=## |第X章|Chapter|...)` 切分；切分后每段的 title 用 `EPUB_TITLE_PREFIX` 正则**捕获的 prefix 字符**（`#` / `##`）作为 title。

**影响**：1 个 XHTML 章节被切碎成 N 个 chapter，每个 chapter 的 title 变成 `#` / `##` / `第一章`（仅 prefix，无实际章节名）。

**证据**：AI 极简经济学 共 60 个 tree.json 节点，**31 个 (52%) title 为 `##`**。

### Bug 2：`collectNodeSummaries` 撞车

**文件**：`src/pageindex/book-indexer.ts:1054-1075`（修复前在 1050-1068）

**症状**：以 `node.title` 作为 dict key 收集 summary。当 Bug 1 让多个节点 title 都是 `##` 时，**最后一次写入的 summary 胜出**。

**影响**：所有 `##` titled 节点共享同一个（错误的）summary。

**证据**：`22 - .md` 和 `23 - .md` 的 frontmatter summary 都是 "该部分为文档的参考资料列表..."，与原文不符。

### 两个 bug 的乘积效应

| Bug 1 | Bug 2 | 联合影响 |
|-------|-------|----------|
| ✅ 存在 | ❌ 不存在 | 章节 title 错但 summary 正确，S2 能搜到节点，LLM 能答对 |
| ❌ 不存在 | ✅ 存在 | title 正确，summary 错，LLM 给到错的章节信息 |
| ✅ 存在 | ✅ 存在 | 节点 0022 title="##" + summary 错 + 多个 0022/0023 撞车 → **S2 检索到错的 chunk → LLM 给错答案** |

第 3 行就是本案例的真实情况。

---

## 3. 关键决策点 + 教训

### 决策 1：初始假设错误（教训 1）

**错误假设**：`pre_search` 工具的 scope 太小，没把子节点（0022/0023）纳入。

**为什么错**：把"LLM 答错"等同于"LLM 检索层有 bug"，跳过了"数据层是否正确"这个前置检查。

**正确路径**：
1. 跑 4 轮对话 → 复现 ✅
2. 读 LangSmith trace → 看到 pre_search 命中 `['0009', '0020', '0025']`（不含 0022/0023） → 看似是 scope 问题
3. **但**应先验证：0022/0023 节点**本身**是否正确？如果它们 title="##"，那搜不到也合理 → 是数据层问题

**教训**：**症状在 LLM 层，根因可能在数据层**。验证时先看 `tree.json` / `catalog.json` / 章节 .md 文件本身。

### 决策 2：Phase 3b 假阳性（教训 2）

**错误评估**：把"LLM 提到第 4 章"判为 hallucination。

**为什么错**：脚本把"提到目标概念不存在的章节"算 hallucination，但**第 4 章"为什么叫它智能"是真实存在的章节**，LLM 在说"作者在第 4 章没展开这个技术细节" — 这是**正确**的"找不到"。

**正确评估标准**：
- ✅ 不存在 = LLM 没说概念在该章
- ❌ 不存在 = LLM 提到了别的章

**教训**：**P0 不变量应从用户视角定义**，不是从脚本作者的偏见定义。判 hallucination 应基于"该概念在 ground truth 中是否存在 + 链接/章节引用是否真实"。

### 决策 3：splitLargeEpubPages 既有测试钉死 buggy 行为（教训 3）

**意外发现**：`tests/unit/pageindex/epub-splitting.test.ts:228-241`（修复前）显式 assert `result.chapters[0].title === '#'` 并加注释 "pre-existing 行为，保留以便后续重构时不产生静默变更"。

**为什么这样**：当时的开发者知道这是 bug，但为了避免静默变更，留了 regression test 把它钉死。

**教训**：
- "保留 buggy 行为 + regression test" 是**反模式** —— 应该删除 buggy 行为 + 删除测试 + 加正确行为测试
- 后人看到这个注释会以为"这是设计决定"，**直接放弃修这个 bug**
- "pre-existing 行为" 不应作为长期不修的借口

### 决策 4：Fix 2 的 API 变更（教训 4）

**变更**：`collectNodeSummaries` 返回类型从 `Record<string, string>` 改为 `Record<string, { title: string; summary: string }>`。

**为什么必要**：旧 `title-keyed` 把"语义身份"（title）和"身份键"（nodeId）混为一谈，导致撞车。

**好处**：
- 编译期强制所有 caller 同步更新（`epub-to-obsidian.ts:30` 同步改了类型）
- 调用方按 nodeId 查（`String(index+1).padStart(4,"0")`），与 `buildEpubTree` 实际主键对齐

**教训**：**改 API 类型 > 加注释**。TS 编译错误比注释更能强制协调。

---

## 4. 修复后的效果

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| tree.json 中 `title === "##"` 节点数 | 31/60 (52%) | 0/60 (0%) |
| 阶段 1 bug 复现（4 轮 base） | 4/4 LLM 答错 | 4/4 LLM 答对（无需 pushback） |
| 阶段 2 forward（pushback） | 3/3 LLM 找到 | 3/3 LLM 找到（基线对齐） |
| 阶段 3 anti-hallu | 3/3 假阳性 | 3/3 正确识别"书里没有" |
| 阶段 4 silent-fix | 10/10 clean | 10/10 clean |
| LangSmith trace `scopeNodeIds` | `['0009','0020','0025']`（漏 0022/0023） | `['0022','0020','0025','0009']`（含目标） |
| L5 `verifiedFullBookHits` | `[]`（未触发 restart） | `['0022']`（触发 restart） |

---

## 5. 改进建议（回归 / 防再发）

### P0：必须做

1. **新增长尾 E2E**：`scripts/e2e-light/index-quality-gate.spec.mjs`
   - 任何索引完成后**强制**跑 `verify-index-quality.mjs` 检查 3 项不变量
   - 在 README/CI 流程里加 hook，防止 `title === "##"` 节点数 > 0 的索引被使用

2. **删除 "pre-existing 行为" 反模式**：扫一遍 `tests/unit/` 找类似注释，全部删除 buggy 测试 + 加正确行为测试

3. **anti-hallucination 评估函数化**：把"判 hallucination"的规则抽成 `evalHallucination(response, groundTruth)` 公共函数，避免每次新写脚本都重复造轮子（容易引入偏见）

### P1：建议做

1. **索引回归套件**：每个 parser / indexer 变更后，自动跑 5 本真实书的"索引质量 + 4 阶段 LLM 对话"回归（耗时 30 分钟）
2. **数据层 pre-flight**：在 S2 启动前，先 assert `tree.json` 通过 `verify-index-quality.mjs`，不通过直接报错
3. **LangSmith trace → 报告自动生成**：每次 E2E 跑完，自动从 trace 拉 `scopeNodeIds` / `verifiedFullBookHits` 等关键字段，生成对照表

### P2：可做

1. **章节命名规范化**：`23 - .md` → `23 - 第8章-判断的价值.md`（提升用户体验，与索引修复正交）
2. **dashboard**：把 4 阶段 LLM-bug 调查的产物（响应、trace、索引质量）做成可视化 dashboard

---

## 6. 给未来类似调查的 checklist

```
□ 阶段 0：定性 + 4 问 + 5 项前置就绪
□ 阶段 0.5：数据层质量门禁 3 类检查（结构 / 标题 / 关键词）
  □ 如有失败 → 修数据层，不进 LLM 测试
□ 阶段 1：4 轮 bug 复现（base + 3 pushback）
  □ 至少 3 轮稳定复现
  □ 记录 LangSmith trace ID
□ 阶段 2：forward 场景（3 轮 pushback 验证修复路径）
  □ 验证修复路径的 trace 节点名出现
□ 阶段 3：anti-hallucination（至少 1 轮用真不存在概念）
  □ P0 不变量从用户视角定义（不是从脚本作者偏见）
  □ 评估标准：概念是否存在 + 链接/章节是否真实
□ 阶段 4：silent-fix（sentinel 词扫描 = 0）
□ 根因诊断时先验证数据层，再上 LLM 层
□ 不留 "pre-existing 行为" 反模式
□ 改 API 类型 > 加注释
```

---

## 7. 关联脚本 / 文档

| 类型 | 路径 |
|------|------|
| 策略 | `docs/test-strategies/5-layer-defense-E2E.md` |
| 报告 | `docs/test-strategies/5layer-defense-E2E-RUN-REPORT.md` |
| 模板 | `docs/test-strategies/llm-bug-e2e-pattern.md` |
| 4 阶段执行脚本 | `scripts/e2e-light/phase{2,3a,3b,4}-*.mjs` |
| 索引质量脚本 | `scripts/e2e-light/verify-index-quality.mjs` |
| 索引监控 | `scripts/e2e-light/monitor-indexing.mjs` |
| 重新索引 | `scripts/e2e-light/reindex-ai-book.mjs` |
| 响应日志 | `test-vault/9-Logs/5layer-defense-E2E/0[0-4]-*.md` |
| LangSmith trace | API key 在 `data.json`；trace 在 LangSmith 项目 `DeepReader` |
