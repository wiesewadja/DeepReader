# 测试策略：LLM Agent Bug E2E 调查模式

> 制定日期：2026-06-07 | 状态：**模板**（任何 LLM 相关 bug 都可以套用）
> 起源：本模式提炼自 `5-layer-defense-E2E`（"回报函数工程"未找到案例），可参数化复用到未来的 LLM-bug 调查。
> 适用场景：LLM 答复错误 / hallucinate / 漏检索 / 越权 / 重复内容 / sentinel 词外泄等一切"对话层表象问题"。

---

## 0. 这个模板解决什么问题

LLM 类 bug 的特点：**症状在对话层，根因可能在数据层、检索层、生成层、防御层任何一处**。盲目按症状打补丁（"用户说没找到，那就扩大检索 scope"）经常是错方向。

本模式强制 **"先验证数据层，再上 LLM 测试"** 的工作流，把 LLM-bug 调查拆成 5 个阶段，每阶段都有"是/否可继续"门禁。

---

## 1. 适用条件（什么时候用这个模板）

| 触发 | 用本模板 | 用其他 |
|------|----------|--------|
| 用户报告"LLM 答错 / 没找到 / 编造 / 卡死" | ✅ | |
| LangSmith trace 显示某节点耗时/token 异常 | ✅ | |
| S4 输出出现 sentinel 词（"检索失败"等） | ✅ | |
| 单元测试 / 冒烟挂了 | | 先修单测 |
| UI 渲染异常（与 LLM 无关） | | 用 E2E 视觉验证 |
| 纯 LLM 调用超时不归因于插件 | | 走 API 配额排查 |

---

## 2. 5 阶段流程（含门禁）

### 阶段 0：定性 + 前置条件

**目标**：把症状精确描述清楚，把外部依赖（vault / API / 索引）确认就绪。

**4 必答问题**：

| # | 问题 | 不答清的代价 |
|---|------|--------------|
| 1 | 哪类 bug？（漏检索 / 答错 / hallucinate / 沉默 / 越界） | 模板走错分支 |
| 2 | base case 还是 pushback 触发的？ | 修复路径选错 |
| 3 | 索引数据层是否验证过正确？ | **最常见翻车点**：症状在 LLM，根因在数据 |
| 4 | 涉及哪些 book / 哪些工具 / 哪些节点？ | 范围不清 = 测试无效 |

**前置检查清单**（与 `5-layer-defense-E2E` 同源）：

- [ ] `data.json` 8 个 roles 全部配置（chat / router / pageindex / embedding / reranker 等）
- [ ] `langsmithEnabled=true` 且 API Key 有效
- [ ] 目标书源已在 test-vault
- [ ] 旧索引已清（如有）
- [ ] 主分支构建已部署到 test-vault

**退出条件**：4 问有答 + 5 项就绪。

---

### 阶段 0.5：索引 / 数据层质量门禁（**关键**）

**目标**：在跑任何 LLM 对话测试**之前**，先验证底层数据是否正确。

**原因**：如果索引数据本身是错的，LLM 不可能答对。此时跑 LLM 测试只会得到误导性的"修复无效"结论。

**3 类必查**（依场景选）：

| 检查类型 | 工具 | 关键断言 |
|----------|------|----------|
| **结构完整性** | 直接读 `tree.json` / `catalog.json` | 节点数、章节文件数 |
| **标题正确性** | 编写 `verify-index-quality.mjs` 类脚本 | `title !== "##"`，`title !== ""`，frontmatter summary 不串行 |
| **关键词可达性** | BM25 / embedding 检索脚本 | 用户提的关键词在索引中能被搜到 |

**实测案例**（5-layer-defense）：
- 检查 1：60 章节节点中 `title === "##"` 的数量 = 0（修复前是 31/60）
- 检查 2：第 8 章子节点（`23 - .md`）的 summary 字段是"回报函数工程"相关，不是"参考文献"串行
- 检查 3：在 5 个文件（`23 / 37 / 44 / 47 / 57 - .md`）中搜"回报函数工程" → 15 处命中

**退出条件**：3 类检查全过。如有失败 → **先修数据层，**不**进入阶段 1**。

---

### 阶段 1：Bug 复现（4 轮 base + pushback）

**目标**：在用户实际可能用的问法下，稳定复现 bug。

**4 轮问法模板**（按用户实际交互路径）：

| Turn | 问法 | 探查意图 |
|------|------|----------|
| 1 | 直接问"书里有没有 X" | base case 漏检索 |
| 2 | "X 在书的哪里" | 即使找不到也能说章节范围 |
| 3 | "我好像在第 N 章看到过 X，你再确认" | 强迫 LLM 重新检索 |
| 4 | "X 应该是在 Y 那一章" | pushback 触发修复路径（5 层防御） |

**响应记录 schema**（每轮存一份）：

```markdown
# Phase 2 - Turn N

**时间**: ISO timestamp
**用户提问**: <原文>

**LLM 响应**:
```
<完整原文>
```

**响应 ID**: LangSmith run ID
**响应长度**: N chars

## 评估
- 关键断言 1: ✅/❌
- 关键断言 2: ✅/❌
- 关键断言 3: ✅/❌
```

**退出条件**：
- 4 轮全跑完
- 至少 1 轮稳定复现 bug（不能"这次碰巧对了"）
- LangSmith trace ID 全部记录

---

### 阶段 2：Forward / Correction 场景

**目标**：验证 bug 修复路径在 pushback 后能正确触发。

**3 轮问法**：

| Turn | 问法 | 探查意图 |
|------|------|----------|
| 1 | base case（无 pushback） | 修复后 base case 直接答对？ |
| 2 | 强 pushback："我确定书里有" | L1 纠错 + L4 跳早停 路径 |
| 3 | 追问小节："X 是在哪一节" | 修复后能 pinpoint 到具体小节 |

**退出条件**：
- 3 轮关键断言全过
- 修复路径的 trace 节点名出现在 LangSmith 中（如 `L1_correction` / `L4_early_stop`）

---

### 阶段 3：Anti-Hallucination（P0 不变量）

**目标**：**防止修复引入新 bug**。这是最容易被错过的阶段。

**两类探针**：

| 类型 | 探针设计 | 评估 |
|------|----------|------|
| **真不存在的概念** | 挑一个**与书的主题相关但书中确实没出现**的术语（如"神经拟态网络"之于 AI 经济学科普书） | LLM 必须**明确说"书里没有"** + **不编造章节或链接** |
| **邻近主题的概念** | 挑一个**有 50% 相似度**的术语（如 LLM 与"深度学习"） | LLM 应**承认差异** + **不冒充找到** |

**P0 不变量定义原则（关键）**：

> 判 hallucination 应基于 **"该概念在 ground truth 中是否存在"** + **"链接/章节引用是否真实存在"**，**不是**"是否提到某个章节"。

**反例**（5-layer-defense 真实教训）：
- Phase 3b 一开始把"LLM 提到第 4 章"判为 hallucination
- 但第 4 章"为什么叫它智能"是真实存在的
- LLM 实际在说"作者在第 4 章没展开这个技术细节" — 这不是 hallucination，是正确的"找不到"
- 修正评估标准后，3 轮全 pass

**退出条件**：
- 3 轮中**至少 1 轮**使用真不存在概念探针
- 所有探针响应都通过"链接真实 + 章节真实 + 不冒充"三重检查

---

### 阶段 4：Silent-Fix 验证

**目标**：确保任何"内部失败状态"都不暴露给用户。

**Sentinel 词清单**（26 个，每轮 E2E 都扫一遍）：

```
检索失败 / 搜索失败 / 搜索出错 / 查询失败 / 查询出错
无法.{0,5}(查询|检索|搜索) / 未能.{0,3}(搜索|检索|查询)
未覆盖 / 未索引 / 未建立.{0,5}索引 / 没有索引
索引失败 / 索引出错 / 服务异常 / 系统错误
internal.{0,5}error / server.{0,5}error
\[TOOL_CALL\] / <tool_response / search_book\(.*\) / pre_search\(.*\)
\.pageindex\/ / \.obsidian\/plugins\/
TODO.*未完成 / FIXME / \[DEBUG\]
```

**扫描范围**：阶段 1-3 全部响应。

**退出条件**：所有响应 sentinel 词命中 = 0。

---

## 3. 多工具栈组合（LLM-bug 调查的真实形态）

| 工具 | 何时用 | 拿到什么 |
|------|--------|----------|
| **单元测试** (`npm run test:run`) | 修代码后立即验证 | 函数级正确性、回归保护 |
| **Obsidian CDP** (`dev:cdp`) | 触发 reindex / 调命令 / 读状态 | 实时运行时数据 |
| **Obsidian 截图** (`dev:screenshot` + `mcp__MiniMax__understand_image`) | UI 异常 / 索引过程监测 | 视觉证据 |
| **LangSmith trace** | 任何 LLM 行为异常 | run 树、token 分布、tool 命中 |
| **vault 文件直读** | 数据层验证 | tree.json / catalog.json / 章节 .md 实际内容 |
| **E2E 脚本** (`scripts/e2e-light/phase-N-*.mjs`) | 跑 4 阶段对话 | 响应原文 + 评估结果 |

**4 个工具缺一不可**：
- 只有单测：抓不到 LLM 行为层 bug
- 只有 LLM 对话：抓不到数据层 bug（症状错位）
- 只有 LangSmith：看不到落地结果（章节文件实际写了什么）
- 只有 vault 文件直读：跑不动真实对话流

---

## 4. 根因诊断的"前提验证"原则

**反模式**：用户说"LLM 没找到 X" → 直接去改 S2 pre_search scope → 错。

**正循环**：

```
1. 症状：用户报告"LLM 漏了 X"
2. 验证数据层：tree.json 中 X 实际所在节点的 title 是什么？
   - title 正确 → 进 LLM 层（scope / 工具 / prompt）
   - title 错误 / 空 → 修数据层（parser / indexer）
3. 验证检索层：直接 BM25 / embedding 搜 X → 命中吗？
   - 命中 → 修 scope / 工具
   - 不命中 → 修 chunking / 索引
4. 验证生成层：S4 的 prompt 是否给到 S2 的搜索结果？
   - 给到 → 修 S4 prompt
   - 没给到 → 修数据流（节点传递 / 序列化）
```

**实测教训**（5-layer-defense）：
- 初始假设：`pre_search` scope 太小（已 commit 的 7169b613 修的就是这个）
- 实际根因：`splitLargeEpubPages` 把 chapter title 切成 prefix（`##`），后续 `collectNodeSummaries` 用 title 作 key 导致 0022/0023 节点的 summary 撞车
- 修复路径不同：先修 parser 才有意义修 LLM 层

---

## 5. 模板参数化（如何套用到新 bug）

新 LLM bug 调查时，复制本文件 → 重命名 → 填以下变量：

| 变量 | 说明 | 示例 |
|------|------|------|
| `TARGET_CONCEPT` | 用户报告"找不到 / 答错"的概念 | 回报函数工程 / 神经拟态网络 |
| `GROUND_TRUTH_LOCATION` | 概念实际所在的章节 + nodeId | 第 8 章 / nodeId 0022 |
| `BUG_CLASS` | 4 类之一 | 漏检索 / 答错 / hallucinate / sentinel |
| `SCOPE_NODES` | 关联的 PageIndex 节点 | ['0009', '0020', '0022', '0023'] |
| `EXISTENCE_PROBES` | 阶段 3 用的不存在概念 | 神经拟态网络 / 量子退火 |
| `EXPECTED_TOOL_HITS` | 期望 LangSmith trace 中命中的 tool | pre_search / search_book / checkBlockIdExists |
| `PHASE_4_SENTINELS` | 阶段 4 扫描的 sentinel 词 | 复用 26 个默认 + 业务特定 |

---

## 6. 跑通本模板的 4 个必备产物

| 产物 | 路径 | 形式 |
|------|------|------|
| 4 阶段响应日志 | `test-vault/9-Logs/<feature>-E2E/0[2-4]-*.md` | markdown |
| 4 阶段执行脚本 | `scripts/e2e-light/phase[2-4]-*.mjs` | Node.js + CDP |
| 索引质量门禁脚本 | `scripts/e2e-light/verify-index-quality.mjs` | Node.js + fs |
| 运行报告 | `docs/test-strategies/<feature>-E2E-RUN-REPORT.md` | markdown |

---

## 7. 跑一次典型时间预算

| 阶段 | 最小 | 典型 | 阻塞风险 |
|------|------|------|----------|
| 0 准备 | 5 min | 10 min | API Key / 部署 |
| 0.5 索引 + 质量检查 | 5 min（已有索引）/ 20 min（重新索引） | 15 min | 索引超时 |
| 1 bug 复现 | 5 min | 8 min | LLM 速率限制 |
| 2 forward | 5 min | 8 min | 同上 |
| 3 anti-hallu | 5 min | 8 min | 同上 |
| 4 silent-fix | 1 min | 2 min | 无（grep 即可） |
| **总计** | **26 min** | **51 min** | |

---

## 8. 已知局限 / 反模式

- ❌ **不能跳过阶段 0.5** — 数据层错了，LLM 必错
- ❌ **不能用同一本书的不同概念反复跑** — 索引数据一旦被污染，结论不可信
- ❌ **不能把阶段 3 当单元测试** — anti-hallucination 必须用真实 LLM，单元 mock 测不到
- ❌ **不能在阶段 1 复现失败就判定 bug** — 至少 3 轮稳定复现才下结论
- ❌ **不能在 bug 修完就停** — 阶段 3 是"修复是否引入新 bug"的唯一保险

---

## 9. 关联文档

- **本模板首次套用实例**：`docs/test-strategies/5-layer-defense-E2E.md`（策略）+ `5layer-defense-E2E-RUN-REPORT.md`（报告）+ `5layer-defense-postmortem.md`（复盘）
- **配套 agent**：`.claude/agents/deepreader-test-engineer.md`（在 "LLM Agent Bug E2E 调查模式" 章节引用本模板）
- **LangSmith trace 解读**：`.claude/skills/langsmith-tracer/SKILL.md`
- **Obsidian CDP 用法**：`.claude/skills/obsidian-cli-tester/SKILL.md`
