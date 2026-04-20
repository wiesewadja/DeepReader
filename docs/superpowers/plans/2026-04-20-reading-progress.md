# Reading Progress Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 DeepReader 添加阅读进度功能：书库卡片进度条 + 顶栏圆环进度 + 断点续读，同时清理旧进度死代码。

**Architecture:** 新增 `reading-progress.ts` 数据层，存储在 `.pageindex/{bookId}/reading-progress.json`。进度基于章节覆盖率（visited 布尔值），而非不稳定的 CSS 页码。sidebar-view 编排读写，PagePaginator 新增 `onPageChange` 回调触发更新。

**Tech Stack:** TypeScript, Obsidian API, Vitest

**Spec:** `docs/superpowers/specs/2026-04-20-reading-progress-design.md`

---

## Chunk 1: Data Layer + Tests

### Task 1: Create reading-progress data module

**Files:**
- Create: `src/pageindex/reading-progress.ts`
- Create: `src/pageindex/__tests__/reading-progress.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/pageindex/__tests__/reading-progress.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
  type ReadingProgress,
  createEmptyProgress,
  loadProgress,
  saveProgress,
  getProgressPercent,
  markChapterVisited,
  updateLastRead,
} from '../reading-progress.js';

describe('ReadingProgress', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('createEmptyProgress', () => {
    it('should create progress with correct defaults', () => {
      const p = createEmptyProgress('abc12345');
      expect(p.version).toBe(1);
      expect(p.bookId).toBe('abc12345');
      expect(p.lastReadChapterId).toBe('');
      expect(p.lastReadAt).toBe('');
      expect(Object.keys(p.chapters)).toHaveLength(0);
    });
  });

  describe('markChapterVisited', () => {
    it('should mark a chapter as visited', () => {
      const p = createEmptyProgress('abc12345');
      const updated = markChapterVisited(p, 'ch01');
      expect(updated.chapters['ch01'].visited).toBe(true);
    });

    it('should not duplicate if already visited', () => {
      const p = createEmptyProgress('abc12345');
      const updated = markChapterVisited(markChapterVisited(p, 'ch01'), 'ch01');
      expect(updated.chapters['ch01'].visited).toBe(true);
      expect(Object.keys(updated.chapters)).toHaveLength(1);
    });
  });

  describe('updateLastRead', () => {
    it('should update lastReadChapterId and lastReadAt', () => {
      const p = createEmptyProgress('abc12345');
      const updated = updateLastRead(p, 'ch03');
      expect(updated.lastReadChapterId).toBe('ch03');
      expect(updated.lastReadAt).toBeTruthy();
    });
  });

  describe('getProgressPercent', () => {
    it('should return 0 when no chapters visited', () => {
      const p = createEmptyProgress('abc12345');
      expect(getProgressPercent(p, 10)).toBe(0);
    });

    it('should calculate percentage from visited chapters', () => {
      let p = createEmptyProgress('abc12345');
      p = markChapterVisited(p, 'ch01');
      p = markChapterVisited(p, 'ch02');
      p = markChapterVisited(p, 'ch03');
      // 3 visited out of 10 total = 30%
      expect(getProgressPercent(p, 10)).toBe(30);
    });

    it('should return 100 when all chapters visited', () => {
      let p = createEmptyProgress('abc12345');
      for (let i = 0; i < 5; i++) {
        p = markChapterVisited(p, `ch${i}`);
      }
      expect(getProgressPercent(p, 5)).toBe(100);
    });
  });

  describe('loadProgress / saveProgress', () => {
    it('should return null when file does not exist', async () => {
      const result = await loadProgress(tempDir, 'nonexistent');
      expect(result).toBeNull();
    });

    it('should round-trip save and load', async () => {
      let p = createEmptyProgress('abc12345');
      p = markChapterVisited(p, 'ch01');
      p = updateLastRead(p, 'ch01');

      await saveProgress(tempDir, p);
      const loaded = await loadProgress(tempDir, 'abc12345');

      expect(loaded).not.toBeNull();
      expect(loaded!.bookId).toBe('abc12345');
      expect(loaded!.chapters['ch01'].visited).toBe(true);
      expect(loaded!.lastReadChapterId).toBe('ch01');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pageindex/__tests__/reading-progress.test.ts`
Expected: FAIL — module `../reading-progress.js` not found

- [ ] **Step 3: Write minimal implementation**

Create `src/pageindex/reading-progress.ts`:

```typescript
/**
 * 阅读进度数据层
 *
 * 存储在 .pageindex/{bookId}/reading-progress.json
 * 进度基于章节覆盖率，不依赖不稳定的 CSS 页码
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { progressLog as log, error } from '../utils/logger.js';

/** 阅读进度数据结构 */
export interface ReadingProgress {
  version: 1;
  bookId: string;
  lastReadChapterId: string;
  lastReadAt: string;
  chapters: Record<string, {
    visited: boolean;
  }>;
}

/** 创建空的进度数据 */
export function createEmptyProgress(bookId: string): ReadingProgress {
  return {
    version: 1,
    bookId,
    lastReadChapterId: '',
    lastReadAt: '',
    chapters: {},
  };
}

/** 标记章节已浏览 */
export function markChapterVisited(progress: ReadingProgress, chapterId: string): ReadingProgress {
  if (!progress.chapters[chapterId]) {
    progress.chapters[chapterId] = { visited: true };
  } else {
    progress.chapters[chapterId].visited = true;
  }
  return progress;
}

/** 更新最后阅读位置 */
export function updateLastRead(progress: ReadingProgress, chapterId: string): ReadingProgress {
  progress.lastReadChapterId = chapterId;
  progress.lastReadAt = new Date().toISOString();
  return progress;
}

/** 计算进度百分比 (0-100) */
export function getProgressPercent(progress: ReadingProgress, totalChapters: number): number {
  if (totalChapters === 0) return 0;
  const visitedCount = Object.values(progress.chapters).filter(c => c.visited).length;
  return Math.round((visitedCount / totalChapters) * 100);
}

/** 获取进度文件路径 */
function getProgressFilePath(baseDir: string, bookId: string): string {
  return path.join(baseDir, '.pageindex', bookId, 'reading-progress.json');
}

/** 从磁盘加载进度 */
export async function loadProgress(baseDir: string, bookId: string): Promise<ReadingProgress | null> {
  const filePath = getProgressFilePath(baseDir, bookId);
  try {
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!exists) return null;
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as ReadingProgress;
  } catch (err) {
    error('[ReadingProgress] Failed to load:', err);
    return null;
  }
}

/** 保存进度到磁盘 */
export async function saveProgress(baseDir: string, progress: ReadingProgress): Promise<void> {
  const filePath = getProgressFilePath(baseDir, progress.bookId);
  try {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(progress, null, 2), 'utf-8');
    log('[ReadingProgress] Saved:', progress.bookId);
  } catch (err) {
    error('[ReadingProgress] Failed to save:', err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pageindex/__tests__/reading-progress.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/pageindex/reading-progress.ts src/pageindex/__tests__/reading-progress.test.ts
git commit -m "feat: add reading-progress data layer with tests"
```

---

## Chunk 2: Dead Code Cleanup

### Task 2: Remove old reading progress dead code from plugin-data.ts

**Files:**
- Modify: `src/agent/utils/plugin-data.ts`

- [ ] **Step 1: Remove dead exports from plugin-data.ts**

Remove the following from `src/agent/utils/plugin-data.ts`:
- `READING_PROGRESS_DIR` constant (line 14)
- `ReadingProgressData` interface (lines 25-44)
- `readReadingProgress()` function (lines 78-96)
- `writeReadingProgress()` function (lines 101-121)
- `createEmptyReadingProgress()` function (lines 126-151)
- `calculateProgressMetrics()` function (lines 156-178)
- `listAllReadingProgress()` function (lines 183-214)
- `getReadingProgressPath()` function (lines 69-73)

Keep: `PLUGIN_DATA_DIR`, `MEMORY_DATA_DIR`, `MEMORY_ENTRIES_DIR`, `ensurePluginDataDirs()` (but remove `READING_PROGRESS_DIR` from the dirs array).

- [ ] **Step 2: Verify build passes**

Run: `npx tsc --noEmit`
Expected: errors about missing imports in other files — this is expected, we'll fix them in the next tasks.

### Task 3: Remove dead imports and usage from sidebar-view.ts

**Files:**
- Modify: `src/views/sidebar-view.ts`

- [ ] **Step 1: Remove dead imports (lines 28-29)**

Remove:
```typescript
import { readReadingProgress } from "../agent/utils/plugin-data.js";
import { calculateProgressMetrics } from "../agent/utils/plugin-data.js";
```

- [ ] **Step 2: Remove progress loading code (around line 1902-1931)**

Find and remove the block:
```typescript
// 加载阅读进度
if (this.currentPdfName) {
    try {
        const progressData = await readReadingProgress(this.app, this.currentPdfName);
        if (progressData) {
            ... (context.readingProgress assignment)
        }
    } catch (err) { ... }
}
```

### Task 4: Remove ReadingProgress from agent tools/types.ts

**Files:**
- Modify: `src/agent/tools/types.ts`

- [ ] **Step 1: Remove ReadingProgress interface and ToolContext field**

Remove the `ReadingProgress` interface (lines 15-34).
Remove `readingProgress?: ReadingProgress;` from `ToolContext` (line 51).

### Task 5: Remove ReadingProgress from context/builder.ts

**Files:**
- Modify: `src/agent/context/builder.ts`

- [ ] **Step 1: Remove ReadingProgress type and _progress parameter**

Remove the local `ReadingProgress` interface (lines 48-51).
Remove `_progress` parameter from `buildMessagesWithMetadata()` signature (line 331).

### Task 6: Remove dead code from milestones.ts

**Files:**
- Modify: `src/agent/memory/milestones.ts`

- [ ] **Step 1: Remove all progress-related code**

Remove:
- Import of `readReadingProgress` and `ReadingProgressData` from plugin-data (line 20)
- `checkProgressMilestones()` method (lines 145-179)
- `initializeCache()` method body — remove the `listAllReadingProgress` import and the reading progress loop (lines 186-201), keep the method as a no-op or remove it entirely
- `lastCoverage` and `lastAbsorption` Maps (lines 91-92) since they're only used by `checkProgressMilestones`

Keep: `recordMilestone()`, `handleBookSwitch()`, `getCurrentBook()`, `setCurrentBook()` — these are still used.

- [ ] **Step 2: Clean up sidebar-view.ts milestone calls**

In `src/views/sidebar-view.ts`, remove the `initializeCache()` call at line 119:
```typescript
await this.milestoneRecorder.initializeCache();
```

### Task 7: Remove progress parameter from agent/index.ts

**Files:**
- Modify: `src/agent/index.ts`

- [ ] **Step 1: Remove progress parameter from buildMessages call**

Find the `buildMessages()` call (around line 263-279) and remove the `progress` parameter from both the method signature and the `buildMessagesWithMetadata` call inside.

- [ ] **Step 2: Verify build passes**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Run existing tests**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove dead reading progress code from old system"
```

---

## Chunk 3: UI — Library Card Progress

### Task 8: Add progress bar to library cards

**Files:**
- Modify: `src/components/library-modal/library-modal.ts`
- Modify: `src/styles/library-modal.css`

- [ ] **Step 1: Add progress loading to LibraryModal**

In `library-modal.ts`, add a private field `private readingProgressCache: Map<string, ReadingProgress> = new Map()`.

In the `onOpen()` method, after indexes are loaded, batch-load all reading progress files. The baseDir for progress is `this.app.vault.adapter.getBasePath()` (or equivalent Obsidian vault path). Use `loadProgress()` from the new module.

Add a method `loadAllReadingProgress()`:
```typescript
private async loadAllReadingProgress(): Promise<void> {
  this.readingProgressCache.clear();
  const baseDir = (this.app.vault.adapter as any).getBasePath?.() ?? '';
  for (const idx of this.indexes) {
    if (idx.status !== 'ready') continue;
    const p = await loadProgress(baseDir, idx.id);
    if (p) this.readingProgressCache.set(idx.id, p);
  }
}
```

- [ ] **Step 2: Render progress bar on ready cards**

In the card rendering section (the `else` branch at line 244 where status is 'ready'), after the cover is rendered, add a progress bar at the bottom of `coverEl`:

```typescript
// 阅读进度条
const rp = this.readingProgressCache.get(index.id);
if (rp) {
  const totalChapters = /* from catalog or index metadata */;
  const percent = getProgressPercent(rp, totalChapters);
  if (percent > 0) {
    const progressBar = coverEl.createDiv({ cls: 'deeppdf-lib-reading-progress-bar' });
    progressBar.style.width = `${percent}%`;
    const percentEl = coverEl.createDiv({ cls: 'deeppdf-lib-reading-percent' });
    percentEl.textContent = percent >= 100 ? '已读' : `${percent}%`;
  }
}
```

The `totalChapters` can be obtained from the catalog entry (`CatalogBookEntry.nodeCount`) or from `BookMeta.chapters.length` stored during indexing.

- [ ] **Step 3: Add CSS styles**

In `library-modal.css`, add:

```css
/* 阅读进度条 - 封面底部 */
.deeppdf-lib-book-cover {
  position: relative;
}

.deeppdf-lib-reading-progress-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 4px;
  background: var(--text-accent);
  border-radius: 0 0 4px 4px;
  transition: width 0.3s ease;
}

.deeppdf-lib-reading-percent {
  position: absolute;
  bottom: 6px;
  right: 6px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--background-primary);
  padding: 1px 4px;
  border-radius: 3px;
  opacity: 0.9;
}
```

- [ ] **Step 4: Update sort order**

In the `sortIndexes()` method, update the ready group sorting to sort by `lastReadAt` descending. For indexes with no reading progress, treat `lastReadAt` as empty string (sorts last).

- [ ] **Step 5: Verify in Obsidian**

Run: `npm run build`, reload Obsidian, open library modal — progress bars should appear on previously read books.

- [ ] **Step 6: Commit**

```bash
git add src/components/library-modal/library-modal.ts src/styles/library-modal.css
git commit -m "feat: add reading progress bar to library cards"
```

---

## Chunk 4: UI — Topbar Circular Progress

### Task 9: Add circular progress to ReadingTopbar

**Files:**
- Modify: `src/components/reading-topbar/reading-topbar.ts`
- Modify: `src/components/reading-topbar/reading-topbar.css`

- [ ] **Step 1: Add progress element and update method**

In `reading-topbar.ts`, add a private field for the progress container and SVG elements:

```typescript
private progressRing: SVGSVGElement | null = null;
private progressCircle: SVGCircleElement | null = null;
private progressText: HTMLElement | null = null;
```

In `render()`, between `leftSection` and `rightSection`, add a progress section:

```typescript
// 圆环进度
const progressContainer = document.createElement('div');
progressContainer.className = 'deeppdf-topbar-progress';
progressContainer.style.display = 'none'; // hidden when no book

const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
svg.setAttribute('width', '28');
svg.setAttribute('height', '28');
svg.setAttribute('viewBox', '0 0 28 28');
this.progressRing = svg;

// Background circle
const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
bgCircle.setAttribute('cx', '14');
bgCircle.setAttribute('cy', '14');
bgCircle.setAttribute('r', '11');
bgCircle.setAttribute('fill', 'none');
bgCircle.setAttribute('stroke', 'var(--background-modifier-border)');
bgCircle.setAttribute('stroke-width', '2.5');
svg.appendChild(bgCircle);

// Progress circle
const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
circle.setAttribute('cx', '14');
circle.setAttribute('cy', '14');
circle.setAttribute('r', '11');
circle.setAttribute('fill', 'none');
circle.setAttribute('stroke', 'var(--text-accent)');
circle.setAttribute('stroke-width', '2.5');
circle.setAttribute('stroke-linecap', 'round');
// circumference = 2 * π * 11 ≈ 69.12
circle.setAttribute('stroke-dasharray', '69.12');
circle.setAttribute('stroke-dashoffset', '69.12');
circle.setAttribute('transform', 'rotate(-90 14 14)');
this.progressCircle = circle;
svg.appendChild(circle);

progressContainer.appendChild(svg);

// Percentage text
this.progressText = document.createElement('span');
this.progressText.className = 'deeppdf-topbar-progress-text';
progressContainer.appendChild(this.progressText);

container.appendChild(progressContainer);
```

Add a public method:

```typescript
/**
 * 更新阅读进度圆环
 * @param percent 0-100, -1 = hide
 */
public setProgress(percent: number): void {
  const progressContainer = this.el.querySelector('.deeppdf-topbar-progress') as HTMLElement;
  if (!progressContainer) return;

  if (percent < 0 || percent === 0) {
    progressContainer.style.display = percent === 0 ? 'flex' : 'none';
    if (percent === 0) {
      // Empty ring
      if (this.progressCircle) this.progressCircle.setAttribute('stroke-dashoffset', '69.12');
      if (this.progressText) this.progressText.textContent = '';
    }
    return;
  }

  progressContainer.style.display = 'flex';
  const circumference = 69.12;
  const offset = circumference - (percent / 100) * circumference;
  if (this.progressCircle) this.progressCircle.setAttribute('stroke-dashoffset', String(offset));
  if (this.progressText) {
    this.progressText.textContent = percent >= 100 ? '✓' : `${percent}`;
  }
}
```

- [ ] **Step 2: Add CSS styles**

In `reading-topbar.css`:

```css
.deeppdf-topbar-progress {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-right: 4px;
}

.deeppdf-topbar-progress svg {
  flex-shrink: 0;
}

.deeppdf-topbar-progress-text {
  font-size: 10px;
  color: var(--text-muted);
  min-width: 16px;
  text-align: center;
}
```

- [ ] **Step 3: Reset progress on book clear**

In `setCurrentBook()` when `name` is null, call `this.setProgress(-1)`.

- [ ] **Step 4: Commit**

```bash
git add src/components/reading-topbar/reading-topbar.ts src/components/reading-topbar/reading-topbar.css
git commit -m "feat: add circular reading progress to topbar"
```

---

## Chunk 5: PagePaginator onPageChange Callback

### Task 10: Add onPageChange callback to PagePaginator

**Files:**
- Modify: `src/components/reading-mode/page-paginator.ts`
- Modify: `src/components/reading-mode/__tests__/page-paginator.test.ts`

- [ ] **Step 1: Add callback to options interface**

In `page-paginator.ts`, update `PagePaginatorOptions`:

```typescript
export interface PagePaginatorOptions {
  container: HTMLElement;
  onNavigatePrev: () => Promise<boolean>;
  onNavigateNext: () => Promise<boolean>;
  chapterName?: string;
  onPageChange?: (currentPage: number, totalPages: number) => void;  // NEW
}
```

- [ ] **Step 2: Store and invoke callback**

Add a private field:
```typescript
private onPageChange?: (currentPage: number, totalPages: number) => void;
```

In the constructor:
```typescript
this.onPageChange = options.onPageChange;
```

Call `this.onPageChange?.(this._currentPage, this._totalPages)` in the following places:
- End of `nextPage()` after page changes
- End of `prevPage()` after page changes
- End of `setCurrentPage()`
- End of `paginateAndShow()` (initial setup)

- [ ] **Step 3: Verify existing tests still pass**

Run: `npx vitest run src/components/reading-mode/__tests__/page-paginator.test.ts`
Expected: all pass (new callback is optional)

- [ ] **Step 4: Commit**

```bash
git add src/components/reading-mode/page-paginator.ts
git commit -m "feat: add onPageChange callback to PagePaginator"
```

---

## Chunk 6: Integration — Sidebar View Orchestration

### Task 11: Wire up progress in sidebar-view

**Files:**
- Modify: `src/views/sidebar-view.ts`

This is the central orchestration task. sidebar-view manages the in-memory progress state, debounce writes, and connects the UI components.

- [ ] **Step 1: Add progress state fields**

```typescript
private readingProgress: ReadingProgress | null = null;
private progressDebounceTimer: ReturnType<typeof setTimeout> | null = null;
```

- [ ] **Step 2: Load progress when book is selected**

In the book selection handler (where `currentPdfName` is set), after the book meta is loaded:

```typescript
const baseDir = (this.app.vault.adapter as any).getBasePath?.() ?? '';
this.readingProgress = await loadProgress(baseDir, bookId) ?? createEmptyProgress(bookId);
```

Update the topbar progress:
```typescript
const totalChapters = bookMeta.chapters.length;
const percent = getProgressPercent(this.readingProgress, totalChapters);
this.readingTopbar?.setProgress(percent);
```

- [ ] **Step 3: Wire PagePaginator onPageChange**

When creating `PagePaginator` (in reading-mode-service or sidebar-view), pass the `onPageChange` callback. On each page change, mark current chapter as visited and debounce save:

```typescript
onPageChange: (currentPage, totalPages) => {
  if (!this.readingProgress || !this.currentChapterId) return;
  this.readingProgress = markChapterVisited(this.readingProgress, this.currentChapterId);
  this.readingProgress = updateLastRead(this.readingProgress, this.currentChapterId);
  this.scheduleProgressSave();
}
```

- [ ] **Step 4: Implement scheduleProgressSave and flushProgressSave**

```typescript
private scheduleProgressSave(): void {
  if (this.progressDebounceTimer) clearTimeout(this.progressDebounceTimer);
  this.progressDebounceTimer = setTimeout(() => this.flushProgressSave(), 3000);
}

private async flushProgressSave(): Promise<void> {
  if (this.progressDebounceTimer) clearTimeout(this.progressDebounceTimer);
  this.progressDebounceTimer = null;
  if (!this.readingProgress) return;
  const baseDir = (this.app.vault.adapter as any).getBasePath?.() ?? '';
  await saveProgress(baseDir, this.readingProgress);
  // Update topbar
  const percent = getProgressPercent(this.readingProgress, this.totalChapters);
  this.readingTopbar?.setProgress(percent);
}
```

- [ ] **Step 5: Flush on chapter switch and exit**

On chapter switch: call `this.flushProgressSave()` immediately before loading the new chapter.
On reading mode exit / book close: call `this.flushProgressSave()`.

- [ ] **Step 6: Commit**

```bash
git add src/views/sidebar-view.ts
git commit -m "feat: wire reading progress into sidebar-view"
```

---

## Chunk 7: Resume Reading (断点续读)

### Task 12: Auto-jump to last read chapter

**Files:**
- Modify: `src/services/reading-mode-service.ts`

- [ ] **Step 1: Add resume support to reading-mode-service**

Add a public method or modify the existing file-open logic to accept a target chapter ID:

```typescript
/**
 * 跳转到指定章节（用于断点续读）
 * @param chapterId ChapterMeta.id
 * @param chapters BookMeta.chapters 数组
 */
async jumpToChapterById(chapterId: string, chapters: Array<{id: string; mdFilePath: string}>): Promise<boolean> {
  const target = chapters.find(c => c.id === chapterId);
  if (!target) return false;
  const file = this.app.vault.getAbstractFileByPath(target.mdFilePath);
  if (!file || !(file instanceof TFile)) return false;
  await this.app.workspace.getLeaf(false).openFile(file);
  return true;
}
```

- [ ] **Step 2: Trigger resume from sidebar-view**

In the book selection handler, after loading progress and book meta:

```typescript
// 断点续读
if (this.readingProgress?.lastReadChapterId) {
  const chapters = bookMeta.chapters;
  await this.readingModeService?.jumpToChapterById(
    this.readingProgress.lastReadChapterId,
    chapters
  );
}
```

- [ ] **Step 3: Verify end-to-end**

Run: `npm run build`, reload Obsidian, open a book, read some chapters, close it, reopen — should jump to last chapter.

- [ ] **Step 4: Commit**

```bash
git add src/services/reading-mode-service.ts src/views/sidebar-view.ts
git commit -m "feat: add resume reading — auto-jump to last chapter"
```

---

## Chunk 8: Final Verification

### Task 13: Full build and test pass

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Build production**

Run: `npm run build`
Expected: build succeeds

- [ ] **Step 4: Manual smoke test in Obsidian**

1. Open library modal — verify progress bars on cards
2. Select a book — verify topbar shows circular progress
3. Read some chapters — verify progress updates
4. Close and reopen book — verify resume reading works
5. Check `.pageindex/{bookId}/reading-progress.json` is written correctly

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: reading progress — library cards, topbar, resume reading"
```
