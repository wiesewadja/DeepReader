# ToolContext 子上下文分解 — 实现计划

> 基于 SPEC.md v1.1（修正版）| 分 5 个 Phase，16 个任务

## 依赖关系

```
Phase 1 (类型定义) → Phase 2 (ToolContext 重构 + 构造站点) → Phase 3 (工具消费方) → Phase 4 (SharedContext 去重) → Phase 5 (验证)
```

---

## Phase 1: 子上下文类型定义 ✅ 已完成

5 个子上下文文件 + index.ts 已创建，构建通过。

修正：DeepReaderPlugin 接口需从 tools/types.ts 移入 context/vault.ts（消除循环依赖），在 Phase 2 执行。

---

## Phase 2: ToolContext 重构 + 构造站点

**Phase 2 + Phase 3 合并为一个原子提交。**

### T2.1 移动 DeepReaderPlugin + 重构 ToolContext

- **文件**: `src/agent/tools/types.ts`, `src/agent/tools/context/vault.ts`
- **内容**:
  1. 将 `DeepReaderPlugin` 接口从 `tools/types.ts` 移入 `context/vault.ts`
  2. `tools/types.ts` 改为从 `./context/index.js` 导入
  3. ToolContext 从 25 个平铺字段重构为嵌套子上下文容器
  4. 删除 17 个顶层字段 + 死字段 `sessionId`
  5. 保留 8 个图节点专用字段为顶层
- **验收**: ToolContext 顶层字段数 ≤ 14（5 子上下文 + 8 图节点字段 + quotes）

### T2.2 适配正常聊天构造站点

- **文件**: `src/views/sidebar/agent-chat-controller.ts`（约第 337 行，sendMessage 流程）
- **内容**: 平铺字段组装改为嵌套结构
- **验收**: 类型检查通过，所有原字段在子上下文中有对应赋值

### T2.3 适配主动引导构造站点

- **文件**: `src/views/sidebar/agent-chat-controller.ts`（约第 794 行，proactive guidance 流程）
- **内容**: 同 T2.2，更精简（只需 vault + book）
- **验收**: 类型检查通过

### T2.4 适配 FrontendAgent.buildGraphConfigurable

- **文件**: `src/agent/index.ts`
- **内容**:
  - `context.journalDir` → `context.visual?.journalDir`
  - SharedContext 构造中 `context.indexId` → `context.book.indexId`
  - `context.pdfName` → `context.book.pdfName` 等
- **验收**: 编译通过

---

## Phase 3: 工具消费方适配

### T3.1 适配工具注册逻辑

- **文件**: `src/agent/tools/index.ts`
- **路径变更**:
  - `ctx.app` → `ctx.vault?.app`（canvas 条件注册）
  - `ctx.journalDir` → `ctx.visual?.journalDir`（search-journal）
  - `ctx.infographicConfig` → `ctx.visual?.infographicConfig`（generate-infographic）
  - `ctx.plugin?.settings?.wereadApiKey` → `ctx.vault?.plugin?.settings?.wereadApiKey`（weread）

### T3.2 适配 search-book 工具

- **文件**: `src/agent/tools/definitions/search-book.ts`, `src/agent/tools/local/search-text.ts`
- 6 处路径：`ctx.app` → `ctx.vault.app`, `ctx.pdfName` → `ctx.book.pdfName` 等

### T3.3 适配 read-section 工具

- **文件**: `src/agent/tools/definitions/read-section.ts`, `src/agent/tools/local/read-section.ts`
- 3 处路径更新

### T3.4 适配 write-note / memory / profile / search-read-books

- **文件**: 4 个工具文件
- 统一 `ctx.app` → `ctx.vault.app`

### T3.5 适配 canvas / excalidraw

- **文件**: canvas + excalidraw 定义层和底层
- canvas: `ctx.app` → `ctx.vault.app`
- excalidraw: `ctx.pdfName` → `ctx.book.pdfName`

### T3.6 适配 search-journal / generate-infographic

- **文件**: 定义层文件
- `ctx.journalDir` → `ctx.visual?.journalDir`
- `ctx.infographicConfig` → `ctx.visual?.infographicConfig`

### T3.7 适配 weread-tools

- **文件**: `src/agent/tools/definitions/weread-tools.ts`
- `ctx._wereadClient` → `ctx.weread?.wereadClient`（移除下划线前缀）
- 缓存回写：`ctx._wereadClient = client` → `if (ctx.weread) ctx.weread.wereadClient = client`

---

## Phase 4: SharedContext 去重

### T4.1 移除 SharedContext 重复字段

- **文件**: `src/agent/graph/shared-context.ts`
- 移除 8 个重复字段：`indexId`, `pdfName`, `markdownFiles`, `docDescription`, `booklistBookIds`, `crossBookMode`, `bookshelfSummary`, `indexedBooks`
- 图节点消费方改为 `sharedContext.toolContext.book.indexId` 等
- `createSharedContext` 工厂函数参数同步精简

---

## Phase 5: 验证

### T5.1 全量验证

- `npm run build` 零错误
- grep 验证无残留旧路径：`ctx.app`, `ctx.pdfName`, `ctx._wereadClient`
