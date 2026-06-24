# Spec：移动端插件加载修复

## 背景

DeepReader 声明 `manifest.isDesktopOnly: false`，设计上支持移动端。但实际在 Obsidian 移动端（iOS/Android，基于 Capacitor）**加载即崩溃**——弹出 "DeepReader: failed to load" 并自动禁用，连阅读、AI 对话、朗读这些**本不依赖 Node** 的功能也被连坐。

用户需求：移动端只需要 **阅读 + AI 对话 + 朗读**；索引、OCR、PDF/EPUB 解析等重 Node 功能由 PC 端完成，索引数据通过 vault 同步到移动端消费。

## 根因（已用确定性实验复现）

Obsidian 执行 `bin/main.js` 的**加载阶段**（`module.exports` 之前，连 `onload()` 都没进）就 `require` 了 3 个移动端不可用的 Node 模块：

| 模块 | 源头文件 | 加载期触达路径 |
|---|---|---|
| `node:path` | `src/pageindex/paths.ts:14` `import { join } from 'node:path'` | main.ts `setActivePluginId` + agent 搜索链 `PAGEINDEX_DIR` |
| `node:fs/promises` | `book-search-v2.ts`、`proposition-search.ts`、`vault/*`、`index-tracer.ts` 等 | agent 认知引擎静态 import 搜索模块 + main.ts `PageIndex` 链 |
| `child_process` | `src/pageindex/parsers/ocr.ts:8` | main.ts `PageIndex` → `pageindex.ts` → `parsePdfWithOcr` |

**为什么桌面正常、移动端崩**：桌面 Electron 自带完整 Node.js，`node:` 前缀和 `child_process` 都正常；移动端 Capacitor 的 Node polyfill 有两个硬限制——①**不识别 `node:` 前缀**（只匹配裸名 `'path'`/`'fs'`）；②**完全没有 `child_process`**（无法 spawn 进程）。

这三处 require 都在 `main.ts` 顶层静态 import 的传递闭包里，esbuild 把它们编译进加载阶段必执行的代码。实测（把 `node:`/`child_process` 替换为失败模块后加载 `bin/main.js`）：**加载阶段触发 `{path, fs/promises, child_process}`，onload 阶段无新增**。

## 目标

1. **插件在移动端能正常加载**（加载阶段不再触发任何 `node:` 前缀或 `child_process` 的 require）。
2. **移动端三大功能可用**：阅读（ReadingModeService）、AI 对话（FrontendAgent + 搜索）、朗读（TTS）。
3. **搜索能读 PC 同步的索引**：通过 Vault adapter 读取 `.obsidian/plugins/<id>/pageindex/` 下的索引数据。
4. **桌面端零回归**：索引、OCR、解析、迁移等 Node 功能在桌面端行为不变。

## 命令

- 构建：`npm run build`
- 单元测试：`npm run test:run`
- 移动端加载验证：`node scripts/smoke/lib/mobile-load-trace.mjs`（本 spec 新增，见测试策略）
- 冒烟（桌面回归）：`npm run smoke:core`
- 部署：`npm run deploy`

## 受影响模块

- **`src/main.ts`** — 5 个 pageindex 值 import（`PageIndex`、`indexBook`/`isBookIndexed`/`deleteBookIndex`/`generateBookId`/`migrateBookIndexes`、`parseEpub`、`parsePdf`、`exportToObsidian`）改为按需动态 `await import()`；`readonly api` 对象改为 lazy（getter 触发动态 import）。
- **`src/pageindex/paths.ts`** — 删除顶层 `import { join } from 'node:path'`，`join` 改为函数内惰性 `require('path')`（裸名，移动端 polyfill 支持）或纯字符串拼接。**paths.ts 被 agent 搜索链静态 import，必须自身零 Node 顶层依赖。**
- **`src/pageindex/book-search-v2.ts`** — 残留的 `fs.access` / `fs.readFile`（读 bm25/tree 索引）改为 `mobile-fs` 的 `vaultExists` / `vaultRead`（模块已导入 mobile-fs，补全残留 fs 调用）。
- **`src/pageindex/proposition-search.ts`** — 同上，`fs` 调用改 Vault adapter。
- **`scripts/smoke/lib/mobile-load-trace.mjs`**（新增）— 移动端加载模拟脚本，沉淀为可复用验证工具。

## 不受影响（移动端天然可用，无需改动）

- 阅读模式 `src/components/reading-mode/` — 基于 Obsidian 原生 markdown 渲染，onload 阶段 trace 无 Node 依赖。
- 朗读 TTS — Web Speech API，无 Node 依赖。
- `src/utils/mobile-fs.ts` — 已是 Vault adapter 封装，移动端安全。
- `bm25.ts`、`book-resolver.ts`、`embedding-cache.ts` — 经查无 `node:`/`fs`/`child_process` 依赖，纯算法 + Vault API。

## 技术约束

- **不改 esbuild external 配置**：保持 `node:` 模块 external（桌面端需要）。通过源码层避免加载期触达，而非打包层 alias。
- **不新增 npm 依赖**。
- **搜索模块的 Vault 化只改"读索引"路径**：`book-search-v2.ts` 同时有 `fs`（绝对路径，索引构建产物校验）和 `vaultRead`（vault-relative）两条读法——移动端只走 vault-relative 一条，桌面端保留 fs 路径或统一到 vault（需 plan 阶段确认是否统一）。
- 文件路径用 `mobile-fs.ts` 的 `normalizePath`/`joinPath`，不硬编码分隔符。
- 日志用 `utils/logger.ts`。
- TypeScript 严格模式。

## 代码风格

```typescript
// 动态 import 模式：按需加载 Node 依赖模块
async function getIndexBook() {
  const { indexBook } = await import('./pageindex/book-indexer.js');
  return indexBook;
}

// api lazy 化：getter 触发动态 import，避免加载期求值
private _pageIndexCtor?: typeof import('./pageindex/node.js').PageIndex;
private async getPageIndex() {
  if (!this._pageIndexCtor) {
    const mod = await import('./pageindex/node.js');
    this._pageIndexCtor = mod.PageIndex;
  }
  return this._pageIndexCtor;
}

// paths.ts：join 改惰性裸名 require（移动端 polyfill 支持裸名）
function joinPath(a: string, b: string): string {
  const { join } = require('path') as typeof import('path');
  return join(a, b);
}
```

## 测试策略

- **测试层级**：移动端加载模拟（新增脚本）/ 单元（Vitest）/ 冒烟（桌面回归）
- **移动端加载模拟脚本** `scripts/smoke/lib/mobile-load-trace.mjs`：
  - 预处理 `bin/main.js`，把 `require("node:xxx")` → 失败模块、`require("child_process")` → 失败模块
  - Proxy mock obsidian + 真实空 adapter（`getVaultPath` 返回 `''`）
  - 断言：**加载阶段触发的 Node 模块集合为空**（即 `{path, fs/promises, child_process}` ∩ 加载期 = ∅）
  - 这是验收的硬门槛
- **桌面端回归**：`npm run smoke:core`（core 11 场景，含索引、对话、搜索不破坏）；`npm run test:run`
- 不依赖外部 API（mock LLM）。

## 边界

**Always（必须做）**
- 每个改动 slice 做完跑 `mobile-load-trace.mjs` 确认加载期 Node 依赖不回升。
- 提交前 `npm run build` + `npm run test:run` + `npm run smoke:core` 全绿。
- 动态 import 路径加 JSDoc 说明"Node 依赖，移动端惰性"。
- `paths.ts` 改动后确认 87 个 `PAGEINDEX_DIR` 调用点不受影响（Proxy 语义不变）。

**Ask First（先问用户）**
- `embedding-cache.ts` 移动端加载嵌入向量的方式（当前无 node: 依赖，但需确认读取路径在移动端可达）。

**Never（禁止）**
- 改 esbuild external / alias 配置绕过（必须源码层解决）。
- 删除桌面端 Node 功能（只做移动端惰性/跳过，不删功能）。
- 在 `paths.ts` 顶层保留任何 `node:` 静态 import。
- 提交 `bin/` 构建产物到 git。
- console.log 替代 logger。

## 验收标准

1. **加载门槛**：`mobile-load-trace.mjs` 显示加载阶段触发的 Node 模块集合为空（当前为 `{path, fs/promises, child_process}`）。
2. **移动端 onload 可达**：模拟脚本中 `onload()` 能执行到末尾（不再因 Node require 中断）。
3. **桌面零回归**：`npm run smoke:core` 11 场景全过；`npm run test:run` 全过。
4. **搜索移动端可用**：`book-search-v2`/`proposition-search` 在移动端通过 Vault adapter 读到 PC 同步的索引（trace 驱动 + 单元测试覆盖 vaultRead 路径）。
5. **paths.ts 零顶层 Node import**：`grep "from 'node:" src/pageindex/paths.ts` 无结果。
6. **桌面端索引链不变**：动态 import 化后，桌面端 `new PageIndex()` / `indexBook()` 行为与改造前一致（冒烟覆盖）。
7. **真机加载验证（待补）**：`mobile-load-trace.mjs` 是"快速回归门槛"，仅证明加载阶段无 `node:` 前缀 + `child_process` 触达；**不证明裸名 `path`/`crypto`/`fs` 在真机 Capacitor polyfill 一定可用**（这是 Obsidian 外部承诺，非稳定契约，见 obsidian-typst #38）。合并后需在 iOS/Android 真机或 Obsidian 移动模拟器实测一次插件加载，把结果补进本节。

## 决策记录（用户已确认）

- **D1（fs/Vault 策略）**：搜索模块保留**双轨**（`app ? vaultRead : nodeFs()`）——移动端（Obsidian 有 app）走 Vault adapter，桌面 CLI/脚本（无 app，vaultPath 模式）走惰性 `nodeFs()`。`book-search-v2.ts`/`proposition-search.ts`/`vectors.ts` 的 `fs` 分支改惰性 `nodeFs()`（加载期不触发 fs/promises），`app` 分支（vaultRead）不变。功能上等价于"移动端统一走 Vault"（D1 目标），同时不破坏桌面 CLI 的 vaultPath 模式（原 spec 写"单轨"，实现中为避免破坏 CLI 保留双轨，已据实修正）。
- **D2（无索引降级 UX）**：移动端对未同步索引的书对话时，**Notice 提示「该书索引未同步，请在桌面端建立」+ Agent 继续对话**（基于通用知识 + 已加载文档），不阻断。

## 待 plan 阶段 trace 确认的问题

1. **`node:fs/promises` 残余源头**：trace 显示加载期有 fs/promises，已定位 `book-search-v2`/`proposition-search`（搜索链）+ 索引构建链。是否还有其他静态链？（plan/implement 阶段 trace 驱动逐一确认。）
2. **`embedding-cache.ts` 移动端可达性**：当前无 node: 依赖，但需确认其读取嵌入向量的路径在移动端通过 Vault adapter 可达。
3. **`FrontendAgent` 延迟初始化边界**：当前"首次聊天时按需加载"。确认改造后这条延迟链不被破坏（main.ts 改动态 import 时不波及 agent 入口）。

## 实施顺序（概要，详细拆解见 plan）

1. `paths.ts` 去 `node:path`（最高优先，阻断加载期 path；影响面最大但改动最小）。
2. `main.ts` 5 个 pageindex 值 import → 动态 + `api` lazy（切断 ocr/child_process + 索引构建 fs 链）。
3. 搜索模块 `book-search-v2`/`proposition-search` fs → Vault adapter（让搜索移动端可用）。
4. 沉淀 `mobile-load-trace.mjs` + 桌面回归。
