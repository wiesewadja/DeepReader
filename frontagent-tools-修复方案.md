# 奚童 FrontAgent 工具层 · 修复方案

> 本文档为**执行前的修复方案**，供评审。所有改动遵循项目红线：测试分模块执行；不自行 commit/push；业务代码禁静态 import Node 核心模块。
> 配套审计见 `frontagent-tools-audit.md`。

---

## 一、问题清单（均附文件:行号证据）

| # | 问题 | 证据 |
|---|------|------|
| 1 | 注册 14 工具，仅 6 个真正能被 LLM 调用 | `tools/index.ts:44-73` 注册；`analytical.ts:96` 只 bind `search_book`+`read_book_section`；`advisor.ts:113` 只 bind `weread_*`×5 + `search_journal` |
| 2 | 5 个「死工具」注册了但从未 `bindTools` | `save_memory`/`search_memory`(`definitions/memory.ts`)、`update_profile`(`definitions/profile.ts`)、`write_note`(`definitions/write-note.ts`)、`search_read_books`(`definitions/search-read-books.ts`)——注册于 `index.ts:48-52`，全仓无节点引用 |
| 3 | `excalidraw` 不走 LLM 循环 | 被 `graph/utils/diagram-helper.ts` 在 S1/S3 直接 `.execute()`（合理设计） |
| 4 | `intent-rules.json` 用 v1 旧名且**惰性** | 旧名 `get_document_outline`/`read_markdown_section`/`search_markdown_text`/`analyze_chapter`/`generate_infographic`/`canvas`；`IntentRouter.allowedTools` 仅进 state，`bindTools` 用节点硬编码白名单（不读 state）；`systemNote` 文本从未注入模型（`index.ts:222 buildMessages` 的 systemNote 参数未被 router 结果填充） |
| 5 | v1/v2 工具形态并存 | `tools/memory.ts`、`tools/profile.ts`、`tools/search-read-books.ts`、`tools/write-note.ts` 是旧版 markdown 形态（`createSaveMemoryTool()` 无 ctx），仍被 `index.ts:35-38` re-export，与 `definitions/` 下 v2 并存 |
| 6 | `TOOL_EXECUTION_TIMEOUT_MS` 声明未用 | `agent-constants.ts:72`=60000，但无 `Promise.race` 包裹 |
| 7 | 错误返回结构不统一 | 各 `definitions/*.ts` 三套形态 |
| 8 | 白名单硬编码 3 处 | `advisor.ts:113`、`analytical.ts:96`、router advisory |
| 9 | L6 文档与代码矛盾 | `L6-tools.md` §1.4 称「excalidraw 由 S2 调用」，实为 S1/S3 经 diagram-helper 直调 |

**已实测确认的关键事实**：`intent-rules.json` 的 `allowedTools` 与 `systemNote` 对模型行为**零影响**（纯死配置）。因此改动它的风险极低，不是「活跃 bug」，而是「误导性死代码」。

---

## 二、两个决策点（需拍板）

### 决策 D1 — 5 个死工具的去留
- **方案 A1（接活）**：把这 5 个工具接到对应节点的 `bindTools`（如 `write_note`→advisor/analytical，`save_memory`/`search_memory`→analytical，`update_profile`→advisor），让模型真能调用。
  - 收益：补全能力。风险：需配套 prompt 调整 + 回归，且现有旁路（profileBuilder / memory service / note writer）已覆盖相同功能，可能重复写入。
- **方案 A2（摘注册，★推荐）**：从 `createLangChainTools` 移除这 5 个 `create*Tool(ctx)` 调用及对应 import，保留 `definitions/*.ts` 定义文件不删。
  - 收益：零行为风险，消除「注册了却调不到」的误导，后续想接活可随时加回。风险：几乎无。

### 决策 D2 — `intent-rules.json` 的处理
- **方案 B1（扶正为权威）**：把旧名改成 v2 现名，并让它成为节点→工具白名单的唯一来源，替换 `advisor.ts`/`analytical.ts` 的硬编码数组。
  - 收益：配置即真相。风险：v1 名**无法 1:1 映射**到 v2（`get_document_outline`/`analyze_chapter`/`canvas` 在 v2 无对应工具），且改动面大、需重写路由与节点绑定联动。
- **方案 B2（诚实化下线，★推荐）**：删除 json 里每个 rule 的 `tools[]` 与 `tool_aliases`（因 v1 名无法映射且惰性），保留 `intent`/`pattern`/`maxIterations` 用于真实路由；同步让 `IntentRouter` 对缺失 `tools` 容错。
  - 收益：立刻消除「配置在骗人」的误导，且为下一步 P1-1 集中白名单扫清障碍。风险：低（已确认惰性）。

> 我的默认推荐：**D1=A2，D2=B2**。即「先止血（摘死工具 + 诚实化配置），再重构（P1 集中白名单）」。

---

## 三、分模块改动清单

### P0 — 正确性（必修，零/低风险）

#### P0-1 · 摘掉 5 个死工具注册 〔对应 D1=A2〕
- **文件**：`src/agent/tools/index.ts`
- **改法**：
  - 删除注册数组内 `createWriteNoteTool(ctx)` / `createSaveMemoryTool(ctx)` / `createSearchMemoryTool(ctx)` / `createUpdateProfileTool(ctx)` / `createSearchReadBooksTool(ctx)`（原 `index.ts:48-52`）。
  - 删除对应 import（原 `index.ts:8,9,13,21`）。
  - `definitions/*.ts` 定义文件**保留不删**（可逆、供后续接活）。
- **风险**：零。已 grep 确认这 5 个工具在 `src/` 无直调方，唯一消费者就是注册表。
- **可逆**：是（加回调用+import 即可）。

#### P0-2 · `intent-rules.json` 诚实化 〔对应 D2=B2〕
- **文件**：`src/agent/router/intent-rules.json` + `src/agent/router/intent-router.ts`
- **改法**：
  - json：删除 5 个 rule 的 `tools[]` 与顶层 `tool_aliases`；新增 `_note` 字段说明「工具门禁由各节点白名单控制，本文件仅做意图路由」。保留 `intent`/`pattern`/`priority`/`maxIterations`/`comment`。
  - `intent-router.ts`：
    - `:23` `this.fallbackTools = cfg.fallback.tools || [];`
    - `:60` `rule.tools?.forEach(t => allowedTools.add(t));`（可选链）
    - `buildSystemNote`（`:110`）：当 `allowedTools` 为空时，不再输出「仅允许使用 []」的强约束文本，改为中性说明。
- **风险**：低。已确认 `allowedTools`/`systemNote` 对模型惰性。
- **可逆**：是。

### P1 — 可维护性（强烈建议）

#### P1-1 · 白名单集中化
- **新建**：`src/agent/tools/tool-permissions.ts`，导出 `NODE_TOOL_WHITELIST: Record<NodeName, string[]> = { advisor:[...], analytical:[...], syntopical:[...], inspectional:[...] }`。
- **改**：`advisor.ts:113`、`analytical.ts:96` 改为从 map 读取；若 D2 选 B1 则此处直接由 json 驱动。
- **收益**：消除 3 处硬编码 + 与 `allowedTools` 的语义割裂。

#### P1-2 · 错误返回结构统一
- **改**：`tools/types.ts` 定义唯一 `ToolResult { ok; data?; error?:{code,message} }`；各 `definitions/*.ts` 的 catch 统一返回；`diagram-helper.ts` 直调路径同样消费。

#### P1-3 · `excalidraw` 直调路径登记
- **改**：在 `tool-permissions.ts` 或注释中显式登记 `excalidraw` 为 `direct-call-only`（由 diagram-helper 调用，不走 LLM 循环），避免下次审计再次误判为死工具。

### P2 — 技术债（可排期）

#### P2-1 · 接入 `TOOL_EXECUTION_TIMEOUT_MS`
- **改**：`tools/index.ts` 的 execute 包装用 `Promise.race([impl, timeout(60000)])`；补一个超时单测。避免单工具挂死拖垮整轮。

#### P2-2 · 清理 v1 工具残留
- **改**：确认 `tools/memory.ts`、`tools/profile.ts`、`tools/search-read-books.ts`、`tools/write-note.ts`（v1 markdown 形态）无调用方后删除，或统一并入 v2 工厂。同步清理 `index.ts:35-38` 的 v1 re-export。

#### P2-3 · 对齐 L6 文档
- **改**：`docs/architecture/agent-state-machine/L6-tools.md` §1.4 改为「excalidraw 由 S1/S3 经 diagram-helper 直调」；补充「死工具/旁路写入」说明。

---

## 四、验证计划（分模块，遵循 AGENTS.md 红线）

| 改动 | 测试范围 | 命令 |
|------|----------|------|
| P0-1 | tools 注册相关 vitest | `npx vitest run src/agent/tools` |
| P0-2 | router 相关 vitest | `npx vitest run src/agent/router` |
| P0 整体 | 工具相关 smoke 场景 | `node scripts/smoke/smoke.mjs --only S-22,S-23` |
| P1/P2 | 对应模块 vitest + 相关 smoke | 按改动域类推 |
| 合并前 | 全量 | `npm run test:run`（仅跨模块/合并前执行） |

回归关注点：P0-1 后 `createLangChainTools` 注册数应为 9（含条件 journal/weread）；P0-2 后 `IntentRouter.analyze()` 仍能正确返回 `detectedIntents` 与 `maxIterations`，且不再引用不存在的工具名。

---

## 五、执行顺序与里程碑

1. **里程碑 M1（P0）**：止血 —— 摘死工具 + 诚实化 intent 配置。改动小、风险低，可独立提交评审。
2. **里程碑 M2（P1）**：重构 —— 白名单集中化（P1-1）+ 错误结构统一（P1-2）+ excalidraw 登记（P1-3）。P1-1 可与 D2 的选择联动。
3. **里程碑 M3（P2）**：清债 —— 超时接入、v1 清理、文档对齐。不阻塞行为正确性。

> 建议：先评审并通过 M1（P0），再决定是否继续 M2/M3。若 D1 选 A1 或 D2 选 B1，M1 范围会扩大（涉及 prompt 与节点绑定联动），需另行评审。

---

## 六、待确认
1. **D1**：5 个死工具 → A1（接活）还是 A2（摘注册）？
2. **D2**：`intent-rules.json` → B1（扶正为权威）还是 B2（诚实化下线）？
