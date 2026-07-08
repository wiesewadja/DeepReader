# 奚童 FrontAgent 工具层梳理（Tool Audit）

> 审计时间：2026-07-08
> 范围：`src/agent/tools/*` + `src/agent/graph/*`（节点如何绑定工具）
> 方法：读源码 + 交叉验证 `docs/architecture/agent-state-machine/L6-tools.md`

---

## 0. 结论速览

- 共定义 **14 个工具**（8 基础 + excalidraw + 条件 search_journal + 5 个 weread）。
- 实际能通过 **LLM 工具循环**（`bindTools` + PlanExecute/ReAct）被模型调用的只有 **6 个**：
  - `search_book`、`read_book_section` → 仅 S2 Analytical 节点
  - `weread_search/recommend/readdata/notebooks/book_info` + `search_journal` → 仅 S-Advisor 节点
- 其余 **6 个在注册表中但从未被任何节点 `bindTools`**：`save_memory`、`search_memory`、`update_profile`、`write_note`、`search_read_books`、`excalidraw`。
  - 其中 `excalidraw` 例外——由 `diagram-helper.ts` 在 S1/S3 节点**直接调用** `excalidrawTool.execute()`，不走 LLM 工具循环。
  - 其余 5 个目前**完全没有调用路径**（记忆/画像由 `profileBuilder` 等旁路写入，笔记由 visualizer/formatter 直接写）。
- `IntentRouter`（`intent-rules.json`）的 `allowedTools` 软限制引用的是 **v1 旧名**（`get_document_outline`/`read_markdown_section`/`search_markdown_text`/`analyze_chapter`/`generate_infographic`/`canvas`），与现注册名不匹配，且**没有被任何节点用于真正过滤工具集**（节点层是硬编码数组过滤）。→ 形同虚设，且会误导模型。

---

## 1. 工具清单（14 个）

| # | 工具名 | 类别 | 注册条件 | 被 LLM 调用？ | 落地实现 |
|---|--------|------|----------|--------------|----------|
| 1 | `search_book` | search | 基础 | ✅ S2 Analytical | `local/search-text.ts` (`searchBookTool`) |
| 2 | `read_book_section` | read | 基础 | ✅ S2 Analytical | `local/read-section.ts` (`readBookSectionTool`) |
| 3 | `write_note` | write | 基础 | ❌ 未绑定 | 顶层 `write-note.ts` (`writeNoteTool`) |
| 4 | `save_memory` | memory | 基础 | ❌ 未绑定 | 顶层 `memory.ts` (`saveMemoryTool`) |
| 5 | `search_memory` | memory | 基础 | ❌ 未绑定 | 顶层 `memory.ts` (`searchMemoryTool`) |
| 6 | `update_profile` | profile | 基础 | ❌ 未绑定 | 顶层 `profile.ts` (`updateProfileTool`) |
| 7 | `search_read_books` | cross-book | 基础 | ❌ 未绑定 | 顶层 `search-read-books.ts` |
| 8 | `excalidraw` | visual | 基础 | ⚠️ 仅直接调用 | `excalidraw.ts` + `excalidraw-geometry.ts` |
| 9 | `search_journal` | journal | `visual.journalDir` | ✅ S-Advisor | `definitions/search-journal.ts`（内联 `JournalSearchService`） |
| 10 | `weread_search` | weread | `wereadApiKey` | ✅ S-Advisor | `definitions/weread-tools.ts` |
| 11 | `weread_recommend` | weread | `wereadApiKey` | ✅ S-Advisor | 同上 |
| 12 | `weread_readdata` | weread | `wereadApiKey` | ✅ S-Advisor | 同上 |
| 13 | `weread_book_info` | weread | `wereadApiKey` | ✅ S-Advisor | 同上 |
| 14 | `weread_notebooks` | weread | `wereadApiKey` | ✅ S-Advisor | 同上 |

---

## 2. 注册与绑定架构

**唯一注册入口**：`createLangChainTools(ctx)`（`src/agent/tools/index.ts:44`）。
返回 8 基础 + 1 excalidraw +（条件）search_journal +（条件）5 weread。

**真正的绑定点**只有两处（`bindTools`）：
- `src/agent/graph/subgraphs/plan-execute.ts:104` → `model.bindTools(tools)`
- `src/agent/graph/subgraphs/react-loop.ts:97`（已 @deprecated，仅供 HITL）

而传入的 `tools` 是**各节点硬编码数组过滤后的子集**：

```ts
// advisor.ts：只暴露微信读书 + 日记
const advisorToolNames = ['weread_search','weread_recommend','weread_readdata','weread_notebooks','weread_book_info'];
if (toolContext.visual?.journalDir) advisorToolNames.push('search_journal');
const advisorTools = allTools.filter(t => advisorToolNames.includes(t.name));

// analytical.ts：只暴露检索 + 精读
const s2ToolNames = ['search_book', 'read_book_section'];
const s2Tools = allTools.filter(t => s2ToolNames.includes(t.name));
```

> 注意：L6 文档 §1.4 声称 "excalidraw 由 S2 Analytical 通过 PlanExecute 工具循环调用"，但 `analytical.ts` 的 `s2ToolNames` **不含 excalidraw**——文档与代码矛盾，excalidraw 实际只走 `diagram-helper` 直接调用。

---

## 3. 三种调用机制

| 机制 | 位置 | 说明 |
|------|------|------|
| **A. LLM 工具循环** | `advisor.ts` / `analytical.ts` → `plan-execute.ts` | `model.bindTools(filteredTools)` + PlanExecute。模型自主决定调哪个工具。**仅 6 个工具可达**。 |
| **B. 编排代码直接 `.execute()`** | `diagram-helper.ts`（S1/S3） | 检测到图表意图后，代码直接 `excalidrawTool.execute(...)`，不经过模型工具调用。 |
| **C. 直接 `model.invoke`（无工具 schema）** | `inspectional.ts`、`syntopical.ts`、`pre-search-engine.ts` | 这些节点根本不 `bindTools`；跨书搜索走 `syntopicalSearch` 工具函数，判定走 `fastModel.invoke`。 |

结论：**工具定义是"集中注册、分散过滤、部分直调"**——同一个 `createLangChainTools` 产出的工具，有的被节点过滤后交给 LLM，有的被代码直接调用，有的完全没人用。

---

## 4. 关键发现 / 技术债

### 4.1 🔴 5 个"死工具"（在注册表但无 LLM 调用路径）
`save_memory`、`search_memory`、`update_profile`、`write_note`、`search_read_books` 从未被任何节点 `bindTools`。
- 记忆/画像：经 `profileBuilder.accumulateConversationRound` 等**旁路**写入，不依赖 `save_memory`/`update_profile` 工具。
- 笔记：`write_note` 是否仍被 visualizer/formatter 直接调用需二次确认；但**不在任何 LLM 工具集**。
- 跨书：`search_read_books` 与 S3 Syntopical 内部 `syntopicalSearch` 是**两套并行的跨书检索实现**。
→ 建议：要么让这些工具真的可被调用，要么从 `createLangChainTools` 移除（保留 `.execute` 单例供直接调用），避免"注册了却用不上"的认知负担与 token 浪费。

### 4.2 🔴 `intent-rules.json` 使用 v1 旧名，且未真正生效
- 引用的 `get_document_outline` / `read_markdown_section` / `search_markdown_text` / `analyze_chapter` / `generate_infographic` / `canvas` **全部不在当前注册表**（v2 已重命名为 `search_book`/`read_book_section`，`get_document_outline` 已删除）。
- `IntentRouter.analyze()` 只把 `allowedTools` 拼进一段 `<system_note>` 文本，**不参与** `bindTools` 过滤。真正的过滤在节点层硬编码数组。
- 后果：systemNote 告诉模型"你只能用 [旧名]"，但模型实际被绑定的是新名 → 混淆；且这套路由对工具可用性**零约束**。
→ 建议：要么把 `intent-rules.json` 对齐到现名并真正用于过滤（集中式 `tool-permissions.ts`），要么删除这套软限制，统一以节点层的白名单为准（避免双套互相矛盾）。

### 4.3 🟡 工具白名单分散在 3 处硬编码
`advisor.ts`、`analytical.ts` 各写一份数组；S3 又用自己的 `syntopicalSearch`。新增工具需改多处、易遗漏。
→ 建议：`src/agent/config/tool-permissions.ts` 集中管理（L6 文档 §3.2 已给出方案）。

### 4.4 🟡 工具错误返回格式不统一
- `search_book`/`read_book_section`：`{ status: 'ERROR_xxx', message }`
- `memory`/`profile`/`write_note`/`search_read_books`：`Error: xxx` 字符串
- `search_journal`/weread：`JSON.stringify({ status, message })`
→ 统一为 `{ status:'OK'|'ERROR', code, message, data? }`（L6 §3.1）。

### 4.5 🟡 工具级超时未真正生效
`tool-execution.ts` 有 `TOOL_EXECUTION_TIMEOUT_MS` 常量但未见 `Promise.race` 使用；weread 等网络工具可能拖垮循环。
→ 在 `executeSingleToolCall` 加真实超时（L6 §3.5）。

### 4.6 🟡 两套工具形态并存（v1 `ToolDefinition`+`execute` / v2 LangChain `tool()`）
维护成本高、单测/文档需两套。长期统一到 v2。

---

## 5. 优化建议（优先级）

| 优先级 | 项 | 动作 |
|--------|----|------|
| P0 | 死工具 / 旧名 intent 规则 | 决定 6 个工具的去留；修复或下线 `intent-rules.json` |
| P1 | 白名单集中化 | 新增 `tool-permissions.ts`，节点统一调用 |
| P1 | 错误格式统一 | 统一返回结构 |
| P2 | 工具级超时 + trace span | `executeSingleToolCall` 加超时与 LangSmith span |
| P2 | 文档与代码对齐 | 修订 L6 §1.4（excalidraw 实际调用路径） |

---

## 6. 关键文件索引

| 文件 | 角色 |
|------|------|
| `src/agent/tools/index.ts` | `createLangChainTools()` 唯一注册入口 |
| `src/agent/tools/definitions/*.ts` | 10 个工具的 v2 LangChain 包装 |
| `src/agent/tools/local/*.ts` | `search_book` / `read_book_section` 实现 |
| `src/agent/tools/{memory,profile,write-note,search-read-books,excalidraw}.ts` | 顶层工具实现（v1 形态 + `.execute` 单例） |
| `src/agent/graph/subgraphs/plan-execute.ts` | 真正 `bindTools` 处（PlanExecute） |
| `src/agent/graph/subgraphs/tool-execution.ts` | 工具执行共享层（压缩/循环检测/超时常量） |
| `src/agent/graph/nodes/advisor.ts` | 白名单：`weread_*` + `search_journal` |
| `src/agent/graph/nodes/analytical.ts` | 白名单：`search_book` + `read_book_section` |
| `src/agent/graph/utils/diagram-helper.ts` | 直接调用 `excalidrawTool.execute()`（S1/S3） |
| `src/agent/router/intent-rules.json` | 意图→工具软限制（**旧名，未用于过滤**） |
| `docs/architecture/agent-state-machine/L6-tools.md` | 工具层架构文档（部分已过时） |
