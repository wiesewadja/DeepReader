# 测试策略：移动端插件加载修复

> 配套规格书：`docs/specs/mobile-plugin-load-fix.md`
> 配套实现方案：`docs/specs/mobile-plugin-load-fix-plan.md`
> Worktree：`feat/mobile-load-support`
> 验证日期：2026-06-22

## 风险评估

- 业务影响：**极高**（插件在移动端完全无法加载 = 移动端功能 100% 不可用）
- 修改范围：13 文件，跨 `pageindex/` + `agent/tools/` + `utils/`
- 依赖：mock（移动端模拟）+ 真实（桌面 Obsidian 运行时）

## 选用策略

- [x] **策略 B：Bugfix（Prove-It）** — 移动端加载崩为已知 bug，先有 mobile-load-trace.mjs 复现 baseline `{node:path, node:fs/promises, child_process}`，修复后验证 baseline 变为空集
- [x] **策略 C：重构（保持行为不变）** — 同时验证桌面端零回归（索引/OCR/搜索/对话全链路）

## 测试层级

| 层级 | 用途 | 新增/修改 |
|------|------|----------|
| 移动端加载模拟（自定义） | 加载期 Node 模块触达集合为空（硬门槛）| 新增 `scripts/smoke/lib/mobile-load-trace.mjs` |
| 单元（Vitest）| `index-tracer.test.ts` mock 路径更新 | 修改 1 个测试 |
| 冒烟（桌面回归）| 11 场景全过 | 无新增 |
| evalObsidian 运行时探针 | 验证搜索路径走 vault adapter | 临时脚本 `/tmp/verify-*.mjs` |

## 执行顺序与结果

### 1. 移动端加载门槛（硬门槛）

| 模式 | 命令 | 期望 | 实际 | 结果 |
|------|------|------|------|------|
| trace（默认）| `node scripts/smoke/lib/mobile-load-trace.mjs` | 加载阶段 Node 模块 = ∅ | `(无)` | ✅ PASS |
| crash | `node scripts/smoke/lib/mobile-load-trace.mjs --crash` | 不再加载即崩 | `✅ PASS` | ✅ PASS |

baseline 曾为 `{node:path, node:fs/promises, child_process}`，现均为空。

### 2. 桌面单元回归

- 命令：`npm run test:run`
- 结果：**1613 passed | 101 skipped | 3 todo**
- 耗时：63.68s
- 状态：✅ 通过（与基线一致）

### 3. 桌面构建

- 命令：`npm run build`
- 结果：tsc 类型检查 + esbuild bundle + CSS bundle **全部通过，无 error/warn**
- 状态：✅ 通过

### 4. 桌面冒烟回归

- 命令：`npm run smoke:core`
- 结果：**11/11 全过**
  - S-RES / S-CMD / S-22 / S-23 / S-25 / S-LD / S-17 / S-24 / S-RP-AN / S-SEC / S-PROMP
- 耗时：11.6s
- 状态：✅ 通过

### 5. 代码审查（静态正确性）

| 审查项 | 结论 | 证据 |
|--------|------|------|
| `nodeFs()` 真惰性 | ✅ | `src/utils/node-fs.ts` 使用 `_fsPromises ??= require("fs/promises")`，模块顶层无 require |
| ocr 动态 import 切断 child_process | ✅ | `src/pageindex/pageindex.ts:291` `const { parsePdfWithOcr } = await import("./parsers/ocr")`；`node.ts` 只 re-export type |
| `paths.ts` 零 node: 顶层 import | ✅ | `import { join } from 'path'`（裸名），grep `from 'node:` 在 paths.ts 无结果 |
| 搜索路径保留 `app` 双轨 | ✅ | `book-search-v2.ts:165/417`、`proposition-search.ts:25/39/179`、`vectors.ts:68/136` 均为 `app ? vaultRead : nodeFs()` |
| 桌面索引链不受影响 | ✅ | `vault/index.ts` / `vectors.ts` 索引构建路径（无 app 分支）改用 `nodeFs()`，运行时调用 |
| D2 无索引降级 | ✅ | `search-text.ts:208-251` 捕获错误关键字 → 标记 → `hits.length === 0` 时 Notice，Agent 继续 |

### 6. 运行时探针（evalObsidian）

| 验证项 | 结果 |
|--------|------|
| 插件加载 | ✅ `app.plugins.plugins['deepreader-dev']` 存在 |
| api 完整暴露 | ✅ 11 keys（PageIndex/indexBook/parsePdf/parseEpub/exportToObsidian...）|
| PageIndex 仍为同步值 | ✅ 采用了 plan 候选 a（ocr 动态 import），未升级到异步工厂 |
| catalog.json vault 可读 | ✅ 1 本书（AI极简经济学）|
| bm25.json vault 可读 | ✅ 移动端也能读到 |
| tree.json vault 可读 | ✅ 移动端也能读到 |

## 退出条件

- [x] 加载门槛：mobile-load-trace.mjs 加载阶段 Node 模块集合为空
- [x] 桌面零回归：test:run 1613 全过 + smoke:core 11/11
- [x] 搜索移动端可用：bm25/tree 通过 vault adapter 可读
- [x] paths.ts 零顶层 Node import
- [x] 桌面索引链行为不变（api.PageIndex 同步形态保留）
- [x] 无新增假阳性

## 预估时间 vs 实际

| 阶段 | 预估 | 实际 |
|------|------|------|
| 移动端加载模拟 | ~5s | ~3s |
| 单元测试 | ~55s | ~64s |
| 构建 | ~30s | ~25s |
| 冒烟 | ~15s | ~12s |
| 代码审查 | ~3min | ~4min |
| 运行时探针 | ~1min | ~1min |
| **总计** | **~6min** | **~7min** |

## 发现的风险/偏差（不阻塞合并）

### 偏差 1：D1 实际为双轨而非单轨

- **spec/plan 表述**：AD4/D1 写"搜索统一 Vault 单轨，删除 fs 绝对路径分支"
- **实际实现**：`book-search-v2.ts`/`proposition-search.ts` 保留 `app ? vaultRead : nodeFs()` 双轨
- **影响评估**：
  - 加载门槛仍达成（nodeFs 惰性，加载期不触达）
  - 桌面端搜索行为与原来完全一致（无 app 时走 nodeFs 读绝对路径）
  - 移动端搜索走 vaultRead 分支，功能正确
- **建议**：合并后更新 spec/plan 表述为"双轨 + 惰性 fs"，或在后续 refactor slice 统一为单轨。**非阻塞**。

### 遗漏 2：`src/pageindex/migration.ts` / `vault/compiler*.ts` 仍用 `node:` 前缀

- **grep 发现**：
  - `src/pageindex/migration.ts:8-9` — `import * as fs from 'node:fs/promises'` + `'node:path'`
  - `src/pageindex/vault/compiler*.ts` — 多个文件 `import ... from "node:fs"`
- **是否阻塞移动端**：**否**
  - `migration.ts` 在 `main.ts:102` 用 `await import('./pageindex/migration.js')` **动态加载**，加载期不触发
  - `index.ts` re-export compiler 的路径**无源码静态 import**（不被 main.ts 加载链拖入）
  - mobile-load-trace.mjs 实测加载阶段 Node 模块为空，证明这些文件不在加载闭包
- **建议**：合并前/后顺手把这些 `node:` 前缀改成裸名（成本低，避免未来 refactor 不慎把它们拖进加载链）。**非阻塞**。

### 遗漏 3：`src/pageindex/parsers/ocr.ts` 仍静态 import child_process

- **grep 发现**：`src/pageindex/parsers/ocr.ts:8` `import { spawn } from "child_process"`
- **是否阻塞**：**否**。`ocr.ts` 只在被 `await import()` 时才加载（pageindex.ts:291），加载期不触达。
- **建议**：无需改动，动态 import 已切断静态链。

## 结论

✅ **可以合并**。所有硬门槛通过，桌面零回归，移动端加载修复有效。

建议合并时一并处理上述 3 个非阻塞清理项（尤其遗漏 2，避免未来踩坑）。
