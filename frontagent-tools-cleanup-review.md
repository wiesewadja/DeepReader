# 评审 · `refactor/frontagent-tools-cleanup` vs `frontagent-tools-spec.md`

> 评审基准：`frontagent-tools-spec.md`（D1=A2 / D2=B2，M1–M3）
> 评审方式：静态比对分支树（`git diff dev...branch` + `git grep <branch>`），**未 checkout、未跑构建**（避免改动工作树）。
> 结论：**基本忠实落地，但有一处超出批准范围的"激进清理"需你拍板。**

---

## 0. 总判定

| 维度 | 结果 |
|------|------|
| 与 Spec 行为一致性 | ✅ 高（P0-2 / P1-1 / P1-2 / P2-1 / P2-3 全部按 Spec 落地） |
| 构建安全性 | ✅ 无悬空 import（分支树 grep 验证通过） |
| 测试对齐 | ✅ 测试随改动同步更新，且比 Spec 更严谨 |
| **范围合规性** | ⚠️ **P0-1 验收#2 与 D1=A2 被违反**：分支把 4 个死工具 `definitions/*.ts` 定义文件整个删了，超出"仅摘注册、保留定义可逆"的批准范围 |
| 文档一致性 | ⚠️ L6 §1.4 仍写"定义文件保留可逆"，与代码实际删除矛盾 |

**判定：有条件通过（Approve with changes）**——核心逻辑正确、构建安全；但 DEV-1 的"超范围删除"要么你明确接受（并改文档/Spec），要么恢复定义文件以贴合已批准决策。

---

## 1. 逐条核对（Spec → 分支）

| Spec 任务 | 状态 | 证据 |
|-----------|------|------|
| **P0-1** 摘 5 死工具注册（`index.ts`） | ✅ 符合 | 删 `createWriteNoteTool/createSaveMemoryTool/createSearchMemoryTool/createUpdateProfileTool/createSearchReadBooksTool` 调用 + 对应 import；数组仅剩 `search_book`/`read_book_section`/`excalidraw` |
| **P0-1** 保留 `definitions/*.ts` 不改动（验收#2） | ⚠️ **违反** | `definitions/memory.ts`、`profile.ts`、`search-read-books.ts`、`write-note.ts` 被**整文件删除**（见 DEV-1） |
| **P0-2** `intent-rules.json` 诚实化 | ✅ 符合 | 5 条 rule 的 `tools[]` + 顶层 `tool_aliases` + `fallback.tools` 全删；新增 `_note` |
| **P0-2** `types.ts` 可选化 | ✅ 符合 | `tools?: string[]`、`fallback.tools?: string[]`、`tool_aliases` 移除 |
| **P0-2** `intent-router.ts` 4 处必改 | ✅ 符合 | `:23 cfg.fallback.tools ?? []`、`:60 rule.tools?.forEach`（⚠️关键可选链）、`:74 this.fallbackTools?.forEach`、`:110 buildSystemNote` 工具集为空返 `''` |
| **P0-2** 回归测试 | ✅ **超出 Spec** | `intent-router.test.ts` 保留原路由用例 + 新增"诚实化语义"3 case（`allowedTools===[]` / `systemNote===''` / 不抛 `forEach of undefined`） |
| **P1-1** `tool-permissions.ts` | ✅ 符合 | `NODE_TOOL_WHITELIST` 与 Spec 逐字一致（advisor 6 / analytical 2 / 其余 []） |
| **P1-1** `advisor.ts` / `analytical.ts` | ✅ 符合 | 改读 map；**显式删除** `if (toolContext.visual?.journalDir) push('search_journal')` 块（Spec 强调勿漏，已删） |
| **P1-2** `formatToolError` | ✅ 符合 | `types.ts` 新增函数；**未引入** `interface ToolResult` 死类型 |
| **P1-2** catch 统一 | ✅ 符合 | 已被 `search-journal.ts`、`weread-tools.ts` 调用；分支树 grep 确认 `definitions/` 内仅剩 `SKIP/SUCCESS` 正常返回，错误路径全走 `formatToolError` 或子图层兜底 |
| **P2-1** `invokeWithTimeout` | ✅ 符合 | 放在 `tool-execution.ts:154` 唯一执行落点外层 `Promise.race`，覆盖单工具 + `executeToolBatch` 并行；**未 monkey-patch 实例 `.invoke`**（采纳了评审的修正） |
| **P2-1** 超时测试 | ✅ 符合 | `tool-execution.test.ts` 3 case（单工具挂死→timed out / 正常工具 / 批量单点挂死其余正常） |
| **P2-2** 归并 v1 | ⚠️ **方法偏离** | Spec 要求"先把 v1 实现并入 `definitions/*.ts`，再删 v1 文件"；分支**直接删除** 4 个 v1 根文件 + 4 个 v1 依赖的 definitions 包装器。结果（无 v1 残留）干净，但过程不符；前置检查 grep 外部消费者**实质已满足**（分支树零引用） |
| **P2-3** `diagram-helper` 注释 + L6 | ✅ 符合 | 注释改为"direct-call-only"；L6 §1.2/§1.4/§1.10/§2.1/§2.2 全面对齐（见 DEV-1 文档矛盾点） |

---

## 2. 发现（DEV）

### DEV-1 · 超范围删除死工具定义文件（需决策）— 高可见度

**Spec 怎么说的**
- D1=A2 决策原文："摘注册（**保留 `definitions/*.ts`，零行为风险，后续想接活随时加回**）"
- P0-1 §验收标准#2："`definitions/write-note.ts`、`definitions/memory.ts`、`definitions/profile.ts`、`definitions/search-read-books.ts` **文件仍存在、未改动**"

**分支实际做的**
- 删除 4 个 `definitions/*.ts`（每个 26–49 行，全是 v1 包装器）
- 删除 4 个 v1 实现根文件 `tools/memory.ts`(-152)、`tools/profile.ts`(-123)、`tools/search-read-books.ts`(-179)、`tools/write-note.ts`(-208)

**影响评估（已核实，不致命）**
- ✅ 构建不破：分支树 grep 确认**无任何文件** import 这些被删文件（无悬空引用）。
- ✅ 运行不破：这 5 个工具本就未绑定到任何节点白名单（死工具），且 grep 确认 `writeNoteTool`/`addMemoryTool` 等名在分支内**零残留引用**——笔记/记忆/画像功能走的是 note writer / memory service / profileBuilder 旁路，不依赖这些包装器。
- ⚠️ 但违反已批准决策的"可逆"承诺：D1=A2 选 A2 而非 A1（接活）的核心理由就是"先摘、留 definitions 文件可逆"。分支把可逆性也删了。
- ⚠️ 引发文档矛盾：L6 §1.4 仍写"这 5 个工具的注册已摘除（`definitions/*.ts` 定义文件**保留可逆**，待 P2-2 归并清理）"——代码已删，文档说保留，自相矛盾。

**建议（二选一，请你定）**
- **A. 接受激进清理（推荐）**：既然死工具确无消费者、删除干净，直接认可。需同步：① 改 `frontagent-tools-spec.md` 的 D1=A2 措辞与 P0-1 验收#2 为"定义文件一并删除"；② 改 L6 §1.4 的"保留可逆"为"定义文件已删除"。
- **B. 恢复以贴合 Spec**：`git checkout dev -- src/agent/tools/definitions/{memory,profile,search-read-books,write-note}.ts`，并撤销 `index.ts` 里对应的 re-export 删除（保持只摘注册），回到批准范围。

### DEV-2 · P2-2 实现方法偏离（低风险，可忽略）

Spec 写"归并 v1 实现到 definitions 后再删"，分支直接删除。因这些工具是死的，结果等价且更彻底。Spec 要求的"前置 grep 外部消费者"已实质满足（零引用）。**不改也行**，仅记录方法差异。若选 DEV-1 的 B 方案，此条自动消解（definitions 恢复、v1 文件保留）。

### DEV-3 · 未实跑测试/构建（流程说明，非缺陷）

本次评审为静态比对，我**未 checkout 分支、未执行 `npm run build` / vitest**，以遵守你此前"停止行动"的指令、并避免改动 `dev` 工作树。静态分析表明应可通过（无悬空引用、tsc 类型改动均为放宽/新增）。**合并前建议**在分支跑一次作最终门禁：
```bash
git checkout refactor/frontagent-tools-cleanup   # 或在 worktree 中
npx vitest run src/agent
node scripts/smoke/smoke.mjs --only S-22,S-23
```

---

## 3. 亮点（分支做得比 Spec 更好）

- `langchain-tools.test.ts`：把 `toBeGreaterThanOrEqual(7)` 改为 `toHaveLength(3)`（mockContext 无 journalDir/wereadApiKey → 仅基础 3 工具），并显式断言 5 死工具 `not.toContain`——比 Spec"若有断言==14 则改 9"更精确。
- `intent-router.test.ts`：保留原路由正确性用例 + 新增回归守护，固化"诚实化"语义，防未来有人重新往 json 塞 `tools[]` 造成惰性回归。
- `tool-execution.test.ts`：在 Spec 要求的 2 case 基础上加了"正常工具不受影响"第 3 case。
- 4 个提交按 M1/M2/M3 清晰拆分，符合质量门习惯。
- L6 文档随代码同步重写，口径一致（除 DEV-1 的"保留可逆"矛盾）。

---

## 4. 合并前待办清单

- [ ] **决策 DEV-1**：接受激进清理（改 Spec+L6）or 恢复 definitions 文件（贴合批准决策）。
- [ ] **修 L6 §1.4 文档矛盾**：若接受删除则把"保留可逆"改为"已删除"；若恢复则保持但确保代码与文档一致。
- [ ] **实跑测试**：在分支执行 `npx vitest run src/agent` + `S-22,S-23` smoke，作为最终门禁（本次评审未跑）。
- [ ] 红线：本分支不涉及 `git commit/push` 之外的越权操作；合入 `dev` 前 `npm run test:run` 必须过（按项目流程由测试代理在 dev→main 层跑）。
