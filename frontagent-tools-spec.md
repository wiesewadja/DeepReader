# 奚童 FrontAgent 工具层 · 具体实施 Spec

> 本 Spec 是 `frontagent-tools-修复方案.md` 的**可执行落地版**：每个任务含精确 file:line、before/after 片段、验收标准、验证命令、回滚方式。
> 决策基线（已在评审中确认）：**D1=A2（摘注册）**、**D2=B2（诚实化下线）**。
> 配套：审计 `frontagent-tools-audit.md`、方案 `frontagent-tools-修复方案.md`。

---

## 0. 计数与架构口径（全 spec 统一使用）

- 注册 14 工具：`search_book`、`read_book_section`、`write_note`、`save_memory`、`search_memory`、`update_profile`、`search_read_books`、`excalidraw`（基础 8）+ `search_journal`（条件）+ `weread_*`×5。
- **LLM 工具循环可调用 8 个**：advisor 放行 `weread_*`×5 + `search_journal`（6），analytical 放行 `search_book`+`read_book_section`（2）。
- `excalidraw` 1 个走直调（`diagram-helper.ts`），不计入 LLM 循环。
- **死工具 5 个**：`write_note`/`save_memory`/`search_memory`/`update_profile`/`search_read_books`——注册但无节点 `bindTools` 暴露。
- `bindTools` 全仓唯一位于 `src/agent/graph/subgraphs/plan-execute.ts:104`；`advisor.ts`/`analytical.ts` 是**硬编码 filter 白名单**，过滤结果经 config 传入。
- `intent-rules.json` 的 `allowedTools`/`systemNote` 对模型**惰性**（图节点自构消息，从不读 `state.systemNote`；`buildMessages` 无活跃调用方）。

---

## 1. P0 — 正确性（必修，零/低风险）

### P0-1 · 摘掉 5 个死工具注册 〔D1=A2〕

**文件**：`src/agent/tools/index.ts`
**目标**：从 `createLangChainTools` 移除 5 个死工具的 `create*Tool(ctx)` 调用及对应 import；保留 `definitions/*.ts` 定义文件不删（可逆）。

**改动 A — 删除 import（原行 8、9、13、21）**

`before`（index.ts:7-21 片段）：
```ts
import { createExcalidrawTool } from './definitions/excalidraw.js';
import { createSaveMemoryTool, createSearchMemoryTool } from './definitions/memory.js';
import { createUpdateProfileTool } from './definitions/profile.js';
import { createReadBookSectionTool } from './definitions/read-section.js';
import { createSearchBookTool } from './definitions/search-book.js';
import { createSearchJournalTool } from './definitions/search-journal.js';
import { createSearchReadBooksTool } from './definitions/search-read-books.js';
import { createWereadSearchTool, /* ... */ } from './definitions/weread-tools.js';
import { createWriteNoteTool } from './definitions/write-note.js';
```
`after`：删除第 8、9、13、21 行四句 import，其余保留。

**改动 B — 删除注册数组条目（原行 48-52）**

`before`（index.ts:45-54）：
```ts
const tools: StructuredToolInterface[] = [
  createSearchBookTool(ctx),
  createReadBookSectionTool(ctx),
  createWriteNoteTool(ctx),          // ← 删
  createSaveMemoryTool(ctx),         // ← 删
  createSearchMemoryTool(ctx),       // ← 删
  createUpdateProfileTool(ctx),      // ← 删
  createSearchReadBooksTool(ctx),    // ← 删
  createExcalidrawTool(ctx),
];
```
`after`：
```ts
const tools: StructuredToolInterface[] = [
  createSearchBookTool(ctx),
  createReadBookSectionTool(ctx),
  createExcalidrawTool(ctx),
];
```

**验收标准**
1. `createLangChainTools` 返回数组最多 9 个（`search_book`/`read_book_section`/`excalidraw` + 条件 `search_journal` + `weread_*`×5），且**不含** `write_note`/`save_memory`/`search_memory`/`update_profile`/`search_read_books` 任一。
2. `definitions/write-note.ts`、`definitions/memory.ts`、`definitions/profile.ts`、`definitions/search-read-books.ts` 文件仍存在、未改动。
3. `tsc` 通过（无悬空 import）；`npm run build` 通过。
4. 跨书检索/记忆/画像/笔记能力不受影响——它们由 `syntopicalSearch()`、`profileBuilder`、memory service、note writer 旁路提供，本改动只摘注册。

**验证命令**
```bash
npx vitest run src/agent/tools
# 若有用例断言工具数 == 14，需同步更新为 9（先 grep：`grep -rn "createLangChainTools" src --include=*.ts | grep -i test`）
node scripts/smoke/smoke.mjs --only S-22,S-23
```

**回滚**：`git checkout src/agent/tools/index.ts`（纯注册改动，无状态/数据影响）。

---

### P0-2 · `intent-rules.json` 诚实化 〔D2=B2〕

**文件**：`src/agent/router/intent-rules.json` + `src/agent/router/intent-router.ts` + `src/agent/router/types.ts`
**目标**：删除 json 中各 rule 的 `tools[]` 与顶层 `tool_aliases`（v1 名无法 1:1 映射到 v2），保留 `intent`/`pattern`/`priority`/`maxIterations`/`comment` 用于真实路由；router 对缺失 `tools` 容错；`systemNote` 在工具集为空时不再输出「仅允许使用 []」的强约束文本。

**改动 A — intent-rules.json**

`before`：每个 rule 含 `"tools": [...]`；顶层含 `"tool_aliases": {...}`；`fallback` 含 `"tools": [...]"`。
`after`（要点）：
- 删除 5 个 rule 的 `tools` 字段。
- 删除顶层 `tool_aliases`。
- 删除 `fallback.tools`。
- 顶层新增 `_note`：`"本文件仅做意图路由（intent/maxIterations）；工具门禁由各认知节点硬编码白名单控制（见 src/agent/tools/tool-permissions.ts，P1-1）。tools/tool_aliases 已移除，IntentRouter 对缺失 tools 容错。"`
- `rules[].pattern` / `intent` / `priority` / `maxIterations` / `comment`、`fallback.intent` / `fallback.maxIterations` / `fallback.comment` 全部保留。

**改动 B — types.ts（让可选字段通过 TS）**

`before`（types.ts:12, 36）：
```ts
export interface IntentRule {
  ...
  tools: string[];        // 允许的工具列表
  ...
}
export interface IntentRulesConfig {
  ...
  fallback: {
    intent: string;
    tools: string[];
    maxIterations?: number;
  };
  tool_aliases?: Record<string, string>;
}
```
`after`：
```ts
export interface IntentRule {
  ...
  tools?: string[];       // 可选：工具门禁已移至节点白名单（P1-1），本文件不再约束
  ...
}
export interface IntentRulesConfig {
  ...
  fallback: {
    intent: string;
    tools?: string[];     // 可选
    maxIterations?: number;
  };
  // tool_aliases 已移除
}
```

**改动 C — intent-router.ts（⚠️ 必改项，否则删 tools[] 后 router 直接崩溃）**

`before`（:23, :60, :74, buildSystemNote :110-116）：
```ts
this.fallbackTools = cfg.fallback.tools;                                  // :23
...
rule.tools.forEach(t => allowedTools.add(t));                            // :60
...
this.fallbackTools.forEach(t => allowedTools.add(t));                    // :74
...
private buildSystemNote(intents: string[], tools: Set<string>): string {
  return `<system_note>
【Router 强制路由】
系统已判定用户意图包含：${intents.join('、')}。
你当前仅被允许使用以下工具：[${Array.from(tools).join(', ')}]。
严禁使用其他未列出的工具。
</system_note>`;
}
```
`after`：
```ts
this.fallbackTools = cfg.fallback.tools ?? [];                           // :23 容错
...
rule.tools?.forEach(t => allowedTools.add(t));                          // :60 ⚠️ 可选链（关键）
...
this.fallbackTools?.forEach(t => allowedTools.add(t));                  // :74 容错
...
private buildSystemNote(intents: string[], tools: Set<string>): string {
  if (tools.size === 0) return '';   // 工具集为空（诚实化后常态）→ 不输出强约束，避免误导模型
  return `<system_note>
【Router 强制路由】
系统已判定用户意图包含：${intents.join('、')}。
你当前仅被允许使用以下工具：[${Array.from(tools).join(', ')}]。
严禁使用其他未列出的工具。
</system_note>`;
}
```

**改动 D — 新增 `intent-router.test.ts`（固化「诚实化」语义，防回归）**

`src/agent/router/__tests__/intent-router.test.ts`（现状无测试，新建）：
```ts
import { describe, it, expect } from 'vitest';
import { IntentRouter } from '../intent-router.js';
import intentRules from '../intent-rules.json' with { type: 'json' };

const router = new IntentRouter(intentRules as any);

describe('IntentRouter.analyze（诚实化后）', () => {
  it('命中规则返回 detectedIntents 与 maxIterations', () => {
    const r = router.analyze('总结一下这本书的核心观点');
    expect(Array.isArray(r.detectedIntents)).toBe(true);
    expect(r.detectedIntents.length).toBeGreaterThan(0);
    expect(typeof r.maxIterations).toBe('number');
  });

  it('allowedTools 为空数组（工具门禁已移至节点白名单，json 不再声明 tools）', () => {
    const r = router.analyze('帮我查一下微信读书里的书');
    expect(r.allowedTools).toEqual([]);
  });

  it('systemNote 为空串（工具集为空时不输出强约束文本，避免误导模型）', () => {
    const r = router.analyze('随便聊聊');
    expect(r.systemNote).toBe('');
  });

  it('json 无 tools/tool_aliases 后 analyze 不抛 Cannot read property forEach of undefined', () => {
    expect(() => router.analyze('test')).not.toThrow();
  });
});
```
> 说明：json import 语法按项目 TS 配置调整（若 `with { type: 'json' }` 不被支持，改用 `import intentRules from '../intent-rules.json'` + `resolveJsonModule`）。4 个 case 固化「诚实化」语义——未来若有人重新给 json 加 `tools[]`，`allowedTools` 非空会让此测试失败，惰性回归可被捕获。

**验证**：`npx vitest run src/agent/router`（覆盖改动 B/C/D）。

**验收标准**
1. `IntentRouter.analyze('总结一下这本书')` 仍正确返回 `detectedIntents`（如 `['检视阅读']`）与 `maxIterations`（如 `2`），`allowedTools` 为空数组、`systemNote` 为空串。
2. 删除 `tools[]` 后 router **不抛** `Cannot read property 'forEach' of undefined`（:60 可选链生效）。
3. json 中不再出现任何 v1 旧名（`get_document_outline`/`read_markdown_section`/`search_markdown_text`/`analyze_chapter`/`generate_infographic`/`canvas`）。
4. `tsc` / `npm run build` 通过。

**验证命令**
```bash
npx vitest run src/agent/router
node scripts/smoke/smoke.mjs --only S-22,S-23
```

**回滚**：`git checkout src/agent/router/`（纯配置+容错，无数据影响）。

---

## 2. P1 — 可维护性（强烈建议）

### P1-1 · 白名单集中化 `tool-permissions.ts`

**新建**：`src/agent/tools/tool-permissions.ts`
```ts
import type { ToolContext } from './types.js';

export type CognitiveNode = 'inspectional' | 'presearch' | 'analytical' | 'syntopical' | 'advisor';

/**
 * 各认知节点允许暴露给 LLM 工具循环的工具白名单——单一事实来源。
 * 替代 advisor.ts / analytical.ts 的硬编码数组（P0 阶段它们控制 bindTools 实际可达集）。
 * 注：excalidraw 由 diagram-helper 在 S1/S3 直调（direct-call-only），不入 LLM 循环。
 */
export const NODE_TOOL_WHITELIST: Record<CognitiveNode, string[]> = {
  advisor: ['weread_search', 'weread_recommend', 'weread_readdata', 'weread_notebooks', 'weread_book_info', 'search_journal'],
  analytical: ['search_book', 'read_book_section'],
  inspectional: [],   // 经 diagram-helper 直调 excalidraw，无 LLM 工具
  presearch: [],
  syntopical: [],     // 跨书检索走 syntopicalSearch() 旁路
};
```

**改**：`advisor.ts`

- **改动 1（替换白名单取值）**：`advisor.ts:113-116` →
```ts
import { NODE_TOOL_WHITELIST } from '../tools/tool-permissions.js';
...
const advisorToolNames = NODE_TOOL_WHITELIST.advisor;
const advisorTools = allTools.filter(t => advisorToolNames.includes(t.name));
```
- **改动 2（⚠️ 显式删除条件 push，勿漏）**：删除 `advisor.ts:117-119` 整块：
```ts
if (toolContext.visual?.journalDir) {
  advisorToolNames.push('search_journal');
}
```
  理由：`search_journal` 已在 `NODE_TOOL_WHITELIST.advisor` 中常驻；当该工具未注册时，`allTools.filter` 自然不会匹配到它，净行为不变。保留此 if 块反而会让 `advisorToolNames` 在 journalDir 缺失时少一项、存在时多一项——与 map 口径冲突，故必须删。

`analytical.ts:96-97` →
```ts
import { NODE_TOOL_WHITELIST } from '../tools/tool-permissions.js';
...
const s2Tools = allTools.filter(t => NODE_TOOL_WHITELIST.analytical.includes(t.name));
```

**验收**：
- `advisorTools` / `s2Tools` 名称集合与 P0 前完全一致（advisor 6 项、analytical 2 项）。
- 全仓硬编码 filter 白名单**仅剩 2 处**：`grep -rn "allTools.filter\|ToolNames = \[" src/agent/graph` 输出应仅含 advisor.ts / analytical.ts 两处（inspectional/presearch/syntopical 节点确认无 `allTools.filter(...)` 调用——`bindTools` 全仓唯一在 `plan-execute.ts:104`，filter 白名单也仅此两处）。
- `grep -rn "advisorToolNames\|s2ToolNames" src` 仅剩引用 map 处。
**验证**：`npx vitest run src/agent/graph/nodes` + `node scripts/smoke/smoke.mjs --only S-22,S-23`

---

### P1-2 · 统一工具错误文案（仅 `formatToolError`）

**改**：`src/agent/tools/types.ts` 新增一个统一错误格式化函数（**只加这一个，不引入结构化返回类型**）：
```ts
/**
 * 统一工具错误文案：所有 definitions/*.ts 的 catch 返回此字符串，避免三套形态
 * （当前混用 throw new Error / return 'error: ...' / return JSON.stringify({success:false})）。
 * 注：LangChain 工具契约是向模型返回 string，故统一为 string 而非结构化对象。
 */
export function formatToolError(code: string, message: string): string {
  return `[TOOL_ERROR:${code}] ${message}`;
}
```
> ⚠️ 经评审，原拟的 `ToolResult<T>` 结构化接口（`{ ok, data?, error? }`）**没有消费方**——LangChain 工具只吃 string，节点层也无 JSON 解析点。若加入即成为本次 spec 要消除的「误导性死类型」之一，故**删除，仅保留 `formatToolError`**。

**改**：各 `src/agent/tools/definitions/*.ts` 的 `catch` 统一改为 `return formatToolError('ERR_XXX', e.message)` 替代三种混用形态。`diagram-helper.ts` 直调 excalidraw 的 `.execute()` 路径同样消费统一文案（或至少不破坏既有返回）。

**验收**：全仓 `definitions/*.ts` 的 catch 分支均经 `formatToolError`；无裸 `throw` 表达工具错误；全仓**不存在** `interface ToolResult` / `type ToolResult` 死类型。
**验证**：`npx vitest run src/agent/tools`

---

### P1-3 · `excalidraw` 直调路径登记

**改**：在 `tool-permissions.ts` 顶部或 `NODE_TOOL_WHITELIST` 旁显式注释 `excalidraw` 为 `direct-call-only`（已由 P1-1 注释覆盖，本条确认不遗漏）。可选：在 `diagram-helper.ts` 顶部注释补一句「excalidraw 仅此处直调，不入 LLM 循环」。

**验收**：审计者再次扫描时不会把 excalidraw 误判为死工具。
**验证**：人工核对 + `npx vitest run src/agent/tools`。

---

## 3. P2 — 技术债（可排期，不阻塞行为正确性）

### P2-1 · 接入 `TOOL_EXECUTION_TIMEOUT_MS`

> ⚠️ 实现方式经评审修正：原「monkey-patch 实例 `.invoke`」有两处风险——(1) LangChain 1.x 的 `invoke` 是多重载签名，给实例属性赋 `(input:any,opts?:any)=>...` 在严格 tsc 下可能不满足重载契约而报错；(2) 若并行执行走 `executeToolBatch` → `Promise.all` 的 batch 路径，实例 patch 可能被绕过。改为**在唯一执行落点 `tool-execution.ts:138` 外层 race**，覆盖单工具与并行批量两条路径，且无 tsc 风险、无需触碰 `bindTools` 形态。

**改 A — `src/agent/graph/subgraphs/tool-execution.ts` 新增模块级 helper**

在文件顶部 import 区把常量并入（原 :13）：
```ts
import { TOOL_EXECUTION_TIMEOUT_MS, MAX_TOOL_RESULT_LENGTH, MAX_FULL_TOOL_MESSAGES } from '../../config/agent-constants.js';
```
在 `executeSingleToolCall` 上方新增（纯函数，不挂在实例上）：
```ts
/**
 * 工具执行超时包裹：在唯一执行落点 race，覆盖单工具与批量（executeToolBatch→Promise.all）两条路径。
 * 超时 reject 会被 executeSingleToolCall 的 try/catch 捕捉，转成 ToolMessage 错误，不会拖垮整轮。
 */
function invokeWithTimeout(
  tool: StructuredToolInterface,
  args: Record<string, unknown>,
  runnableConfig?: RunnableConfig,
): Promise<unknown> {
  const timer = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Tool "${tool.name}" timed out after ${TOOL_EXECUTION_TIMEOUT_MS}ms`)),
      TOOL_EXECUTION_TIMEOUT_MS,
    ),
  );
  return Promise.race([tool.invoke(args, runnableConfig), timer]);
}
```

**改 B — 替换 `executeSingleToolCall` 内调用（原 :138）**
```ts
const rawResult = await tool.invoke(args, runnableConfig);              // before
const rawResult = await invokeWithTimeout(tool, args, runnableConfig);  // after
```

**补单测** — `src/agent/graph/subgraphs/__tests__/tool-execution.test.ts`：
1. 向 `executeSingleToolCall` 注入一个 `invoke` 永远 pending 的假工具，断言在 ~`TOOL_EXECUTION_TIMEOUT_MS` 内其 `msg.content` 含 `timed out`（验证单工具 race 成立、且被 try/catch 转成错误 ToolMessage）。
2. 注入 2 个工具、其一挂死，经 `executeToolBatch` 断言批量按最慢（超时）返回、另一工具结果正常（验证并行路径不被单点拖垮）。

**验收**：
- 单工具挂死时，整轮在 ~60s 内得到 `Error: Tool "..." timed out...` 的 ToolMessage，而非无限挂起。
- 并行批量（`executeToolBatch`）中任一工具挂死，其余工具不受影响、整批按最慢（超时）返回。
- （可选集成验证）走一次真实 PlanExecute 循环注入挂死工具，确认循环被打断并回流错误，而非卡死。

**验证**：`npx vitest run src/agent/graph/subgraphs`。

---

### P2-2 · 归并 v1 实现层到 `definitions/`

**前置检查（必做）**：先 `grep -rn "writeNoteTool\|addMemoryTool\|searchMemoryTool\|saveMemoryTool\|createSaveMemoryTool\|updateProfileTool\|searchReadBooksTool" src test-vault scripts --include=*.ts` 确认 `index.ts:35-38` 的 re-export 在 src 外部（控制台/前端/脚本）无消费者；若有，保留导出别名或迁移调用方后再删。

**改**：`tools/memory.ts`/`profile.ts`/`search-read-books.ts`/`write-note.ts` 是 `definitions/*.ts` 的 v2 包装器复用的**实现层**（如 `definitions/memory.ts` 经 `.execute()` 调 `addMemoryTool`），**非死代码**。将 v1 实现并入对应 `definitions/*.ts`，再删除 v1 文件与 `index.ts:35-38` 的 re-export；保证合并后 v2 包装器行为不变。

**验收**：`grep -rn "from './memory.js'\|from './profile.js'\|from './write-note.js'\|from './search-read-books.js'" src` 无残留；行为测试全绿。
**验证**：`npm run test:run`（此任务跨模块，走全量门）。

---

### P2-3 · 对齐 L6 文档与 diagram-helper 注释

**改**：
- `docs/architecture/agent-state-machine/L6-tools.md` §1.4：「excalidraw 由 S1/S3 经 diagram-helper 直调（`diagram-helper.ts:16` 直接 import v1 实现 `excalidrawTool`）」；补充「死工具/旁路写入」说明。
- `src/agent/graph/utils/diagram-helper.ts:9-10` 注释：现称「`createExcalidrawTool` 仍注册以便 S2 Analytical 调用 excalidraw」，但 analytical 白名单（`['search_book','read_book_section']`）无 excalidraw，矛盾。改为如实说明：excalidraw 仅由本 helper 在 S1/S3 直调；`createExcalidrawTool` 注册对 analytical 无实际效用（P1 后可清理）。

**验收**：文档与代码口径一致；审计不再报此矛盾。
**验证**：人工核对。

---

## 4. 验证总表与定义完成

| 里程碑 | 范围 | 命令 | 定义完成（DoD） |
|--------|------|------|----------------|
| M1 (P0) | tools + router | `npx vitest run src/agent/tools && npx vitest run src/agent/router && node scripts/smoke/smoke.mjs --only S-22,S-23` | 5 死工具已摘、intent-rules 已诚实化、router 容错且不崩、计数口径统一为 8 可调用 |
| M2 (P1) | nodes + types | `npx vitest run src/agent/graph/nodes && npx vitest run src/agent/tools && node scripts/smoke/smoke.mjs --only S-22,S-23` | 白名单集中、错误结构统一、excalidraw 登记 |
| M3 (P2) | 全仓 | `npm run test:run`（仅合并前全量） | 超时接入、v1 归并、文档对齐 |

**红线遵守**：测试分模块执行，不自行 commit/push；业务代码禁静态 import Node 核心模块（本 spec 不涉及）；M1 可独立提交评审，M2/M3 排期。
