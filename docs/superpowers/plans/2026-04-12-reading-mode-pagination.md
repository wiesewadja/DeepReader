# Reading Mode Pagination Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kindle-style pagination to reading mode, dynamically splitting chapter content into screen-height pages with side navigation buttons and a progress bar.

**Architecture:** New `PagePaginator` class operates on Obsidian's rendered Markdown DOM — measures element heights against viewport, groups elements into pages, toggles visibility. Integrates into existing `ReadingModeService` alongside `ChapterNav` and `SelectionToolbar`. Keyboard arrows unified: page-first, chapter-on-boundary.

**Tech Stack:** TypeScript, Obsidian Plugin API (DOM, TFile), ResizeObserver, Vitest (jsdom)

**Spec:** `docs/superpowers/specs/2026-04-12-reading-mode-pagination-design.md`

---

## File Structure

### New files
- `src/components/reading-mode/page-paginator.ts` — Core pagination logic: measure, group, show/hide pages, controls
- `src/components/reading-mode/__tests__/page-paginator.test.ts` — Unit tests

### Modified files
- `src/components/reading-mode/reading-mode.css` — Add pagination styles (side buttons, progress bar, hidden-page class)
- `src/components/reading-mode/index.ts` — Export PagePaginator and PagePaginatorOptions
- `src/services/reading-mode-service.ts` — Integrate PagePaginator lifecycle
- `src/components/reading-mode/chapter-nav.ts` — Redirect keyboard arrows through paginator

---

## Chunk 1: Core Paginator Logic

### Task 1: Write failing tests for PagePaginator

**Files:**
- Create: `src/components/reading-mode/__tests__/page-paginator.test.ts`

- [ ] **Step 1: Create test file with structure tests**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PagePaginator, PagePaginatorOptions } from '../page-paginator.js';

describe('PagePaginator', () => {
    let container: HTMLElement;
    let onNavigatePrev: ReturnType<typeof vi.fn>;
    let onNavigateNext: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        container = document.createElement('div');
        container.className = 'markdown-preview-sizer';
        document.body.appendChild(container);
        onNavigatePrev = vi.fn().mockResolvedValue(true);
        onNavigateNext = vi.fn().mockResolvedValue(true);
    });

    afterEach(() => {
        container.remove();
        vi.restoreAllMocks();
    });

    // Helper: create N paragraphs of given text length
    function createParagraphs(count: number, charsPerParagraph: number): HTMLElement[] {
        const els: HTMLElement[] = [];
        for (let i = 0; i < count; i++) {
            const p = document.createElement('p');
            p.textContent = 'A'.repeat(charsPerParagraph);
            container.appendChild(p);
            els.push(p);
        }
        return els;
    }

    describe('paginate()', () => {
        it('should not activate when content fits in one page', () => {
            // Mock small content
            createParagraphs(2, 100);
            // Mock offsetHeight to return small values
            container.querySelectorAll('p').forEach(p => {
                Object.defineProperty(p, 'offsetHeight', { value: 50, configurable: true });
            });

            const paginator = new PagePaginator({
                container,
                onNavigatePrev,
                onNavigateNext,
            });

            paginator.paginateAndShow();

            expect(paginator.getTotalPages()).toBe(0); // 0 means not activated
            expect(paginator.isActive()).toBe(false);
        });

        it('should split content into multiple pages when content overflows', () => {
            // Create enough content to fill 3 pages
            createParagraphs(12, 500);
            // Each paragraph is 200px tall, viewport can fit ~500px worth
            container.querySelectorAll('p').forEach(p => {
                Object.defineProperty(p, 'offsetHeight', { value: 200, configurable: true });
            });

            const paginator = new PagePaginator({
                container,
                onNavigatePrev,
                onNavigateNext,
            });

            // Mock getAvailableHeight to return 500
            vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(500);

            paginator.paginateAndShow();

            expect(paginator.getTotalPages()).toBeGreaterThanOrEqual(3);
            expect(paginator.isActive()).toBe(true);
        });

        it('should keep elements whole — never split an element across pages', () => {
            // Single very tall element + several normal ones
            createParagraphs(5, 200);
            const heights = [400, 100, 100, 100, 400];
            container.querySelectorAll('p').forEach((p, i) => {
                Object.defineProperty(p, 'offsetHeight', { value: heights[i], configurable: true });
            });

            const paginator = new PagePaginator({
                container,
                onNavigatePrev,
                onNavigateNext,
            });
            vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(350);

            paginator.paginateAndShow();

            // First element (400px) should be alone on page 1 even though > 350
            // because it's the only element on that page and we can't split it
            expect(paginator.getTotalPages()).toBeGreaterThanOrEqual(2);
        });
    });

    describe('navigation', () => {
        it('should show first page initially', () => {
            createParagraphs(10, 500);
            container.querySelectorAll('p').forEach(p => {
                Object.defineProperty(p, 'offsetHeight', { value: 200, configurable: true });
            });

            const paginator = new PagePaginator({
                container,
                onNavigatePrev,
                onNavigateNext,
            });
            vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(400);

            paginator.paginateAndShow();

            expect(paginator.getCurrentPage()).toBe(0);
        });

        it('nextPage() should advance to next page', () => {
            createParagraphs(10, 500);
            container.querySelectorAll('p').forEach(p => {
                Object.defineProperty(p, 'offsetHeight', { value: 200, configurable: true });
            });

            const paginator = new PagePaginator({
                container,
                onNavigatePrev,
                onNavigateNext,
            });
            vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(400);
            paginator.paginateAndShow();

            const result = paginator.nextPage();

            expect(result).toBe(true);
            expect(paginator.getCurrentPage()).toBe(1);
        });

        it('nextPage() on last page should call onNavigateNext', () => {
            createParagraphs(4, 500);
            container.querySelectorAll('p').forEach(p => {
                Object.defineProperty(p, 'offsetHeight', { value: 200, configurable: true });
            });

            const paginator = new PagePaginator({
                container,
                onNavigatePrev,
                onNavigateNext,
            });
            vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(400);
            paginator.paginateAndShow();

            // Navigate to last page
            const totalPages = paginator.getTotalPages();
            for (let i = 0; i < totalPages - 1; i++) {
                paginator.nextPage();
            }

            const result = paginator.nextPage();

            expect(result).toBe(false);
            expect(onNavigateNext).toHaveBeenCalled();
        });

        it('prevPage() on first page should call onNavigatePrev', () => {
            createParagraphs(4, 500);
            container.querySelectorAll('p').forEach(p => {
                Object.defineProperty(p, 'offsetHeight', { value: 200, configurable: true });
            });

            const paginator = new PagePaginator({
                container,
                onNavigatePrev,
                onNavigateNext,
            });
            vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(400);
            paginator.paginateAndShow();

            const result = paginator.prevPage();

            expect(result).toBe(false);
            expect(onNavigatePrev).toHaveBeenCalled();
        });
    });

    describe('destroy()', () => {
        it('should restore all elements to visible', () => {
            createParagraphs(10, 500);
            container.querySelectorAll('p').forEach(p => {
                Object.defineProperty(p, 'offsetHeight', { value: 200, configurable: true });
            });

            const paginator = new PagePaginator({
                container,
                onNavigatePrev,
                onNavigateNext,
            });
            vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(400);
            paginator.paginateAndShow();

            // Some elements are hidden
            const hiddenBefore = container.querySelectorAll('.deeppdf-page-hidden').length;
            expect(hiddenBefore).toBeGreaterThan(0);

            paginator.destroy();

            const hiddenAfter = container.querySelectorAll('.deeppdf-page-hidden').length;
            expect(hiddenAfter).toBe(0);
            expect(paginator.isActive()).toBe(false);
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/reading-mode/__tests__/page-paginator.test.ts`
Expected: FAIL — module `../page-paginator.js` not found

---

### Task 2: Implement PagePaginator core

**Files:**
- Create: `src/components/reading-mode/page-paginator.ts`

- [ ] **Step 1: Implement PagePaginator class**

```typescript
/**
 * 阅读模式分页器
 * 根据视口高度动态将章节内容分为多页，类似 Kindle 翻页体验
 */

import { serviceLog } from '../../utils/logger.js';

export interface PagePaginatorOptions {
    container: HTMLElement;                    // .markdown-preview-sizer
    onNavigatePrev: () => Promise<boolean>;   // 翻到第一页再往前 → 上一章
    onNavigateNext: () => Promise<boolean>;   // 翻到最后一页再往后 → 下一章
    topPadding?: number;                      // 容器顶部留白（默认 80）
    bottomPadding?: number;                   // 容器底部留白（默认 120）
    controlsHeight?: number;                  // 进度条+导航高度（默认 60）
}

/** 顶层块元素选择器 — 这些是分页的最小单位 */
const BLOCK_SELECTORS = 'p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table, hr, div:not(.frontmatter):not(.frontmatter-container):not(.metadata-container):not(.deeppdf-chapter-nav):not(.deeppdf-page-controls)';

/** 隐藏页元素的 CSS 类 */
const HIDDEN_CLASS = 'deeppdf-page-hidden';

export class PagePaginator {
    private container: HTMLElement;
    private options: PagePaginatorOptions;
    private pages: Element[][] = [];
    private currentPageIndex: number = 0;
    private active: boolean = false;

    // DOM 控制
    private leftBtnEl: HTMLElement | null = null;
    private rightBtnEl: HTMLElement | null = null;
    private progressFillEl: HTMLElement | null = null;
    private pageIndicatorEl: HTMLElement | null = null;
    private controlsEl: HTMLElement | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private resizeDebounceTimer: number | null = null;

    constructor(options: PagePaginatorOptions) {
        this.container = options.container;
        this.options = {
            topPadding: 80,
            bottomPadding: 120,
            controlsHeight: 60,
            ...options,
        };
    }

    /** 是否已激活分页 */
    isActive(): boolean {
        return this.active;
    }

    /** 获取总页数 */
    getTotalPages(): number {
        return this.active ? this.pages.length : 0;
    }

    /** 获取当前页码（0-based） */
    getCurrentPage(): number {
        return this.currentPageIndex;
    }

    /**
     * 执行分页并显示第一页
     */
    paginateAndShow(): void {
        this.clearPages();

        const blocks = this.collectBlocks();
        if (blocks.length === 0) return;

        const availableHeight = this.getAvailableHeight();
        this.pages = this.groupIntoPages(blocks, availableHeight);

        // 内容不够一页则不激活
        if (this.pages.length <= 1) {
            serviceLog('[Paginator] Content fits in one page, pagination not activated');
            return;
        }

        this.active = true;
        this.createControls();
        this.setupResizeObserver();
        this.showPage(0);

        serviceLog(`[Paginator] Activated: ${this.pages.length} pages`);
    }

    /**
     * 下一页。到达末尾时返回 false 并触发章节切换回调。
     */
    nextPage(): boolean {
        if (!this.active) return false;

        if (this.currentPageIndex < this.pages.length - 1) {
            this.showPage(this.currentPageIndex + 1);
            return true;
        }

        // 已在最后一页 → 触发下一章
        this.options.onNavigateNext();
        return false;
    }

    /**
     * 上一页。到达开头时返回 false 并触发章节切换回调。
     */
    prevPage(): boolean {
        if (!this.active) return false;

        if (this.currentPageIndex > 0) {
            this.showPage(this.currentPageIndex - 1);
            return true;
        }

        // 已在第一页 → 触发上一章
        this.options.onNavigatePrev();
        return false;
    }

    /**
     * 销毁分页器，恢复所有元素可见
     */
    destroy(): void {
        this.clearPages();
        this.removeControls();
        this.teardownResizeObserver();
        this.pages = [];
        this.currentPageIndex = 0;
        this.active = false;
        serviceLog('[Paginator] Destroyed');
    }

    // ==================== 分页算法 ====================

    /**
     * 计算可用内容高度
     */
    private getAvailableHeight(): number {
        return window.innerHeight
            - (this.options.topPadding ?? 80)
            - (this.options.bottomPadding ?? 120)
            - (this.options.controlsHeight ?? 60);
    }

    /**
     * 收集容器中的顶层块元素
     */
    private collectBlocks(): Element[] {
        const allChildren = Array.from(this.container.children);
        return allChildren.filter(el => {
            // 排除导航栏、控制栏、frontmatter
            if (el.classList.contains('deeppdf-chapter-nav')) return false;
            if (el.classList.contains('deeppdf-page-controls')) return false;
            if (el.classList.contains('frontmatter')) return false;
            if (el.classList.contains('frontmatter-container')) return false;
            if (el.classList.contains('metadata-container')) return false;
            // 排除已隐藏的旧控制元素
            if (el.classList.contains(HIDDEN_CLASS)) return false;
            return el.matches(BLOCK_SELECTORS);
        });
    }

    /**
     * 将块元素按高度分组为页
     */
    private groupIntoPages(blocks: Element[], availableHeight: number): Element[][] {
        const pages: Element[][] = [];
        let currentPage: Element[] = [];
        let currentHeight = 0;

        for (const block of blocks) {
            const blockHeight = (block as HTMLElement).offsetHeight || 0;

            // 当前页已有内容，且加入这个元素会超出 → 封页
            if (currentPage.length > 0 && currentHeight + blockHeight > availableHeight) {
                pages.push(currentPage);
                currentPage = [];
                currentHeight = 0;
            }

            currentPage.push(block);
            currentHeight += blockHeight;
        }

        // 剩余元素归入最后一页
        if (currentPage.length > 0) {
            pages.push(currentPage);
        }

        return pages;
    }

    // ==================== 显示控制 ====================

    /**
     * 显示指定页，隐藏其他所有页
     */
    private showPage(pageIndex: number): void {
        if (pageIndex < 0 || pageIndex >= this.pages.length) return;

        this.currentPageIndex = pageIndex;

        for (let i = 0; i < this.pages.length; i++) {
            for (const el of this.pages[i]) {
                if (i === pageIndex) {
                    el.classList.remove(HIDDEN_CLASS);
                } else {
                    el.classList.add(HIDDEN_CLASS);
                }
            }
        }

        // 单独一页超高元素允许滚动
        const pageHeight = this.pages[pageIndex].reduce(
            (sum, el) => sum + ((el as HTMLElement).offsetHeight || 0), 0
        );
        if (pageHeight > this.getAvailableHeight()) {
            this.container.style.overflowY = 'auto';
            this.container.style.maxHeight = `${this.getAvailableHeight()}px`;
        } else {
            this.container.style.overflowY = 'hidden';
            this.container.style.maxHeight = '';
        }

        this.updateControls();
    }

    /**
     * 清除所有分页隐藏状态
     */
    private clearPages(): void {
        this.container.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(el => {
            el.classList.remove(HIDDEN_CLASS);
        });
        this.container.style.overflowY = '';
        this.container.style.maxHeight = '';
    }

    // ==================== 控制栏 ====================

    /**
     * 创建两侧翻页按钮和底部进度条
     */
    private createControls(): void {
        // 底部进度条 + 页码
        this.controlsEl = document.createElement('div');
        this.controlsEl.className = 'deeppdf-page-controls';

        this.progressFillEl = document.createElement('div');
        this.progressFillEl.className = 'deeppdf-page-progress-fill';

        const progressBar = document.createElement('div');
        progressBar.className = 'deeppdf-page-progress-bar';
        progressBar.appendChild(this.progressFillEl);

        this.pageIndicatorEl = document.createElement('span');
        this.pageIndicatorEl.className = 'deeppdf-page-indicator';

        this.controlsEl.appendChild(progressBar);
        this.controlsEl.appendChild(this.pageIndicatorEl);
        this.container.appendChild(this.controlsEl);

        // 两侧翻页按钮
        this.leftBtnEl = document.createElement('button');
        this.leftBtnEl.className = 'deeppdf-page-btn left';
        this.leftBtnEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
        this.leftBtnEl.setAttribute('aria-label', '上一页');
        this.leftBtnEl.addEventListener('click', () => this.prevPage());

        this.rightBtnEl = document.createElement('button');
        this.rightBtnEl.className = 'deeppdf-page-btn right';
        this.rightBtnEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
        this.rightBtnEl.setAttribute('aria-label', '下一页');
        this.rightBtnEl.addEventListener('click', () => this.nextPage());

        document.body.appendChild(this.leftBtnEl);
        document.body.appendChild(this.rightBtnEl);
    }

    /**
     * 更新控制栏状态（进度、按钮可见性）
     */
    private updateControls(): void {
        if (!this.active) return;

        const total = this.pages.length;
        const current = this.currentPageIndex + 1; // 1-based for display

        // 进度条
        if (this.progressFillEl) {
            const percent = total > 1 ? ((current - 1) / (total - 1)) * 100 : 0;
            this.progressFillEl.style.width = `${percent}%`;
        }

        // 页码
        if (this.pageIndicatorEl) {
            this.pageIndicatorEl.textContent = `${current} / ${total}`;
        }

        // 两侧按钮
        if (this.leftBtnEl) {
            this.leftBtnEl.classList.toggle('deeppdf-page-btn-disabled', current === 1);
        }
        if (this.rightBtnEl) {
            this.rightBtnEl.classList.toggle('deeppdf-page-btn-disabled', current === total);
        }
    }

    /**
     * 移除所有控制元素
     */
    private removeControls(): void {
        this.controlsEl?.remove();
        this.controlsEl = null;
        this.leftBtnEl?.remove();
        this.leftBtnEl = null;
        this.rightBtnEl?.remove();
        this.rightBtnEl = null;
        this.progressFillEl = null;
        this.pageIndicatorEl = null;
    }

    // ==================== 响应式 ====================

    /**
     * 监听视口变化，重新分页
     */
    private setupResizeObserver(): void {
        this.resizeObserver = new ResizeObserver(() => {
            if (this.resizeDebounceTimer !== null) {
                clearTimeout(this.resizeDebounceTimer);
            }
            this.resizeDebounceTimer = window.setTimeout(() => {
                this.handleResize();
            }, 300);
        });
        this.resizeObserver.observe(document.body);
    }

    private teardownResizeObserver(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        if (this.resizeDebounceTimer !== null) {
            clearTimeout(this.resizeDebounceTimer);
            this.resizeDebounceTimer = null;
        }
    }

    /**
     * 视口变化时重新分页，恢复到之前的阅读进度
     */
    private handleResize(): void {
        if (!this.active) return;

        const progressRatio = this.pages.length > 1
            ? this.currentPageIndex / (this.pages.length - 1)
            : 0;

        // 重新计算分页
        this.clearPages();
        const blocks = this.collectBlocks();
        const availableHeight = this.getAvailableHeight();
        this.pages = this.groupIntoPages(blocks, availableHeight);

        if (this.pages.length <= 1) {
            this.destroy();
            return;
        }

        // 恢复到接近的页面位置
        const newPage = Math.min(
            Math.round(progressRatio * (this.pages.length - 1)),
            this.pages.length - 1
        );
        this.showPage(newPage);

        serviceLog(`[Paginator] Resized: ${this.pages.length} pages, restored to page ${newPage + 1}`);
    }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run src/components/reading-mode/__tests__/page-paginator.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/reading-mode/page-paginator.ts src/components/reading-mode/__tests__/page-paginator.test.ts
git commit -m "feat: add PagePaginator core logic with dynamic height-based pagination"
```

---

## Chunk 2: Styles and Visual Integration

### Task 3: Add pagination CSS styles

**Files:**
- Modify: `src/components/reading-mode/reading-mode.css`

- [ ] **Step 1: Append pagination styles at the end of reading-mode.css**

Add after the existing styles (after the `mark[data-excerpt]` section):

```css
/* ==================== 分页样式 ==================== */

/* 隐藏非当前页的元素 */
.deeppdf-page-hidden {
    display: none !important;
}

/* 两侧翻页按钮 */
.deeppdf-page-btn {
    position: fixed;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    color: var(--text-muted);
    opacity: 0.15;
    cursor: pointer;
    transition: opacity 0.2s ease, background 0.2s ease;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
}

.deeppdf-page-btn.left {
    left: 20px;
}

.deeppdf-page-btn.right {
    right: 20px;
}

.deeppdf-page-btn:hover:not(.deeppdf-page-btn-disabled) {
    opacity: 0.7;
    background: var(--background-modifier-hover);
    color: var(--text-normal);
}

.deeppdf-page-btn-disabled {
    opacity: 0 !important;
    pointer-events: none;
}

/* 底部分页控制栏 */
.deeppdf-page-controls {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 0 8px;
    margin-top: 1em;
    width: 100%;
    box-sizing: border-box;
}

/* 进度条 */
.deeppdf-page-progress-bar {
    flex: 1;
    height: 3px;
    background: var(--background-modifier-border);
    border-radius: 2px;
    overflow: hidden;
}

.deeppdf-page-progress-fill {
    height: 100%;
    background: var(--interactive-accent);
    border-radius: 2px;
    transition: width 0.2s ease;
}

/* 页码指示器 */
.deeppdf-page-indicator {
    color: var(--text-muted);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    padding: 4px 10px;
    background: var(--background-secondary-alt);
    border-radius: 4px;
}
```

- [ ] **Step 2: Verify CSS is included in build**

- [ ] **Step 3: Export PagePaginator from index.ts**

In `src/components/reading-mode/index.ts`, append:

```typescript
export { PagePaginator } from './page-paginator.js';
export type { PagePaginatorOptions } from './page-paginator.js';
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds. CSS is loaded via `src/styles/main.css:28` (`@import url('../components/reading-mode/reading-mode.css')`).

- [ ] **Step 5: Commit**

```bash
git add src/components/reading-mode/reading-mode.css
git commit -m "feat: add pagination CSS styles (side buttons, progress bar, page controls)"
```

---

## Chunk 3: Integration with ReadingModeService

### Task 4: Integrate PagePaginator into ReadingModeService

**Files:**
- Modify: `src/services/reading-mode-service.ts`

- [ ] **Step 1: Add import and property**

At the top of `reading-mode-service.ts`, add the import:

```typescript
import { PagePaginator } from '../components/reading-mode/page-paginator.js';
```

Add a new private property to `ReadingModeService` class (after `private chapterNav`):

```typescript
private paginator: PagePaginator | null = null;
```

- [ ] **Step 2: Initialize paginator in activate()**

In the `activate(file)` method, replace the existing `setTimeout` block:

**Before:**
```typescript
setTimeout(() => {
    serviceLog('[DeepPDF] ReadingMode: calling chapterNav.update()');
    this.chapterNav?.update();
}, 100);
```

**After:**
```typescript
setTimeout(() => {
    serviceLog('[DeepPDF] ReadingMode: calling chapterNav.update()');
    this.chapterNav?.update();

    // 初始化分页器
    this.initPaginator();
}, 200);
```

- [ ] **Step 3: Add initPaginator() method**

Add this method after `initChapterNav()`:

```typescript
/**
 * 初始化分页器
 */
private initPaginator(): void {
    // 销毁旧的分页器
    this.paginator?.destroy();
    this.paginator = null;

    // 找到渲染容器（仅使用 .markdown-preview-sizer，其他容器包含 padding 会导致高度计算不准确）
    const container = document.querySelector('.markdown-preview-sizer') as HTMLElement;

    if (!container) {
        serviceLog.warn('[ReadingMode] Paginator: container not found');
        return;
    }

    this.paginator = new PagePaginator({
        container,
        onNavigatePrev: () => this.navigateToPrev(),
        onNavigateNext: () => this.navigateToNext(),
    });

    this.paginator.paginateAndShow();
    serviceLog('[ReadingMode] Paginator initialized');
}
```

- [ ] **Step 4: Add cleanup in deactivate()**

In the `deactivate()` method, add paginator cleanup before the existing code:

```typescript
deactivate(): void {
    if (!this.isActive) return;

    this.paginator?.destroy();
    this.paginator = null;

    document.body.classList.remove('deeppdf-reading-mode');
    // ... rest unchanged ...
}
```

- [ ] **Step 5: Add cleanup in stop()**

In the `stop()` method, add paginator cleanup after chapterNav cleanup:

```typescript
if (this.paginator) {
    this.paginator.destroy();
    this.paginator = null;
}
```

- [ ] **Step 6: Expose paginator for ChapterNav keyboard routing**

Add a public getter method:

```typescript
/**
 * 获取分页器实例（供 ChapterNav 路由键盘事件）
 */
getPaginator(): PagePaginator | null {
    return this.paginator;
}
```

- [ ] **Step 7: Run build to verify compilation**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors

- [ ] **Step 8: Commit**

```bash
git add src/services/reading-mode-service.ts
git commit -m "feat: integrate PagePaginator into ReadingModeService lifecycle"
```

---

### Task 5: Update ChapterNav keyboard routing

**Files:**
- Modify: `src/components/reading-mode/chapter-nav.ts`

- [ ] **Step 1: Add paginator reference to ChapterNavOptions**

Update the `ChapterNavOptions` interface:

```typescript
export interface ChapterNavOptions {
    app: App;
    onNavigatePrev: () => Promise<boolean>;
    onNavigateNext: () => Promise<boolean>;
    getNavigation: () => { prev: TFile | null; next: TFile | null; currentIndex: number; total: number } | null;
    getPaginator?: () => { nextPage: () => boolean; prevPage: () => boolean; isActive: () => boolean } | null;  // 新增
}
```

- [ ] **Step 2: Update handleKeyDown to route through paginator**

Replace the existing arrow key handling in `handleKeyDown()`:

**Before (lines 110-119):**
```typescript
// 左箭头：上一章
if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    this.options.onNavigatePrev();
}
// 右箭头：下一章
if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    this.options.onNavigateNext();
}
```

**After:**
```typescript
// 左箭头：上一页 or 上一章
if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    const paginator = this.options.getPaginator?.();
    if (paginator?.isActive()) {
        paginator.prevPage(); // 内部会在第一页时触发 onNavigatePrev
    } else {
        this.options.onNavigatePrev();
    }
}
// 右箭头：下一页 or 下一章
if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    const paginator = this.options.getPaginator?.();
    if (paginator?.isActive()) {
        paginator.nextPage(); // 内部会在最后一页时触发 onNavigateNext
    } else {
        this.options.onNavigateNext();
    }
}
```

- [ ] **Step 3: Pass paginator getter in initChapterNav()**

In `reading-mode-service.ts`, update `initChapterNav()`:

**Before:**
```typescript
this.chapterNav = new ChapterNav({
    app: this.app,
    onNavigatePrev: () => this.navigateToPrev(),
    onNavigateNext: () => this.navigateToNext(),
    getNavigation: () => this.getChapterNavigation(),
});
```

**After:**
```typescript
this.chapterNav = new ChapterNav({
    app: this.app,
    onNavigatePrev: () => this.navigateToPrev(),
    onNavigateNext: () => this.navigateToNext(),
    getNavigation: () => this.getChapterNavigation(),
    getPaginator: () => this.paginator,
});
```

- [ ] **Step 4: Run tests and build**

Run: `npm run test:run && npm run build`
Expected: All tests pass, build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/components/reading-mode/chapter-nav.ts src/services/reading-mode-service.ts
git commit -m "feat: unify keyboard navigation — page-first, chapter-on-boundary"
```

---

## Chunk 4: Edge Cases and Polish

### Task 6: Handle image loading and timing robustness

**Files:**
- Modify: `src/components/reading-mode/page-paginator.ts`

- [ ] **Step 1: Add image load listener for re-pagination**

Add this method to `PagePaginator` class, called at the end of `paginateAndShow()`:

```typescript
/**
 * 监听图片加载完成后重新分页
 */
private setupImageLoadListeners(): void {
    const images = this.container.querySelectorAll('img');
    if (images.length === 0) return;

    let pendingImages = 0;
    const onImageReady = () => {
        pendingImages--;
        if (pendingImages <= 0) {
            // 所有图片就绪后重算一次
            this.handleResize();
        }
    };

    images.forEach(img => {
        if (!(img as HTMLImageElement).complete) {
            pendingImages++;
            img.addEventListener('load', onImageReady, { once: true });
            img.addEventListener('error', onImageReady, { once: true });
        }
    });
}
```

Call it at the end of `paginateAndShow()`:

```typescript
// 在 paginateAndShow() 末尾，this.showPage(0) 之后添加：
this.setupImageLoadListeners();
```

- [ ] **Step 2: Update activate() timing in reading-mode-service.ts**

**注意：此步骤替换 Task 4 Step 2 中添加的 `this.initPaginator()` 调用。** Task 4 的 `initPaginator()` 方法保留不变，但 `activate()` 中的调用方式从直接调用改为通过轮询等待渲染完成后再调用。

在 `ReadingModeService` 中添加新方法（`initPaginator()` 之后）：

```typescript
/**
 * 等待 Obsidian 渲染完成后初始化分页
 * 内部调用 initPaginator()
 */
private waitForRenderAndInitPaginator(): void {
    const maxAttempts = 10;
    const interval = 100;
    let attempts = 0;

    const tryInit = () => {
        attempts++;
        const sizer = document.querySelector('.markdown-preview-sizer') as HTMLElement;
        if (sizer && sizer.children.length > 0) {
            this.initPaginator();
            return;
        }
        if (attempts < maxAttempts) {
            setTimeout(tryInit, interval);
        } else {
            serviceLog.warn('[ReadingMode] Paginator: rendering not detected after timeout');
        }
    };

    tryInit();
}
```

然后在 `activate()` 的 setTimeout 块中，将 Task 4 Step 2 添加的 `this.initPaginator()` 替换为：

```typescript
setTimeout(() => {
    serviceLog('[DeepPDF] ReadingMode: calling chapterNav.update()');
    this.chapterNav?.update();

    // 等待渲染完成后初始化分页器（替换 Task 4 中的 this.initPaginator()）
    this.waitForRenderAndInitPaginator();
}, 200);
```

- [ ] **Step 3: Run tests and build**

Run: `npm run test:run && npm run build`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/components/reading-mode/page-paginator.ts src/services/reading-mode-service.ts
git commit -m "fix: handle image loading and robust render timing for pagination"
```

---

### Task 7: Final integration test

**Files:**
- Modify: `src/components/reading-mode/__tests__/page-paginator.test.ts`

- [ ] **Step 1: Add integration-level tests**

Append to the test file:

```typescript
describe('PagePaginator integration', () => {
    let container: HTMLElement;
    let onNavigatePrev: ReturnType<typeof vi.fn>;
    let onNavigateNext: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        container = document.createElement('div');
        container.className = 'markdown-preview-sizer';
        document.body.appendChild(container);
        onNavigatePrev = vi.fn().mockResolvedValue(true);
        onNavigateNext = vi.fn().mockResolvedValue(true);
    });

    afterEach(() => {
        container.remove();
    });

    it('should handle window resize gracefully', () => {
        const paragraphs: HTMLElement[] = [];
        for (let i = 0; i < 20; i++) {
            const p = document.createElement('p');
            p.textContent = 'A'.repeat(500);
            container.appendChild(p);
            paragraphs.push(p);
            Object.defineProperty(p, 'offsetHeight', { value: 150, configurable: true });
        }

        const paginator = new PagePaginator({
            container,
            onNavigatePrev,
            onNavigateNext,
        });
        vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(500);
        paginator.paginateAndShow();

        const originalTotalPages = paginator.getTotalPages();
        expect(originalTotalPages).toBeGreaterThan(1);

        // Navigate to middle
        paginator.nextPage();
        paginator.nextPage();

        // Simulate resize — bigger viewport means fewer pages
        vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(900);
        (paginator as any).handleResize();

        // Should still be active but with fewer pages
        expect(paginator.isActive()).toBe(true);
        expect(paginator.getTotalPages()).toBeLessThan(originalTotalPages);
    });

    it('should deactivate if resize makes content fit one page', () => {
        for (let i = 0; i < 4; i++) {
            const p = document.createElement('p');
            p.textContent = 'A'.repeat(200);
            container.appendChild(p);
            Object.defineProperty(p, 'offsetHeight', { value: 200, configurable: true });
        }

        const paginator = new PagePaginator({
            container,
            onNavigatePrev,
            onNavigateNext,
        });

        // First with small viewport → paginated
        vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(300);
        paginator.paginateAndShow();
        expect(paginator.isActive()).toBe(true);

        // Resize to huge viewport → fits one page
        vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(5000);
        (paginator as any).handleResize();
        expect(paginator.isActive()).toBe(false);
    });

    it('should not include chapter nav or page controls in blocks', () => {
        // Add a fake chapter nav
        const nav = document.createElement('div');
        nav.className = 'deeppdf-chapter-nav';
        container.appendChild(nav);

        // Add real content
        for (let i = 0; i < 10; i++) {
            const p = document.createElement('p');
            p.textContent = 'A'.repeat(500);
            container.appendChild(p);
            Object.defineProperty(p, 'offsetHeight', { value: 200, configurable: true });
        }

        const paginator = new PagePaginator({
            container,
            onNavigatePrev,
            onNavigateNext,
        });
        vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(400);
        paginator.paginateAndShow();

        // Chapter nav should not be in any page
        for (const page of (paginator as any).pages) {
            expect(page).not.toContain(nav);
        }
    });
});
```

- [ ] **Step 2: Run all tests**

Run: `npm run test:run`
Expected: All pass

- [ ] **Step 3: Final build check**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/components/reading-mode/__tests__/page-paginator.test.ts
git commit -m "test: add integration tests for PagePaginator resize and edge cases"
```

---

## Summary of Changes

| File | Action | Purpose |
|------|--------|---------|
| `src/components/reading-mode/page-paginator.ts` | Create | Core pagination class |
| `src/components/reading-mode/__tests__/page-paginator.test.ts` | Create | Unit + integration tests |
| `src/components/reading-mode/reading-mode.css` | Modify | Pagination styles |
| `src/components/reading-mode/index.ts` | Modify | Export PagePaginator |
| `src/services/reading-mode-service.ts` | Modify | Paginator lifecycle + render timing |
| `src/components/reading-mode/chapter-nav.ts` | Modify | Keyboard routing through paginator |

Total: 2 new files, 4 modified files, 7 tasks, 7 commits
