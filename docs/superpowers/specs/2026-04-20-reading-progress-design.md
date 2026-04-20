# Reading Progress Design

## Overview

为 DeepReader 添加阅读进度功能，包含两个核心能力：
1. **书库可视化进度** — 在书库卡片和阅读顶栏展示阅读进度
2. **断点续读** — 打开书时自动跳转到上次阅读位置

优先级：UI 可视化优先，断点续读次之。

## Data Layer

### Storage Location

`.pageindex/{bookId}/reading-progress.json`

替换旧的死代码进度系统（见下方 "Removed Files" 部分）。旧系统仅存在于 `.obsidian/plugins/deepreader/data/reading-progress/`，从未写入过数据，读取后也无实际消费。

删除索引时进度数据随 `.pageindex/{bookId}/` 目录一起删除，无需额外清理。

### Data Model

```typescript
interface ReadingProgress {
  version: 1;
  bookId: string;
  lastReadChapterId: string;     // ChapterMeta.id，来自 book-meta.json
  lastReadAt: string;            // ISO timestamp
  chapters: Record<string, {     // key = ChapterMeta.id
    visited: boolean;            // 是否浏览过该章节
  }>;
}
```

**设计决策 — 为什么不存页码和 readPages 数组**：

PagePaginator 的页数基于 CSS 列布局（`scrollWidth / clientWidth`），随窗口 resize 和字体大小变化而改变。同一本书在不同窗口下 `totalPages` 完全不同，页码不可靠。因此：
- 进度指标改用**章节覆盖率**（已浏览章节 / 总章节数），而非页面级精度
- 断点续读定位到章节级别（加载对应章节的 Markdown 文件），不依赖页码

### Core Operations

| Operation | Description |
|-----------|-------------|
| `loadProgress(bookId)` | Read from `.pageindex/{bookId}/reading-progress.json` |
| `saveProgress(progress)` | Write to disk |
| `getProgressPercent(progress)` | `visited章节数 / BookMeta.chapters.length` |

### Write Timing

1. 章节浏览（进入新章节时标记 `visited: true`）：debounce 3 秒
2. 切换章节时：立即写入（同时取消 pending 的 debounce）
3. 退出阅读模式时：立即写入（同时取消 pending 的 debounce）

`sidebar-view` 维护一个 debounce timer 引用，立即写入时先 `clearTimeout` 再写磁盘，避免并发竞争。

## UI: Library Card Progress

在 `library-modal.ts` 中，已索引完成的书籍卡片上叠加阅读进度：

- **进度条位置**: 封面底部，高度 4px
- **进度条颜色**: `--text-accent`（未读部分半透明背景）
- **百分比文字**: 封面右下角，如 "45%"
- **已读完**: 进度条 100% 全满，显示 "已读"
- **未读书籍**: 进度条为空（0%），不显示文字
- **排序**: 先按索引状态分优先级组（processing > queued > ready > failed），组内 `ready` 状态的书籍按 `lastReadAt` 降序排列，未读书排最后

**数据流**: 书库打开时批量读取所有 `reading-progress.json`，缓存到内存 Map（key = bookId），增量更新卡片。书库关闭时释放缓存。

## UI: Reading Topbar Progress

在 `reading-topbar.ts` 中，顶栏布局：

**左侧**: 封面 + 书名/作者 → **右侧**: 圆环进度 + 书库按钮 + 设置按钮

圆环进度细节：
- SVG `circle` + `stroke-dasharray` 实现，尺寸约 28x28px
- 圆环中心显示百分比数字（如 "45"）
- 已读完: 圆环满色 + 显示 ✓
- 未读 (0%): 圆环灰色空心，中心无数字
- 颜色用 `--text-accent`

## Resume Reading (断点续读)

**触发时机**: 用户从书库选择书籍并打开阅读模式。

**流程**:
1. 加载 `.pageindex/{bookId}/reading-progress.json`
2. 有 `lastReadChapterId`: 通过 `BookMeta.chapters` 找到对应的 `ChapterMeta`，获取其 `mdFilePath`，加载该章节
3. 无进度记录: 从第一章开始（默认行为）

**章节 ID 映射**: `lastReadChapterId` 对应 `ChapterMeta.id`（定义在 `book-meta.json` 中）。`reading-mode-service` 通过 `BookMeta.chapters` 查找该 ID 对应的章节文件路径（`mdFilePath`），然后加载。

**集成点**: `reading-mode-service.ts` 的章节加载流程中，优先使用 `lastReadChapterId` 对应的章节文件。

**更新机制**:
- 进入新章节时，将 `lastReadChapterId` 更新为当前章节 ID，标记 `chapters[id].visited = true`
- 通过 `page-paginator` 新增的 `onPageChange` 回调（需要给 PagePaginator 添加此回调）感知章节变化
- 切换章节时先写入当前进度再加载新章节
- 退出阅读模式时立即写入

## File Changes

### New Files

| File | Purpose |
|------|---------|
| `src/pageindex/reading-progress.ts` | Types + load/save/getPercent |

### Modified Files

| File | Change |
|------|--------|
| `src/components/library-modal/library-modal.ts` | Card progress bar + sort by lastReadAt within status groups |
| `src/components/reading-topbar/reading-topbar.ts` | Circular progress SVG on the right side |
| `src/components/reading-topbar/reading-topbar.css` | Circular progress styles |
| `src/components/reading-mode/page-paginator.ts` | Add `onPageChange` callback (new public event) |
| `src/services/reading-mode-service.ts` | Resume: load chapter by `lastReadChapterId` via BookMeta lookup |
| `src/views/sidebar-view.ts` | Orchestrate progress read/write, debounce timer management, connect components |
| `src/styles/library-modal.css` | Library card progress bar styles |

### Removed Files / Dead Code Cleanup

实施新进度系统的同时，移除以下从未完成的旧进度代码（全部是死代码：只读不写，读取后也无实际消费）：

| 文件 | 移除内容 |
|------|----------|
| `src/agent/utils/plugin-data.ts` | `ReadingProgressData` 类型、`READING_PROGRESS_DIR` 常量、`readReadingProgress()`、`writeReadingProgress()`、`createEmptyReadingProgress()`、`calculateProgressMetrics()`、`listAllReadingProgress()`。如果该文件移除这些后变为空文件，则整个删除 |
| `src/agent/tools/types.ts` | `ReadingProgress` 接口、`ToolContext.readingProgress` 可选字段 |
| `src/agent/context/builder.ts` | `ReadingProgress` 类型导入、`buildMessagesWithMetadata()` 的 `_progress` 参数 |
| `src/agent/memory/milestones.ts` | `checkProgressMilestones()` 方法、相关的 `readReadingProgress` / `listAllReadingProgress` 调用和导入。如果 `MilestoneRecorder` 类移除这些后变为空壳，则整个删除 |
| `src/views/sidebar-view.ts` | 第 28-29 行 `readReadingProgress` / `calculateProgressMetrics` 死导入、第 1902-1931 行进度加载和 `context.readingProgress` 赋值代码 |
| `src/agent/index.ts` | 移除传递给 `buildMessages` 的 `progress` 参数（如果存在） |

**不删除的内容**：
- `test-vault/DeepReader/如何阅读一本书/.progress.json` — 测试数据，不作为代码变更的一部分处理
- `ensurePluginDataDirs()` — 如果 `MEMORY_DATA_DIR` 和 `MEMORY_ENTRIES_DIR` 仍需要，保留该函数中对应的目录创建逻辑

## Data Flow

```
Enter new chapter
  → page-paginator onPageChange callback (new)
  → sidebar-view updates in-memory progress (lastReadChapterId, visited)
  → debounce 3s write to disk / immediate on chapter switch or exit
  → update topbar circular progress

Library modal opens
  → batch read all reading-progress.json
  → cache to Map<bookId, progress>
  → render progress bars on cards
  → sort: status group priority, then lastReadAt desc within ready group

Book selected & opened
  → sidebar-view reads progress
  → reading-mode-service finds chapter by lastReadChapterId in BookMeta
  → loads corresponding mdFilePath
```
