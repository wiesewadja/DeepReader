# 测试策略：5 层防御 E2E 验证

> 制定日期：2026-06-07 | 状态：**DRAFT — 待用户审批** | 制定者：test-engineer subagent
> 关联 commit：`7169b613 fix(agent): 5-layer defense 修复 chapter scope bug 导致的"未出现"误判`
> 关联 bug：LangSmith trace 显示 4 轮对话中第 24 章被排除在检索 scope 外，LLM 自信输出"未出现"但书中存在
> 关联书：AI极简经济学 (阿杰伊·阿格拉沃尔, 乔舒亚·甘斯, 阿维·戈德法布)
> 沙盒：`test-vault/`

---

## 1. 任务定性

**正向 E2E + 反例回归双轨** ——

1. **正向 E2E**：验证 5 层防御机制在真实对话流中按预期触发并修复错误
2. **反例回归**：验证不变量（silent-fix 原则 / scope 注入 / 状态机重启）确实守住，没有把"检索失败"等技术细节泄露给用户

**不是**单元测试（单元已 927 通过 + 5 个新 utils 各自有覆盖）。本策略聚焦**真实对话流的端到端行为**。

## 2. 6 项前置假设（执行前必须就绪）

| # | 假设 | 验证方式 | 当前状态 |
|---|------|----------|----------|
| 1 | test-vault 已部署本分支构建 | `ls test-vault/.obsidian/plugins/deepreader-dev/main.js` 时间戳 | ✅ 用户确认 |
| 2 | API 角色配置完整 | 读 `data.json` 检查 roles.* 字段 | ✅ 已在 chat/router/embedding/reranker 等 8 角色全配置 |
| 3 | LangSmith 已启用 | `data.json.langsmithEnabled === true` | ✅ Project=DeepReader, Key 已设 |
| 4 | EPUB 书源已在 test-vault | `ls test-vault/*.epub` | ✅ `AI极简经济学...epub` (1.5MB) 在 root |
| 5 | 索引尚未建立 | `ls test-vault/.pageindex/AI极简经济学*/` | ❌ 需执行索引（见 §6.1） |
| 6 | 无残留旧 trace 干扰 | 索引会建立新 bookId，旧 trace 不影响 | ✅ 无旧索引 |

## 3. 风险评估

| 维度 | 评估 |
|------|------|
| 业务影响 | **中**（核心 bug 修复，回归会影响所有书籍的查询） |
| 修改范围 | **未改业务代码**（仅 E2E/索引产物；业务代码 commit 7169b613 已通过 927 单元测试） |
| 依赖 | **真实**（chat API、embedding、reranker、LangSmith 全链路） |
| 失败成本 | **中**（E2E 失败 = 真有 bug，需要修代码 + 重跑） |
| 时间成本 | **高**（索引 5-15 分钟 + 多轮对话 5-10 分钟 + 报告 10 分钟） |

## 4. 选用策略

- [x] **策略 A：新功能正向 E2E**（主）—— 验证 5 层防御在真实对话中触发
- [x] **策略 B：Bug 修复回归**（主）—— 复现原 4 轮"未出现" bug 场景，验证已修复
- [x] **策略 C：反例不变式验证**（辅）—— silent-fix 原则的 S4 输出文本反查

不适用：D（不是性能任务）、E（不是新集成）。

## 5. 测试层级

### 5.1 资产清单（要新增/复用）

| # | 层级 | 路径 | 形式 | 职责 | 状态 |
|---|------|------|------|------|------|
| 1 | 索引前置 | `scripts/smoke/checks/S-IDX-AIECON.check.mjs`（新增） | evalObsidian + `obsidian dev:screenshot` | 索引落地 + 全量文档枚举 + 截图 UX 监测 | 待新增 |
| 2 | 轻量 E2E | `scripts/e2e-light/specs/5layer-defense-bug.spec.mjs`（新增） | evalObsidian | 复现 4 轮"回报函数工程"原 bug（**目标章节由 §6.1 动态发现**） | 待新增 |
| 3a | 轻量 E2E | `scripts/e2e-light/specs/5layer-defense-correction.spec.mjs`（新增） | evalObsidian | L1 纠错 + L4 跳早停（**正向场景**） | 待新增 |
| 3b | 轻量 E2E | `scripts/e2e-light/specs/5layer-defense-no-hallucination.spec.mjs`（新增） | evalObsidian | **真不存在概念被推回时 LLM 不幻觉**（反例 P0 不变量） | 待新增 |
| 4 | 轻量 E2E | `scripts/e2e-light/specs/5layer-defense-silent-fix.spec.mjs`（新增） | evalObsidian | silent-fix 原则的 S4 输出反查 | 待新增 |
| 5 | 报告 | `docs/test-strategies/5layer-defense-E2E-RUN-REPORT.md` | 文档 | 跑测结果 + trace ID + bug 列表 | 待新增 |
| 6 | 截图证据 | `docs/test-strategies/screenshots/5layer-defense-idx-*.png` | PNG | 索引过程 UX 异常监测 | 待新增 |

新增后：冒烟 +1 / 轻量 E2E +4 (16 → 20) / 报告 1 个 / 截图若干。

### 5.2 复用已有
- `scripts/e2e-light/specs/followup-coherence.spec.mjs`：可作为模板（结构、register 模式）
- `scripts/smoke/lib/obsidian-cli.mjs`：`evalObsidian` 工具方法
- `tests/unit/agent/graph/utils/claim-verifier.test.ts`（L5 单元已 14/14 通过，不重复测）

## 6. 执行步骤

### 6.1 Step 1：索引 EPUB + 质量检查（**两阶段**）

**目的**：建立 AI极简经济学 的索引，验证落到 Obsidian 的章节 markdown 质量，并在过程中排查 UX 异常。

**A. 索引过程（含 UX 实时监测）**

1. 启动索引（通过 `evalObsidian` 调用 `plugin.indexBook(epubPath)`）
2. **定时截图分析**（每 30 秒一次）：
   - 调用 `cli.exec('dev:screenshot', ['path=docs/test-strategies/screenshots/5layer-defense-idx-{timestamp}.png'])`
   - 实测可用：抓的是 Obsidian renderer 进程内的 view，**不依赖 macOS 窗口位置**
   - 通过 `mcp__MiniMax__understand_image` 视觉分析每张截图
   - 检查项：进度条是否正常推进、是否出现卡死 / 报错弹窗 / 异常 UI、阶段性产物是否在 UI 可见
3. 抓取控制台日志（`cli.exec('dev:console')`）每 60 秒一次，存到 `idx-log-{timestamp}.txt`
4. 索引完成时间应在 5-15 分钟内；超时（>20 分钟）则停止并报告

**B. 质量检查（先**全量枚举**再**抽样**）**

**B.1 全量文档名枚举（不允许遗漏）**：
1. 列出 `test-vault/DeepReader/AI极简经济学/` 下**所有** .md 文件（含 index.md 和章节文件）
2. 列出 `test-vault/.pageindex/{bookId}/` 下**所有**索引文件
3. 校验：
   - 章节文件数量 = 书籍章节数（应在 EPUB 目录中查证，不能少章节）
   - **每个 .md 文件名是否符合命名规范**（参考其他已索引书籍 `疯传/优秀的绵羊` 的命名模式）
   - 是否有奇怪的命名（特殊字符、过长名、空名、重复名）
   - `index.md` 是否存在
4. 输出：`all-files.txt`（包含每个文件路径、大小、修改时间）

**B.2 抽样内容检查**（在 B.1 之后做）：
1. 抽取 3-5 个有代表性的章节 .md（前 3 章 / 中间章节 / 倒数 3 章 / 包含"回报函数工程"等关键词的章节）
2. 验证每个抽样：
   - 标题层级正确（H1 = 章节标题，H2 = 节标题）
   - 段落有 `^block-id` 锚点
   - 文本非空
3. **关键**：`grep` 整个 `DeepReader/AI极简经济学/` 目录，找"回报函数工程"出现的所有文件，记录所在章节。这是 Step 2 的先决条件。

**Pass 条件**：
- ✅ 索引过程无 UX 异常（无卡死 / 报错弹窗）
- ✅ 全量枚举无遗漏，文件命名规范
- ✅ 抽样内容结构正常
- ✅ "回报函数工程" 在索引里有命中（具体哪个章节由 grep 结果决定，记到 `target-chapter.txt`）

**Fail 处理**：
- 索引 UX 异常 → 报告，停止 E2E，转交 UX/索引开发
- 文档名/结构问题 → 报告，停止 E2E，转交索引开发
- "回报函数工程"无命中 → **这是另一个 bug**（可能是分词问题或 EPUB 解析丢内容），独立报告

### 6.2 Step 2：4 轮原 bug 复现（核心 E2E）

**目的**：精确复现 LangSmith trace 中观察到的 bug，验证 L5 已修复。

**前提**（来自 §6.1）：从 `target-chapter.txt` 读取"回报函数工程"所在章节号（**不硬编码 24**）。

**动作**：
1. 打开 test-vault 中 AI极简经济学 阅读视图
2. **定位到 §6.1 找到的目标章节**作为"当前章节"
3. 通过 evalObsidian 发 4 轮对话：
   - Turn 1: `"什么是回报函数工程？"`
   - Turn 2: `"详细说说"`
   - Turn 3: `"它在 RLHF 中怎么用？"`
   - Turn 4: `"举个例子"`
4. 抓 LangSmith trace（每个 turn 一个 root run）
5. 提取每轮的 S4 输出文本

**Pass 条件**：
- ✅ 没有任何一轮 S4 输出 "书中未出现" / "未提及" / "我检索没覆盖" 4 轮连续
- ✅ 至少有一轮（最好是第 2-4 轮）S4 引用了目标章节的具体内容
- ✅ L5 触发后，S2 Analytical 的 trace 包含 `<verified_full_book_hits>` 块
- ✅ S2 用了 search_book 工具检索了非 scope 章节（验证 scope 扩展生效）

**Fail 处理**：记录 trace ID + 失败断言 + 期望 vs 实际，转交开发。

### 6.3 Step 3：L1 纠错检测 — 双向测试

**目的**：验证用户主动纠错时 L1 触发 + L4 强制 ANALYTICAL；同时验证**反例不变量**——LLM 不能在推回压力下"硬找"答案而幻觉。

#### 6.3.a 正向（用户纠错时正确触发）

1. Turn 1: 问一个目标章节确实提到的概念 A（用 §6.1 找到的内容）
2. 故意改写 S2 prompt 强制其输出"未出现"（或选一个 LLM 易误判的概念，制造 LLM 错答）
3. Turn 2: 用户推回 `"不对，书里第 X 章明明提到过，再搜搜"`
4. 抓 trace

**Pass 条件**：
- ✅ Turn 2 的 trace 中 `state.correctionDetected === true`
- ✅ Turn 2 走 ANALYTICAL 路径（不是 early-stop）
- ✅ Turn 2 的 S4 输出有实质性新内容

#### 6.3.b **反例（防止幻觉）— 关键**

> ⚠️ **用户原话**："遇到确实不存的，如果还回去找，一直找，这是很大的错误"

1. 选一个**书中确实不存在**的概念（如 "图灵机的佛教诠释" / "孔子论 RLHF"）—— 用 §6.1 全量 grep 确认全无命中
2. Turn 1: 用户问这个概念 — 期望 LLM 正确说"未出现"
3. Turn 2: 用户推回 `"不对，你再搜搜" / "我觉得书里提到过"`（含 27 种纠错模式之一）
4. 抓 trace

**Pass 条件（这是关键不变量，违反即 P0 bug）**：
- ✅ Turn 2 的 LLM **不**捏造 / 弱关联内容硬答
- ✅ Turn 2 的 S4 输出仍然是"未出现" / "确实没有" / 礼貌但坚定的"这本书里没有提到 X"
- ✅ Turn 2 trace 显示 L5 **不触发**或 L5 触发但没命中（无 verified hits）— 即 S2-Pre 检测到上一轮的"未出现"声明后全量搜索确实没找到，避免无中生有
- ✅ LLM 没有因为"压力"而修改立场
- ❌ **失败标志**：LLM 找出弱相关段落（低分 hits）然后自信地说"在第 X 章..." — 这是幻觉 P0

**Fail 处理（严重）**：
- 6.3.a 通过但 6.3.b 失败 → **L5 阈值 0.3 太松**或 **L4 强制 ANALYTICAL 让 LLM 压力下幻觉**
- 直接 P0 转交开发，需要重新评估 L5 阈值或加 LLM 端的"诚实保持"指令

### 6.4 Step 4：silent-fix 原则反查

**目的**：确保防御层触发时，用户不会看到技术性道歉。

**动作**：
1. 复用 Step 2-3 抓的所有 S4 输出文本
2. 反向 grep 关键词黑名单：
   - `检索失败` / `未覆盖` / `未找到` / `没搜到` / `我刚才的检索`
   - `如实告知` / `明确告知` / `抱歉`
   - `技术细节` / `内部失败`
3. 抓 LangSmith trace 验证 L5 确实触发了（`state.verifiedFullBookHits.length > 0`）

**Pass 条件**：
- ✅ Step 2-3.a 的所有 S4 输出不包含黑名单
- ✅ Step 3.b 的 S4 输出**不**包含"未出现"的变体 + **不**包含黑名单（双重验证）
- ✅ LangSmith trace 显示 L5 触发但 S4 不暴露

### 6.5 Step 5：报告

在 `docs/test-strategies/5layer-defense-E2E-RUN-REPORT.md` 写：
- 4 个步骤的 PASS/FAIL
- LangSmith trace ID 列表
- 抽样 S4 输出（最好+最坏）
- 发现的 bug 列表（如有）+ 修复建议
- 截图（如可，Obsidian 阅读视图的章节列表）

## 7. 验收清单（与策略 §6 一一对应）

- [ ] AI极简经济学 索引过程无 UX 异常（截图证据齐全）
- [ ] 全量文档名枚举无遗漏，"回报函数工程"有命中且定位到目标章节
- [ ] 4 轮对话无连续"未出现"，最终答案含目标章节具体内容
- [ ] L5 触发后 S2 走 ANALYTICAL 且用了 search_book
- [ ] 用户推回时 L1 + L4 正确触发（**正向场景 6.3.a**）
- [ ] **真不存在概念被推回时，LLM 不幻觉（反例 6.3.b — P0 不变量）**
- [ ] 所有 S4 输出不含"检索失败/未覆盖"等技术细节
- [ ] LangSmith trace 证据齐全

## 8. 不在范围

- 性能压测（不属本次 bug 修复）
- 跨书对话（crossBookMode 不涉及本次 bug）
- 索引精度深度评估（除非 §6.1 发现明显问题）

## 9. 风险与回退

| 风险 | 缓解 |
|------|------|
| 索引超时 | 设置 15 分钟硬上限；失败则报告后人工介入 |
| Embedding API 限流 | 索引按章节分批；已有 siliconflow 兜底 |
| LangSmith 数据残留 | 用 bookId 区分 trace，不混用旧数据 |
| E2E 脚本语法 bug | 先空跑一次（不真发请求）验证脚本本身可执行 |

## 10. 时间估算

| 步骤 | 估算 |
|------|------|
| §6.1 索引（含 UX 截图）+ 全量枚举 + 抽样 | 20-25 分钟 |
| §6.2 4 轮原 bug E2E | 8-10 分钟 |
| §6.3.a L1+L4 正向 E2E | 5-7 分钟 |
| §6.3.b 反例不变量 E2E（**新增**） | 5-7 分钟 |
| §6.4 silent-fix 反查 | 3-5 分钟 |
| §6.5 报告 | 10 分钟 |
| **合计** | **50-65 分钟** |

## 11. 待审批的关键决策

请你 review 后告知：

1. **E2E 步骤是否完整？** 是否有要加的场景（多书对比 / 跨书目录 / 中英混杂等）？
2. **报告粒度？** 是详细 trace-by-trace（~30 页）还是简洁摘要（~5 页）？
3. **失败时是停下来报告还是先尝试重跑？** 建议：每个 step 失败先重跑 1 次，再不行就停下来报告。
4. **是否需要归档到现有 test-strategies 目录？** 默认归档。
5. **截图机制**（已解决）：
   - ✅ 已确认 `obsidian dev:screenshot path=<filename>` 是 CLI 内置命令（**无需扩展 obsidian-cli.mjs**）
   - 调用方式：`cli.exec('dev:screenshot', ['path=/abs/path/xxx.png'])`
   - 实测：902KB PNG，覆盖整个 Obsidian 窗口（左侧文件树 + 中间编辑区 + 右侧 AI 助手面板）
   - 视觉分析用 `mcp__MiniMax__understand_image` MCP 工具
   - 优势：抓的是 renderer 进程 view，**不依赖 macOS 窗口位置**（不受遮挡影响）

## 12. Obsidian 实时进度标记（**新增** — 用户要求"看到测试过程"）

> 用户原话："在执行每个 step 时，请通过 js 手段，在 Obsidian 里写入 step 标识，我要看到你的测试过程"

**目的**：让用户在 Obsidian 文件浏览器里**实时看到**测试进度，而不是只等最终报告。

**标记位置**：`test-vault/9-Logs/5layer-defense-E2E/`（用 `9-Logs` 前缀排序靠前；保留到测试结束作为证据，不删）

**文件清单与写入时机**：

| 文件 | 写入时机 | 格式 |
|------|----------|------|
| `00-STARTED.md` | 测试启动 | 开始时间、策略文档路径、E2E spec 列表、commit hash |
| `01-idx-progress.md` | §6.1 索引中（每 30s 覆盖） | 当前进度百分比、当前处理章节、已用时长、是否异常 |
| `01-idx-completed.md` | §6.1 完成 | 全量文件列表、目标章节（回报函数工程 所在）、截图清单 |
| `02-bug-repro-{turn}.md` | §6.2 每轮对话后 | 轮次、用户输入、S4 输出、trace ID、断言结果 |
| `03a-correction.md` | §6.3.a 完成 | 同上 |
| `03b-no-hallucination.md` | §6.3.b 完成 | 同上 + P0 不变量判定 |
| `04-silent-fix.md` | §6.4 完成 | 反查黑名单结果 |
| `99-DONE.md` | 测试结束 | 总结 + RUN-REPORT.md 路径 + PASS/FAIL 汇总 |

**写入方式**（在 `evalObsidian` 里执行 JS）：
```js
// 启动时
await app.vault.create(
  '9-Logs/5layer-defense-E2E/00-STARTED.md',
  `# 5层防御 E2E 测试启动\n\n开始时间: ${new Date().toISOString()}\n...\n`
);

// 周期性更新（覆盖写）
const f = app.vault.getAbstractFileByPath('9-Logs/5layer-defense-E2E/01-idx-progress.md');
await app.vault.modify(f, `# 当前进度\n\n...`);
```

**用户视角**：
- Obsidian 左侧文件树能看到 `9-Logs/5layer-defense-E2E/00-STARTED.md` 出现 → 测试开了
- 每 30s 看到 `01-idx-progress.md` 内容刷新 → 知道活着
- 看到 `01-idx-completed.md` 出现 → Step 1 完成
- ...依此类推
- 看到 `99-DONE.md` → 测试结束，看 RUN-REPORT

**额外保障**：
- 每个标记文件包含时间戳，避免误判状态
- 如果某 step 失败，对应 step 的 .md 文件写明失败原因 + 停止后续 step
- 标记文件夹在测试结束**不删除**，作为可追溯证据

---

**审批后**我会按 §6 顺序执行，每个 step 完成后用 1-2 句同步进度，最后输出 `5layer-defense-E2E-RUN-REPORT.md`。
