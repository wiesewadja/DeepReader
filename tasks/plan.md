# 实现计划

## 来源
`SPEC.md` (docs/specs/SPEC-code-quality-improvement.md)

---

## Phase 1: 消除 getVaultPath 重复

### Task 1.1: 替换 src/main.ts 中的 getBasePath
- [ ] 将第 88 行的 `(this.app.vault.adapter as any).getBasePath?.() || (this.app.vault.adapter as any).basePath` 替换为 `getVaultPath(this.app)`
- [ ] 添加 `import { getVaultPath } from '@/utils/mobile-fs'`
- [ ] `npx tsc --noEmit` 无错误

### Task 1.2: 替换 src/views/library-view.ts 中的 5 处 getBasePath
- [ ] 第 846、1307、1433、1453、1785 行全部替换为 `getVaultPath(this.app)`
- [ ] 添加 import
- [ ] 同时替换 `src/ui/pdf-file-selector.ts` 第 192、373 行
- [ ] `npx tsc --noEmit` 无错误

### Task 1.3: 替换 services/ 和 agent/ 中的 getBasePath
- [ ] `src/services/profile-builder.ts` 第 283 行
- [ ] `src/services/journal-search.ts` 第 48 行
- [ ] `src/agent/graph/nodes/syntopical.ts` 第 94 行
- [ ] `src/agent/pi/pi-config.ts` 第 41 行
- [ ] `npm run build` 通过

### Task 1.4: 替换 src/weread/index.ts 中的 basePath
- [ ] 第 49 行 `this.getVaultAdapter().basePath` 替换为 `getVaultPath(this.plugin.app)`
- [ ] `npm run build` 通过
- [ ] `npm run test:run` 通过

---

## Phase 2: Obsidian 私有 API 类型声明

### Task 2.1: 创建 obsidian-internal.d.ts
- [ ] 新建 `src/types/obsidian-internal.d.ts`
- [ ] 声明 `FileSystemAdapter` 的 `getBasePath()` 和 `basePath`
- [ ] 声明 `ExcalidrawAutomate` 接口和 `Window` 扩展
- [ ] `npx tsc --noEmit` 无错误（类型声明不应影响现有代码）

---

## Phase 3a: catch(e: any) → catch(e: unknown)

### Task 3a.1: 替换所有 catch(e: any) 为 catch(e: unknown)
- [ ] `src/main.ts` — 3 处 (600, 644, 673)
- [ ] `src/views/library-view.ts` — 6 处 (1247, 1370, 1394, 1436, 1464, 1487, 1919)
- [ ] `src/settings/sections/weread-section.ts` — 3 处 (149, 172, 362)
- [ ] `src/agent/tools/definitions/weread-tools.ts` — 5 处
- [ ] `src/agent/tools/definitions/search-journal.ts` — 1 处
- [ ] `src/weread/auth/unmatched-modal.ts` — 1 处
- [ ] `src/views/zlibrary-search-modal.ts` — 1 处
- [ ] `src/agent/tools/excalidraw-engine/index.ts` — 1 处
- [ ] 所有 catch 块中访问 `e.message` 改为 `e instanceof Error ? e.message : String(e)`
- [ ] `npm run build` 通过

---

## Phase 3b: Agent 工具参数 app: any 类型化

### Task 3b.1: 定义 ToolAppContext 接口
- [ ] 在 `src/agent/tools/` 下创建或扩展 types 文件，定义 `ToolAppContext`
- [ ] `npm run build` 通过（仅类型定义，不改调用点）

### Task 3b.2: 逐个工具替换 app: any → app: ToolAppContext
- [ ] `src/agent/tools/canvas.ts` — `app: any` → `app: ToolAppContext`
- [ ] `src/agent/tools/write-note.ts` — `app: any` → `app: ToolAppContext`
- [ ] `src/agent/tools/memory.ts` — `_app: any` → `_app: ToolAppContext`
- [ ] `src/agent/tools/profile.ts` — `app: any` → `app: ToolAppContext`
- [ ] `src/agent/tools/excalidraw.ts` — 相关 `as any` 清理
- [ ] `npm run build` 通过

---

## Phase 3c: PageIndex parseResult: any 类型化

### Task 3c.1: 定义 ParseResult 接口
- [ ] 在 `src/pageindex/book-types.ts` 中定义 `ParseResult` 接口
- [ ] 替换 `book-indexer.ts` 中 `parseResult: any` → `parseResult: ParseResult`
- [ ] 替换相关 `node: any` → 具体类型
- [ ] `npm run build` 通过

---

## Phase 4: TTS 日志规范化

### Task 4.1: 替换 src/services/tts/ 下的 console.*
- [ ] `tts-service.ts` — 20 处 `console.*` → `serviceLog.*`
- [ ] `tts-client.ts` — 2 处 → `serviceLog.error`
- [ ] `minimax-tts-client.ts` — 2 处 → `serviceLog.error`
- [ ] 添加 `import { serviceLog } from '@/utils/logger'`

### Task 4.2: 替换其他文件的零散 console.*
- [ ] `src/pageindex/book-indexer.ts` — 5 处 → `apiLog` 或 `serviceLog`
- [ ] `src/pageindex/index-tracer.ts` — 3 处 → `serviceLog`
- [ ] `src/views/library-view.ts:2074` — 1 处 → `uiLog`
- [ ] `src/views/sidebar/book-manager.ts:788` — 1 处 → `uiLog`
- [ ] `src/views/sidebar/sidebar-view.ts` — 2 处 → `uiLog`
- [ ] `npm run build` 通过
- [ ] `npm run test:run` 通过

---

## Phase 5: 提取重复工具函数

### Task 5.1: 创建 src/utils/excalidraw.ts
- [ ] 导出 `getExcalidrawAutomate()` 和 `isExcalidrawAvailable()`
- [ ] 替换 `src/main.ts` 3 处、`src/agent/tools/canvas.ts` 1 处、`src/agent/graph/edges.ts` 1 处
- [ ] `npm run build` 通过

### Task 5.2: 统一 ensureFolderExists 到公共工具
- [ ] 在 `src/utils/vault.ts` 中实现 `ensureFolderExists()`
- [ ] 替换 `src/agent/tools/canvas.ts` 和 `src/agent/tools/write-note.ts` 中的私有版本
- [ ] `npm run build` 通过
- [ ] `npm run test:run` 通过

---

## Phase 6: LibraryView 拆分（建议独立执行）

### Task 6.1: 创建 src/views/library/ 目录结构
- [ ] 创建 `src/views/library/` 目录
- [ ] 提取 `library-cover-loader.ts`（CoverLoader 类）
- [ ] 提取 `library-filter.ts`（FilterManager 类）
- [ ] 提取 `library-weread-bridge.ts`（WereadBridge 类）
- [ ] `npm run build` 通过

### Task 6.2: 继续拆分
- [ ] 提取 `library-index-manager.ts`（IndexManager 类）
- [ ] 提取 `library-multi-select.ts`（MultiSelectManager 类）
- [ ] 提取 `library-file-ops.ts`（FileOps 类）
- [ ] 提取 `library-card-renderer.ts`（CardRenderer 类）
- [ ] 主类 `library-view.ts` 只保留生命周期和事件分发
- [ ] `npm run build` 通过
- [ ] `npm run test:run` 通过
