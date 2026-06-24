# 实现方案：移动端插件加载修复

> 配套规格书：`docs/specs/mobile-plugin-load-fix.md`
> Worktree：`feat/mobile-load-support`

## 概览

让 DeepReader 在 Obsidian 移动端（Capacitor）能正常加载，并保留阅读/AI 对话/朗读三大功能。通过 trace 驱动逐步消除加载阶段的 `node:path` / `node:fs/promises` / `child_process` 依赖，搜索改为 Vault adapter 单轨以支持移动端读 PC 同步索引。

## 架构决策

- **AD1：源码层规避，不改 esbuild external/alias。** 桌面端仍需完整 Node，保持 `node:` 模块 external；通过把 Node 依赖模块的加载推迟到运行时（动态 import / 惰性 require）来避免加载期触达。
- **AD2：trace 驱动渐进验证。** 每个 slice 完成后跑 `mobile-load-trace.mjs`，确认加载阶段 Node 模块集合单调递减。不靠静态推理，靠运行时实测。
- **AD3：切断点优先选最小改动。** 切断 `main.ts → pageindex` 静态链时，优先评估"仅将 ocr 改为 pageindex 内动态 import"是否足以消除 `child_process`，避免直接重写 `api` 对象形态（`PageIndex` 异步工厂会波及 E2E）。trace 实测决定切断点。
- **AD4：搜索统一 Vault 单轨（D1）。** `book-search-v2`/`proposition-search` 删除 `fs` 绝对路径分支，桌面/移动同走 `vaultRead`/`vaultExists`。
- **AD5：paths.ts 零顶层 Node import。** `join` 改惰性 `require('path')`（裸名，移动端 polyfill 支持），不影响 `PAGEINDEX_DIR` Proxy 语义。

## 任务列表

### 阶段 1：验证地基

#### 任务 1：沉淀移动端加载模拟脚本 + 记录 baseline [S]
**描述：** 把诊断阶段的移动端加载模拟逻辑沉淀为 `scripts/smoke/lib/mobile-load-trace.mjs`，作为后续每个 slice 的验证门槛。预处理 `bin/main.js`（`require("node:xxx")`→失败模块、`require("child_process")`→失败模块），Proxy mock obsidian + 真实空 adapter，输出加载阶段/onload 阶段触发的 Node 模块集合。

**验收条件：**
- [ ] `node scripts/smoke/lib/mobile-load-trace.mjs` 可独立运行
- [ ] 输出当前 baseline：加载阶段 = `{path, fs/promises, child_process}`，onload 阶段 = `{}`（getVaultPath 守卫跳过迁移）
- [ ] 加载失败时清晰打印第一个 `Cannot find module` 错误

**验证方法：**
- [ ] `node scripts/smoke/lib/mobile-load-trace.mjs` 输出 baseline
- [ ] 脚本不依赖 obsidian 运行时（纯 Node + mock）

**依赖：** 无（先于所有修复任务）

**涉及文件：**
- `scripts/smoke/lib/mobile-load-trace.mjs`（新增）

---

### 阶段 2：加载门槛修复（3 个 slice，trace 单调递减）

#### 任务 2：paths.ts 去 node:path 顶层 import [XS]
**描述：** 删除 `src/pageindex/paths.ts:14` 的 `import { join } from 'node:path'`，把 `join` 调用改为使用处惰性 `require('path')`（裸名）或纯字符串拼接。paths.ts 被 main.ts `setActivePluginId` 和 agent 搜索链 `PAGEINDEX_DIR` 静态 import，是加载期 `node:path` 的唯一来源。

**验收条件：**
- [ ] `grep "from 'node:" src/pageindex/paths.ts` 无结果
- [ ] `PAGEINDEX_DIR` Proxy 语义不变（toString/valueOf/Symbol.toPrimitive 行为不变）
- [ ] `mobile-load-trace.mjs` 加载阶段不再含 `path`
- [ ] 桌面端 `pageindexPaths/getPageindexRoot/getBookDir` 等函数行为不变

**验证方法：**
- [ ] `npm run build`
- [ ] `node scripts/smoke/lib/mobile-load-trace.mjs`（path 消失）
- [ ] `npm run test:run`（paths 相关单元测试通过）

**依赖：** 任务 1

**涉及文件：**
- `src/pageindex/paths.ts`

---

#### 任务 3：切断 main.ts → pageindex 静态链（消除 child_process + 索引 fs）[M]
**描述：** 让 `child_process`（ocr）和索引构建的 `node:fs/promises` 不在加载期被触达。按 AD3，先用 trace 实测确定最小切断点：
- **候选 a（最小）**：在 `pageindex.ts`/`node.ts` 内把 `ocr` 的静态 import 改为 OCR 解析时动态 `await import()`——`main.ts` 顶层 import 不动，`api` 形态不变。
- **候选 b（spec 原方案）**：`main.ts` 5 个 pageindex 值 import 改动态 + `api` lazy（`PageIndex` 改异步工厂，E2E 适配）。

trace 实测：若候选 a 能让加载阶段 `child_process` 消失且 `fs/promises` 仅剩搜索链（任务 4 处理），则采用 a；否则升级到 b。`migrateBookIndexes`（迁移块内）无论哪个候选都改动态 import。

**验收条件：**
- [ ] `mobile-load-trace.mjs` 加载阶段不再含 `child_process`
- [ ] 桌面端 `new PageIndex()` / `indexBook()` / 索引流程行为不变
- [ ] 若采用候选 b：`api.PageIndex` 改异步工厂后，E2E 暴露的 API 适配完成
- [ ] `migrateBookIndexes` 改为迁移块内 `await import()`（移动端 getVaultPath='' 已跳过，此处仅为消除顶层 import）

**验证方法：**
- [ ] `npm run build`
- [ ] `node scripts/smoke/lib/mobile-load-trace.mjs`（child_process 消失）
- [ ] `npm run test:run`
- [ ] 手动：桌面端触发一次索引/OCR 流程确认正常

**依赖：** 任务 2

**涉及文件：**
- `src/main.ts`
- `src/pageindex/pageindex.ts` / `node.ts`（候选 a）或 `src/main.ts` api（候选 b）

---

#### 任务 4：搜索模块 fs → Vault adapter 单轨（D1）[M]
**描述：** `book-search-v2.ts` 和 `proposition-search.ts` 残留的 `fs.access`/`fs.readFile`（读 bm25/tree 索引，绝对路径）统一改为 `mobile-fs` 的 `vaultExists`/`vaultRead`（vault-relative）。删除 `import * as fs from "fs/promises"`。这是加载期 `node:fs/promises` 的搜索链来源（被 agent 认知引擎静态 import）。

**验收条件：**
- [ ] `grep "from \"fs/promises\"\|from 'fs/promises'" src/pageindex/book-search-v2.ts src/pageindex/proposition-search.ts` 无结果
- [ ] `mobile-load-trace.mjs` 加载阶段不再含 `fs/promises`
- [ ] 桌面端搜索结果与改造前一致（bm25 + tree 读取正确）
- [ ] 移动端模拟：搜索路径无 Node 依赖触达

**验证方法：**
- [ ] `npm run build`
- [ ] `node scripts/smoke/lib/mobile-load-trace.mjs`（fs/promises 消失）
- [ ] `npm run test:run`（搜索相关单元测试）
- [ ] `npm run smoke:core`（含搜索场景）

**依赖：** 任务 3

**涉及文件：**
- `src/pageindex/book-search-v2.ts`
- `src/pageindex/proposition-search.ts`

---

### 🔶 检查点：加载门槛达成
- [ ] `mobile-load-trace.mjs` 加载阶段 Node 模块触达集合为 **空**
- [ ] `npm run build` + `npm run test:run` 通过
- [ ] 向用户确认后再进入阶段 3

---

### 阶段 3：移动端功能可用

#### 任务 5：无索引降级 UX（D2）[S]
**描述：** 移动端（及桌面端）对未同步索引的书对话时，搜索工具读不到索引 → `Notice` 提示「该书索引未同步，请在桌面端建立」+ Agent 继续基于通用知识/已加载文档对话。降级点在搜索工具（`search-text`/`book-search-v2`）的索引读取失败分支。

**验收条件：**
- [ ] 索引不存在时弹一次 `Notice`（不重复弹）
- [ ] 搜索工具返回空结果 + 明确的"无索引"信号，Agent 不中断对话
- [ ] 索引存在时行为不变（无 Notice）

**验证方法：**
- [ ] `npm run build`
- [ ] `npm run test:run`
- [ ] 手动/轻量 E2E：对未索引书发起对话，确认 Notice + Agent 继续

**依赖：** 任务 4

**涉及文件：**
- `src/agent/tools/local/search-text.ts`（或 `book-search-v2.ts` 读取失败分支）

---

#### 任务 6：embedding-cache 移动端可达性确认 [S]
**描述：** trace 确认 `embedding-cache.ts`（已无 node: 依赖）在移动端通过 Vault adapter 可达嵌入向量文件。若读取路径仍是绝对路径/fs，补 vault 化；若已 vault-relative 则仅记录确认。

**验收条件：**
- [ ] embedding-cache 读取嵌入向量在移动端可达（Vault adapter 路径）
- [ ] `mobile-load-trace.mjs` 无新增 Node 依赖
- [ ] 对话搜索移动端路径 trace 干净

**验证方法：**
- [ ] `node scripts/smoke/lib/mobile-load-trace.mjs`
- [ ] 代码审查 embedding-cache 读取路径

**依赖：** 任务 4

**涉及文件：**
- `src/pageindex/vault/embedding-cache.ts`（如需）

---

### 🔶 检查点：移动端功能可用
- [ ] 移动端模拟 `onload()` 可执行到末尾
- [ ] 对话搜索路径在移动端 trace 无 Node 依赖
- [ ] 阅读/朗读路径确认无 Node 依赖

---

### 阶段 4：回归收尾

#### 任务 7：桌面端全量回归 [S]
**描述：** 确认桌面端零回归：索引构建、OCR、PDF/EPUB 解析、迁移、对话、搜索、阅读、朗读全部正常。

**验收条件：**
- [ ] `npm run smoke:core` 11 场景全过
- [ ] `npm run test:run` 全过
- [ ] 手动验证：桌面端索引一本新书 + OCR + 对话搜索 全链路正常
- [ ] `npm run build` 无 TS 报错

**验证方法：**
- [ ] `npm run build && npm run test:run && npm run smoke:core`
- [ ] 交付测试工程师代理（deepreader-test-engineer）做最终验证

**依赖：** 任务 5、6

**涉及文件：**
- 无（验证任务）

---

## 风险与应对

| 风险 | 影响 | 应对策略 |
|---|---|---|
| `api.PageIndex` 改异步工厂波及 E2E | 高 | AD3：优先候选 a（ocr 动态化），避免改 api 形态；仅在必要时升级到候选 b |
| 搜索 vault 化影响桌面搜索正确性/性能 | 中 | smoke:core 搜索场景 + 单元测试覆盖 bm25/tree 读取；vaultRead 与原 fs.readFile 行为对齐 |
| `PAGEINDEX_DIR` Proxy 在 paths.ts 改动后语义漂移 | 中 | 改动隔离在 join 相关函数，不动 Proxy 定义；87 调用点靠 test:run 回归 |
| node:fs/promises 有未发现的静态链 | 中 | trace 驱动，加载门槛检查点未达成不进入阶段 3；必要时增加 slice |
| `FrontendAgent` 延迟初始化链被破坏 | 中 | 任务 3 改 main.ts 动态 import 时不触及 agent 入口；onload 检查点验证首次对话可用 |

## 待确认问题
- 任务 3 的切断点（候选 a vs b）由 trace 实测决定，若选 b 需确认 E2E api 适配方案。
