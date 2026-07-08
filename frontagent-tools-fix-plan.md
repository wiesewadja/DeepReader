# FrontAgent 工具层修复计划

> 基于 `frontagent-tools-audit.md` 的审计结论。所有改动遵循项目红线：
> 测试**分模块**执行；不自行 commit/push；业务代码禁静态 import Node 核心模块。

## 背景速览（审计结论）

- 注册表 `createLangChainTools`（`tools/index.ts:45-69`）共 **14 个工具**。
- 真正能被 LLM 工具循环调到的只有 **6 个**：
  - `search_book` + `read_book_section` → 仅 S2 Analytical（`analytical.ts:96`）
  - `weread_search/recommend/readdata/book_info/notebooks` + `search_journal` → 仅 S-Advisor（`advisor.ts:113`）
- **5 个死工具**（在注册表，但无任何节点 `bindTools` 暴露给模型）：
  `save_memory` / `search_memory` / `update_profile` / `write_note` / `search_read_books`
- `excalidraw` 例外：被 `diagram-helper.ts` 在 S1/S3 直接 `.execute()`，不走 LLM 循环。
- `intent-rules.json` 用 v1 旧名，且与 `allowedTools` 一样**不参与真实过滤**（门禁在节点白名单）。
- 技术债：错误返回 3 套形态；白名单硬编码 3 处；`TOOL_EXECUTION_TIMEOUT_MS` 未接 `Promise.race`；v1/v2 工具形态并存；L6 文档与代码矛盾。

---

## P0 — 正确性（必修，影响行为）

### P0-1 · 5 个死工具的去留（需拍板）
| 工具 | 现有真实写入/读取路径（旁路） | 建议 |
|------|------------------------------|------|
| `save_memory` | memory service 直写（非工具） | 二选一 |
| `search_memory` | memory service 直读 | 二选一 |
| `update_profile` | `profileBuilder` 节点直写 | 二选一 |
| `write_note` | note writer 直写 | 二选一 |
| `search_read_books` | `syntopicalSearch()`（`syntopical.ts:106`）并行实现 | 二选一（见下） |

- **A 方案（接活）**：把确有价值的工具接到对应节点 `bindTools`，让模型真能调用
  （如 `write_note`→advisor/analytical、`save_memory`/`search_memory`→analytical、`update_profile`→advisor）。
- **B 方案（删冗余）**：从注册表删除，保留旁路实现，消除误导死代码。
- `search_read_books` 与 `syntopicalSearch()` 二选一统一，避免双实现漂移。

### P0-2 · `intent-rules.json` 对齐 / 下线（需拍板）
- **A 方案（扶正为权威）**：把 `intent-rules.json` 的旧名改为 v2 现名，并让它成为
  节点→工具绑定的**唯一来源**，替换 `advisor.ts:113` / `analytical.ts:96` 的硬编码数组。
- **B 方案（下线）**：删除该文件 + `IntentRouter.allowedTools` 的空转逻辑，门禁完全交给节点白名单，文档写清现状。
- 无论选哪个，必须消除"配置看起来约束了工具、实际没约束"的误导。

---

## P1 — 可维护性（强烈建议）

### P1-1 · 白名单集中化 → 新建 `src/agent/tools/tool-permissions.ts`
- 单一 map：`{ advisor: [...], analytical: [...], syntopical: [...], inspectional: [...] }`。
- `advisor.ts` / `analytical.ts` 改为从该 map 取白名单；若 P0-2 选 A，则直接由 `intent-rules.json` 驱动此 map。
- 消除 3 处硬编码 + 与 `allowedTools` 的语义割裂。

### P1-2 · 错误返回结构统一
- 在 `tools/types.ts` 定义唯一 `ToolResult { ok: boolean; data?: unknown; error?: { code: string; message: string } }`。
- 各 `definitions/*.ts` 的 catch 统一返回该结构（当前 3 套形态）。
- `diagram-helper.ts` 直调路径同样消费统一结构。

### P1-3 · `excalidraw` 调用路径收敛
- `diagram-helper.ts` 直调 `.execute()` 属合理设计（非 LLM 循环），但应在 `tool-permissions.ts`
  或文档中显式登记为"direct-call only"，避免下次审计再次被误判为死工具。

---

## P2 — 技术债（可排期）

### P2-1 · 接入 `TOOL_EXECUTION_TIMEOUT_MS`
- 在 `tools/index.ts` 的 `execute` 包装里用 `Promise.race([impl, timeout(60000)])`
  （`agent-constants.ts:72` 已声明，全仓未用）。避免单工具挂死拖垮整轮。

### P2-2 · v1/v2 工具形态统一
- 审计发现 v1（markdown 形态：`get_document_outline` 等）与 v2（book 形态）定义并存。
- 确认无调用方后删除 v1 残留，或统一到 v2 工厂。

### P2-3 · `docs/architecture/agent-state-machine/L6-tools.md` 对齐代码
- 修正 §1.4「excalidraw 由 S2 调用」与代码矛盾（实为 S1/S3 经 diagram-helper 直调）。
- 补充"死工具/旁路写入"说明，避免文档再次误导。

---

## 执行顺序建议
1. **先拍板 P0-1 / P0-2**（决定整体走向）。
2. P0-2 若选 A → 先做 P1-1（集中化），再删/接死工具；若选 B → 直接删死工具 + 下线 intent 配置。
3. P1-2 / P1-3 与 P0 可并行，改动互不影响。
4. P2 排期在后，不阻塞行为正确性。

## 验证（分模块）
- 改 `tools/*` 或 `graph/nodes/*` → 跑对应模块 vitest + `node scripts/smoke/smoke.mjs --only S-22,S-23`（工具相关场景）。
- 全量 `npm run test:run` 仅在跨模块改动或合并前执行（遵循 AGENTS.md 红线）。
- 接入超时后补一个超时单测（模拟挂死工具）。

## 待你拍板
1. **P0-1**：5 个死工具 A（接活到 bindTools）/ B（删除冗余）？
2. **P0-2**：`intent-rules.json` A（扶正为权威配置）/ B（下线，门禁交给节点白名单）？
