# 删除阅读进度 + 新增书籍归档

> 版本：2025.06 | 状态：DRAFT | 作者：Reasonix Code（grilling 产出）

---

## 1. 目标

**动机**：现有阅读进度功能（章节标记已读、进度百分比、MOC frontmatter 同步）使用率低，却引入了大量代码和 I/O 开销。改为书籍软归档功能，让用户可以将读完的书从书库主视图中隐藏，保留干净的书架体验。

**阶段性实施**：
- **Phase 1**：删除全部 6 层阅读进度相关代码（纯减法）
- **Phase 2**：新增书籍归档功能（纯加法）

两阶段互不依赖，可独立验证。

---

## 2. Phase 1 — 删除阅读进度

### 2.1 删除范围（6 层）

| # | 层 | 操作 |
|---|------|------|
| 1 | **核心数据模型** `src/pageindex/reading-progress.ts` | 删除文件 |
| 2 | **运行时追踪器** `src/views/sidebar/reading-progress-tracker.ts` | 删除文件 |
| 3 | **单元测试** `tests/unit/pageindex/reading-progress.test.ts` | 删除文件 |
| 4 | **书库进度条** `src/views/library-view.ts` + `.css` | 删除相关代码 |
| 5 | **微信读书进度展示** `src/agent/tools/definitions/weread-tools.ts` | 删除进度字段输出 |
| 6 | **Agent 拟人化进度 UI + 里程碑** | 删除相关代码 |

### 2.2 逐文件修改清单

#### 删除文件

| 文件 | 原因 |
|------|------|
| `src/pageindex/reading-progress.ts` | 核心数据模型 + `loadProgress/saveProgress` I/O |
| `src/views/sidebar/reading-progress-tracker.ts` | 追踪器，~230 行 |
| `tests/unit/pageindex/reading-progress.test.ts` | 全部单元测试 |
| `src/agent/memory/milestones.ts` | 阅读里程碑记录器 |

#### 修改文件

| 文件 | 变更 |
|------|------|
| `src/views/library-view.ts` | 删 `readingProgressCache`、`loadReadingProgresses()`、`createBookCard()` 中的进度条 DOM 渲染、进度 CSS class 注入、引用 `reading-progress.css` 的语句 |
| `src/views/library-view.css` | 删 `.deeppdf-lib-reading-progress`、`.deeppdf-lib-reading-bar-bg`、`.deeppdf-lib-reading-bar-fill`、`.deeppdf-lib-reading-bar-text` 及其所有相关样式 |
| `src/views/sidebar/sidebar-view.ts` | 删 `import ReadingProgressTracker`；删 `progressTracker` 属性声明、构造、`host` 接口中的 `readingProgress/initReadingProgress/navigateToLastReadChapter/flushProgressSave`；删 `active-leaf-change` 中的 `trackReadingProgress()` 调用；`notifyHighlight()` 从 frontmatter 取 `node_id` 替代 `progressTracker.currentChapterId`；删 `getTotalChapters()` 方法；删 `flushProgressSave()` 调用 |
| `src/views/sidebar/book-manager.ts` | 删 `initReadingProgress()`、`navigateToLastReadChapter()`、`flushProgressSave()` 调用点 |
| `src/agent/ui/humanized-adapter.ts` | 删 `generateReadingSteps()` 函数 |
| `src/agent/ui/humanized-types.ts` | 删 `ReadingProgressItem` 接口、`TOOL_TO_ACTION` 映射中进度相关条目、`HumanizedProgress.readingSteps` 字段 |
| `src/agent/tools/definitions/weread-tools.ts` | 删工具输出中 `item.readingProgress` 展示 |
| `src/agent/memory/store.ts` | 删 milestones 的 import 和引用 |

### 2.3 不修改的内容

- `BookManagerHost` 接口定义本身（删调用点后接口方法若无人引用再清理）
- `CatalogMeta` / `CatalogBookEntry` 类型（Phase 2 才改）
- `IndexListItem` 接口（`progress_percent` 保留——它被索引过程使用，非阅读进度）

### 2.4 验收条件

- [ ] `npm run build` 通过，无 `reading-progress`、`progressTracker`、`ReadingProgressTracker`、`MilestoneRecorder` 引用残留
- [ ] 书库视图卡片不再显示进度条
- [ ] Agent 回答中不再展示进度步骤
- [ ] 侧边栏不再追踪文件切换事件
- [ ] HISTORY.md 不再写入 📖/🔄 里程碑

---

## 3. Phase 2 — 新增书籍归档

### 3.1 归档模型

**软归档**——给书籍标记一个 `archived: boolean` 字段，不移动文件、不删除索引。

| 字段位置 | 类型 | 说明 |
|---------|------|------|
| `CatalogBookEntry.archived` | `?: boolean` | 可选字段，缺失 = `false`（向后兼容） |

### 3.2 数据流

```
用户点击归档
    ↓
src/pageindex/archive.ts  toggleArchive(vaultPath, bookId)
    ↓
读取 catalog.json → 翻转 archived 字段 → 写回 catalog.json
    ↓
LibraryView 重新加载 CatalogMeta → 更新 archivedBookIds: Set<string>
    ↓
renderGrid() 根据 showArchived 状态过滤渲染
```

**关键设计**：
- `CatalogMeta.version` 不升级，`archived?: boolean` 可选字段，旧数据 `?? false` 自动兼容
- LibraryView 自己加载 `CatalogMeta`，不污染 `IndexListItem` 接口
- `BookManager.deleteIndex()` 同步从 Catalog 清理已归档标记（已有 `removeFromCatalog()`）

### 3.3 新增文件

| 文件 | 导出 | 行数估算 |
|------|------|---------|
| `src/pageindex/archive.ts` | `loadArchivedBookIds(vaultPath): Promise<Set<string>>`、`toggleArchive(vaultPath, bookId): Promise<boolean>` | ~40 行 |

### 3.4 UI 交互

#### 3.4.1 工具栏切换按钮

- 位置：搜索框和「筛选」按钮之间
- 默认状态：灰色 📦（隐藏已归档）
- 点击后点亮 📦（仅显示已归档书籍）
- 再次点击回到默认态

```
[🔍 搜索...] [➕] [📚] [📦] [🔽 筛选]
```

#### 3.4.2 卡片悬停归档按钮

- 在 `deeppdf-lib-cover-actions` 区域添加 📦 按钮（与删除按钮并排）
- 默认视图下：显示为「归档」按钮
- 归档视图下：显示为「取消归档」按钮
- 点击后：立即标记归档/取消归档 → `new Notice('已归档《书名》', 3000)` → 重新渲染网格

#### 3.4.3 批量归档

- 多选模式下，底部确认栏增加「批量归档 N 本书」按钮
- 无确认弹窗，直接归档
- 操作后显示 Notice

### 3.5 归档后行为

| 行为 | 规则 |
|------|------|
| 默认显示 | **隐藏**——已归档的书不出现在主书库中 |
| 归档视图 | 📦 按钮切换后只显示已归档的书 |
| 侧边栏打开笔记 | 完全正常 |
| Agent 搜索内容 | 完全正常（搜索不区分归档状态） |
| 微信读书同步 | 完全正常（归档不阻断 API 同步） |
| 删除索引 | 从 catalog 清理归档标记 |

### 3.6 修改文件

| 文件 | 变更 |
|------|------|
| `src/pageindex/vault/types.ts` | `CatalogBookEntry` 加 `archived?: boolean` |
| `src/views/library-view.ts` | 新增 `showArchived: boolean` 状态、`archivedBookIds: Set<string>`、`loadArchiveState()`、`toggleArchiveView()`、`createArchiveButton()`；修改 `renderGrid()` 过滤逻辑；`createBookCard()` 中判断视图模式渲染归档/取消归档按钮 |
| `src/views/library-view.css` | 新增 `.deeppdf-lib-archive-btn` 样式、归档视图状态样式 |
| `src/views/sidebar/book-manager.ts` | `deleteIndex()` 中同步清理 catalog 归档标记 |

### 3.7 验收条件

- [ ] `npm run build` 通过
- [ ] 书库工具栏有 📦 按钮，点击切换显示已归档 / 隐藏已归档
- [ ] 悬停封面可看到归档按钮，点击后 Notice 提示，卡片消失（默认视图）
- [ ] 归档视图下每张卡片显示「取消归档」按钮
- [ ] 多选模式支持批量归档
- [ ] 归档后 Agent 和侧边栏功能不受影响
- [ ] 清除索引时同时清理 catalog 中的归档标记

---

## 4. 不做（Out of Scope）

- ❌ 不实现归档文件夹/物理隔离（硬归档）
- ❌ 不实现归档自动规则（如"读完自动归档"）
- ❌ 不实现归档统计（如"已归档 N 本书"）
- ❌ 不修改阅读进度相关的后端 indexer.py
- ❌ 不修改微信读书 API 同步逻辑本身（仅删除进度展示）

---

## 5. 风险与限制

| 风险 | 缓解措施 |
|------|---------|
| Phase 1 到 Phase 2 之间有窗口期，用户无归档能力 | 进度已删除，不会更差；Phase 2 紧随其后 |
| `notifyHighlight` 丢失 `currentChapterId` | 改为从活跃文件 frontmatter 直接读 `node_id` |
| 旧用户有 `reading-progress.json` 残留文件 | 不主动删除（Obsidian 不关心），Phase 1 不再读写它们 |
| 归档后用户找不到书 | 📦 切换按钮始终可见；Notice 提示归档成功 |

---

## 6. 实现步骤

### Step 1: Phase 1 删除文件
删除 `reading-progress.ts`、`reading-progress-tracker.ts`、`reading-progress.test.ts`、`milestones.ts`

### Step 2: Phase 1 修改文件
按 2.2 修改清单逐一修改 `library-view.ts`/`.css`、`sidebar-view.ts`、`book-manager.ts`、`humanized-adapter.ts`/`types.ts`、`weread-tools.ts`、`store.ts`

### Step 3: Phase 1 验证
`npm run build` 通过，确认无残留引用

### Step 4: Phase 2 新增数据模型
修改 `CatalogBookEntry` 加 `archived` 字段；新建 `src/pageindex/archive.ts`

### Step 5: Phase 2 UI 实现
工具栏按钮、悬停归档按钮、多选批量归档、过滤逻辑、CSS

### Step 6: Phase 2 清理
`BookManager.deleteIndex()` 中同步清理归档标记

### Step 7: Phase 2 验证
`npm run build` 通过，手动确认 UI 交互符合 3.7 验收条件

---

## 7. 配套清理（本次同时删除的文档）

本次 PR 随 Phase 1 一起删除了两个不在 §2 范围内的文档。说明如下：

| 文件 | 行数 | 删除理由 |
|------|------|---------|
| `CHANGELOG.md` | 77 | 改为依赖 GitHub Releases 记录发布说明。`release.yml` workflow 不再本地维护 CHANGELOG。 |
| `docs/specs/SPEC-visualizer-pi-integration.md` | 238 | 规划文档使命完成：8 个 commit（`feat(visualizer)` / `feat(pi)` / `fix(pi)` 系列）已落地，实现与设计一致。保留无增量价值，清理以避免误导后续读者。 |

**回滚路径**（如需恢复）：
- `CHANGELOG.md`：
  - 未提交本次 PR 前：`git checkout HEAD -- CHANGELOG.md`
  - 提交后：`git show <commit-sha>^:CHANGELOG.md > CHANGELOG.md`（取删除 commit 的 parent）
- `SPEC-visualizer`：原文件保留在 commit `8aad5377`（SPEC 创建 commit），任何时候 `git show 8aad5377:docs/specs/SPEC-visualizer-pi-integration.md` 均可查看/恢复。
