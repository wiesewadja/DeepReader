/**
 * PagePaginator 单元测试
 *
 * 验证动态高度分页逻辑：
 * - 内容不足一页时不激活
 * - 内容溢出时正确分页
 * - 元素不被拆分到两页
 * - 导航逻辑（首页、下一页、上一页、边界回调）
 * - destroy 恢复所有元素
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PagePaginator, PagePaginatorOptions } from '@/components/reading-mode/page-paginator';

// ============================================================================
// Mocks：jsdom 不提供 ResizeObserver
// ============================================================================

class MockResizeObserver {
	private callback: ResizeObserverCallback;
	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
	}
	observe() {}
	unobserve() {}
	disconnect() {}
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * 创建带 class="markdown-preview-sizer" 的 mock 容器
 * 并挂载到 document.body（jsdom）
 */
function createContainer(): HTMLElement {
	const container = document.createElement('div');
	container.className = 'markdown-preview-sizer';
	document.body.appendChild(container);
	return container;
}

/**
 * 创建指定高度的 block 元素
 * jsdom 中 offsetHeight 默认为 0，需要手动 mock
 */
function createBlock(height: number, tag = 'div'): HTMLElement {
	const el = document.createElement(tag);
	Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true });
	return el;
}

/**
 * 清理容器
 */
function cleanup() {
	// 移除所有 deeppdf-page-btn / deeppdf-page-controls
	document.querySelectorAll('.deeppdf-page-btn, .deeppdf-page-controls').forEach(el => el.remove());
	// 移除测试容器
	document.querySelectorAll('.markdown-preview-sizer').forEach(el => el.remove());
}

// ============================================================================
// 测试用例
// ============================================================================

describe.skip('PagePaginator', () => {
	let container: HTMLElement;
	let onNavigatePrev: ReturnType<typeof vi.fn>;
	let onNavigateNext: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		cleanup();
		// 注入 ResizeObserver mock
		(global as any).ResizeObserver = MockResizeObserver;
		container = createContainer();
		onNavigatePrev = vi.fn().mockResolvedValue(true);
		onNavigateNext = vi.fn().mockResolvedValue(true);
	});

	afterEach(() => {
		cleanup();
		delete (global as any).ResizeObserver;
	});

	// ----------------------------------------------------------------
	// paginate()
	// ----------------------------------------------------------------

	describe('paginate()', () => {
		it('should not activate when content fits in one page', () => {
			// 总内容 200px，可用高度 500px
			const block1 = createBlock(100);
			const block2 = createBlock(100);
			container.appendChild(block1);
			container.appendChild(block2);

			const options: PagePaginatorOptions = {
				container,
				onNavigatePrev,
				onNavigateNext,
			};
			const paginator = new PagePaginator(options);

			// mock getAvailableHeight 返回 500
			vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(500);

			paginator.paginateAndShow();

			expect(paginator.isActive()).toBe(false);
			expect(paginator.getTotalPages()).toBe(0);
		});

		it('should split content into multiple pages when content overflows', () => {
			// 可用高度 200px，总内容 500px -> 至少 3 页
			const block1 = createBlock(100);
			const block2 = createBlock(100);
			const block3 = createBlock(100);
			const block4 = createBlock(100);
			const block5 = createBlock(100);
			container.append(block1, block2, block3, block4, block5);

			const options: PagePaginatorOptions = {
				container,
				onNavigatePrev,
				onNavigateNext,
			};
			const paginator = new PagePaginator(options);
			vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(200);

			paginator.paginateAndShow();

			expect(paginator.isActive()).toBe(true);
			expect(paginator.getTotalPages()).toBe(3);
		});

		it('should keep elements whole (never split across pages)', () => {
			// 可用高度 150px
			// block1: 100px -> page1, 累计 100
			// block2: 80px -> 100+80=180 > 150 -> page2
			// block3: 60px -> 80+60=140 -> page2, 累计 140
			// block4: 50px -> 140+50=190 > 150 -> page3
			const block1 = createBlock(100);
			const block2 = createBlock(80);
			const block3 = createBlock(60);
			const block4 = createBlock(50);
			container.append(block1, block2, block3, block4);

			const options: PagePaginatorOptions = {
				container,
				onNavigatePrev,
				onNavigateNext,
			};
			const paginator = new PagePaginator(options);
			vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(150);

			paginator.paginateAndShow();

			expect(paginator.isActive()).toBe(true);
			expect(paginator.getTotalPages()).toBe(3);
			// 验证第 1 页只包含 block1
			expect(block1.classList.contains('deeppdf-page-hidden')).toBe(false);
			// block2 在第 2 页，初始显示第 1 页，应该被隐藏
			expect(block2.classList.contains('deeppdf-page-hidden')).toBe(true);
		});

		it('should not activate for a single super-tall block (only 1 page)', () => {
			// 可用高度 200px，单块 500px -> 1 页，按设计不激活
			const block1 = createBlock(500);
			container.appendChild(block1);

			const options: PagePaginatorOptions = {
				container,
				onNavigatePrev,
				onNavigateNext,
			};
			const paginator = new PagePaginator(options);
			vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(200);

			paginator.paginateAndShow();

			// 单块即使超高也只有 1 页，按设计不激活分页
			expect(paginator.isActive()).toBe(false);
		});

		it('should exclude chapter nav, page controls, and frontmatter elements', () => {
			const block1 = createBlock(300);
			const nav = createBlock(100);
			nav.className = 'deeppdf-chapter-nav';
			const controls = createBlock(100);
			controls.className = 'deeppdf-page-controls';
			const frontmatter = createBlock(100);
			frontmatter.className = 'frontmatter';
			container.append(block1, nav, controls, frontmatter);

			const options: PagePaginatorOptions = {
				container,
				onNavigatePrev,
				onNavigateNext,
			};
			const paginator = new PagePaginator(options);
			vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(400);

			paginator.paginateAndShow();

			// 只有 block1 被计入，不溢出所以不激活
			expect(paginator.isActive()).toBe(false);
		});
	});

	// ----------------------------------------------------------------
	// navigation
	// ----------------------------------------------------------------

	describe('navigation', () => {
		function createMultiPagePaginator(): PagePaginator {
			// 可用高度 100px，5 个 block 每个 60px -> 5 页
			for (let i = 0; i < 5; i++) {
				container.appendChild(createBlock(60));
			}
			const options: PagePaginatorOptions = {
				container,
				onNavigatePrev,
				onNavigateNext,
			};
			const paginator = new PagePaginator(options);
			vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(100);
			paginator.paginateAndShow();
			return paginator;
		}

		it('should show first page initially', () => {
			const paginator = createMultiPagePaginator();
			expect(paginator.getCurrentPage()).toBe(1);
		});

		it('nextPage() should advance to next page', () => {
			const paginator = createMultiPagePaginator();
			const result = paginator.nextPage();
			expect(result).toBe(true);
			expect(paginator.getCurrentPage()).toBe(2);
		});

		it('nextPage() on last page should call onNavigateNext', () => {
			const paginator = createMultiPagePaginator();
			// 跳到最后一页
			for (let i = 0; i < paginator.getTotalPages() - 1; i++) {
				paginator.nextPage();
			}
			expect(paginator.getCurrentPage()).toBe(paginator.getTotalPages());

			// 再翻页触发回调
			const result = paginator.nextPage();
			expect(result).toBe(false);
			expect(onNavigateNext).toHaveBeenCalled();
		});

		it('prevPage() on first page should call onNavigatePrev', () => {
			const paginator = createMultiPagePaginator();
			expect(paginator.getCurrentPage()).toBe(1);

			const result = paginator.prevPage();
			expect(result).toBe(false);
			expect(onNavigatePrev).toHaveBeenCalled();
		});

		it('prevPage() should go back to previous page', () => {
			const paginator = createMultiPagePaginator();
			paginator.nextPage();
			paginator.nextPage();
			expect(paginator.getCurrentPage()).toBe(3);

			const result = paginator.prevPage();
			expect(result).toBe(true);
			expect(paginator.getCurrentPage()).toBe(2);
		});
	});

	// ----------------------------------------------------------------
	// destroy()
	// ----------------------------------------------------------------

	describe('destroy()', () => {
		it('should restore all elements to visible', () => {
			const block1 = createBlock(100);
			const block2 = createBlock(100);
			const block3 = createBlock(100);
			container.append(block1, block2, block3);

			const options: PagePaginatorOptions = {
				container,
				onNavigatePrev,
				onNavigateNext,
			};
			const paginator = new PagePaginator(options);
			vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(100);
			paginator.paginateAndShow();

			// 此时应该有一些元素被隐藏
			const hiddenBefore = container.querySelectorAll('.deeppdf-page-hidden');
			expect(hiddenBefore.length).toBeGreaterThan(0);

			paginator.destroy();

			// 销毁后所有元素可见
			const hiddenAfter = container.querySelectorAll('.deeppdf-page-hidden');
			expect(hiddenAfter.length).toBe(0);
			expect(paginator.isActive()).toBe(false);
		});

		it('should remove all control elements', () => {
			container.appendChild(createBlock(200));
			container.appendChild(createBlock(200));

			const options: PagePaginatorOptions = {
				container,
				onNavigatePrev,
				onNavigateNext,
			};
			const paginator = new PagePaginator(options);
			vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(100);
			paginator.paginateAndShow();

			// 验证控制元素已创建
			expect(document.querySelectorAll('.deeppdf-page-btn').length).toBeGreaterThan(0);
			expect(container.querySelectorAll('.deeppdf-page-controls').length).toBeGreaterThan(0);

			paginator.destroy();

			// 销毁后控制元素已移除
			expect(document.querySelectorAll('.deeppdf-page-btn').length).toBe(0);
			expect(container.querySelectorAll('.deeppdf-page-controls').length).toBe(0);
		});
	});
});

describe.skip('PagePaginator integration', () => {
	let container: HTMLElement;
	let onNavigatePrev: ReturnType<typeof vi.fn>;
	let onNavigateNext: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		(global as any).ResizeObserver = MockResizeObserver;
		container = document.createElement('div');
		container.className = 'markdown-preview-sizer';
		document.body.appendChild(container);
		onNavigatePrev = vi.fn().mockResolvedValue(true);
		onNavigateNext = vi.fn().mockResolvedValue(true);
	});

	afterEach(() => {
		document.querySelectorAll('.deeppdf-page-btn, .deeppdf-page-controls').forEach(el => el.remove());
		container.remove();
		delete (global as any).ResizeObserver;
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

		paginator.nextPage();
		paginator.nextPage();

		vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(900);
		(paginator as any).handleResize();

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

		vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(300);
		paginator.paginateAndShow();
		expect(paginator.isActive()).toBe(true);

		vi.spyOn(paginator as any, 'getAvailableHeight').mockReturnValue(5000);
		(paginator as any).handleResize();
		expect(paginator.isActive()).toBe(false);
	});

	it('should not include chapter nav or page controls in blocks', () => {
		const nav = document.createElement('div');
		nav.className = 'deeppdf-chapter-nav';
		container.appendChild(nav);

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

		for (const page of (paginator as any).pages) {
			expect(page).not.toContain(nav);
		}
	});
});

// ============================================================================
// PagePaginator (multi-column) - 边界与状态发散
//
// 覆盖核心 bug：smooth scroll 进行中 _currentPage 滞后，章节末页按 → 误回前章
// 与 forceRerender 残留 rAF 在 destroy 后污染 DOM
// ============================================================================

/**
 * 构造完整 DOM 层级：
 *   .view-content > .markdown-preview-view > .markdown-preview-sizer
 * 并赋值 scrollWidth/clientWidth 让 multi-column 分页逻辑可计算
 */
function createMultiColumnDom(opts: { clientWidth: number; scrollWidth: number; scrollLeft?: number }) {
	const viewContent = document.createElement('div');
	viewContent.className = 'view-content';
	const scrollView = document.createElement('div');
	scrollView.className = 'markdown-preview-view';
	const sizer = document.createElement('div');
	sizer.className = 'markdown-preview-sizer';
	scrollView.appendChild(sizer);
	viewContent.appendChild(scrollView);
	document.body.appendChild(viewContent);

	Object.defineProperty(scrollView, 'clientWidth', { value: opts.clientWidth, configurable: true });
	Object.defineProperty(scrollView, 'scrollWidth', { value: opts.scrollWidth, configurable: true });
	// scrollLeft 用普通字段（jsdom 默认就支持赋值/读取）
	scrollView.scrollLeft = opts.scrollLeft ?? 0;
	// jsdom 不提供 scrollBy；定义一个 noop 让 spyOn 能挂上去
	(scrollView as any).scrollBy = () => {};

	return { viewContent, scrollView, sizer };
}

describe('PagePaginator (multi-column) - 边界与状态发散', () => {
	let onNavigatePrev: ReturnType<typeof vi.fn>;
	let onNavigateNext: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		(global as any).ResizeObserver = MockResizeObserver;
		onNavigatePrev = vi.fn().mockResolvedValue(true);
		onNavigateNext = vi.fn().mockResolvedValue(true);
	});

	afterEach(() => {
		document.body.innerHTML = '';
		delete (global as any).ResizeObserver;
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	/**
	 * 创建已激活的 paginator，绕过 paginateAndShow 中的 rAF / observer 副作用
	 * 直接植入私有字段，让我们可以独立测试 nextPage/prevPage/isAtLastPage 边界
	 */
	function makeActivePaginator(args: {
		clientWidth: number;
		scrollWidth: number;
		scrollLeft: number;
		totalPages: number;
		currentPage: number;
	}): { paginator: PagePaginator; scrollView: HTMLElement } {
		const { sizer, scrollView } = createMultiColumnDom({
			clientWidth: args.clientWidth,
			scrollWidth: args.scrollWidth,
			scrollLeft: args.scrollLeft,
		});
		const paginator = new PagePaginator({
			container: sizer,
			onNavigatePrev,
			onNavigateNext,
			hasPrevChapter: () => true,
			hasNextChapter: () => true,
		});
		(paginator as any)._isActive = true;
		(paginator as any)._totalPages = args.totalPages;
		(paginator as any)._currentPage = args.currentPage;
		return { paginator, scrollView };
	}

	it('isAtLastPage() returns true when scrollLeft + clientWidth >= scrollWidth - 1', () => {
		const { paginator } = makeActivePaginator({
			clientWidth: 800,
			scrollWidth: 2400,        // 3 页
			scrollLeft: 1600,         // 滚到最后一页起始
			totalPages: 3,
			currentPage: 3,
		});
		expect(paginator.isAtLastPage()).toBe(true);
	});

	it('isAtLastPage() returns true even when _currentPage is stale (smooth scroll 滞后)', () => {
		// 核心 bug：DOM 已经滚到最后一页，但 _currentPage 还停在 2
		const { paginator } = makeActivePaginator({
			clientWidth: 800,
			scrollWidth: 2400,
			scrollLeft: 1600,         // 已在末页
			totalPages: 3,
			currentPage: 2,           // 缓存滞后
		});
		expect(paginator.isAtLastPage()).toBe(true);
	});

	it('isAtFirstPage() returns true when scrollLeft is 0 even if _currentPage is stale', () => {
		const { paginator } = makeActivePaginator({
			clientWidth: 800,
			scrollWidth: 2400,
			scrollLeft: 0,
			totalPages: 3,
			currentPage: 2,           // 缓存滞后
		});
		expect(paginator.isAtFirstPage()).toBe(true);
	});

	it('nextPage() calls onNavigateNext when isAtLastPage is true regardless of _currentPage', () => {
		const { paginator, scrollView } = makeActivePaginator({
			clientWidth: 800,
			scrollWidth: 2400,
			scrollLeft: 1600,         // 已在末页
			totalPages: 3,
			currentPage: 2,           // 缓存滞后（关键回归点）
		});
		const scrollBySpy = vi.spyOn(scrollView, 'scrollBy').mockImplementation(() => {});

		const result = paginator.nextPage();

		expect(result).toBe(false);
		expect(onNavigateNext).toHaveBeenCalledTimes(1);
		expect(scrollBySpy).not.toHaveBeenCalled();
	});

	it('nextPage() does NOT call onNavigateNext when not at end (should call scrollBy)', () => {
		const { paginator, scrollView } = makeActivePaginator({
			clientWidth: 800,
			scrollWidth: 2400,
			scrollLeft: 0,            // 在第 1 页
			totalPages: 3,
			currentPage: 1,
		});
		const scrollBySpy = vi.spyOn(scrollView, 'scrollBy').mockImplementation(() => {});

		const result = paginator.nextPage();

		expect(result).toBe(true);
		expect(onNavigateNext).not.toHaveBeenCalled();
		expect(scrollBySpy).toHaveBeenCalledTimes(1);
		expect(scrollBySpy.mock.calls[0][0]).toMatchObject({ left: 800 });
	});

	it('prevPage() calls onNavigatePrev when isAtFirstPage is true even with stale _currentPage', () => {
		const { paginator, scrollView } = makeActivePaginator({
			clientWidth: 800,
			scrollWidth: 2400,
			scrollLeft: 0,            // 已在首页
			totalPages: 3,
			currentPage: 2,           // 缓存滞后
		});
		const scrollBySpy = vi.spyOn(scrollView, 'scrollBy').mockImplementation(() => {});

		const result = paginator.prevPage();

		expect(result).toBe(false);
		expect(onNavigatePrev).toHaveBeenCalledTimes(1);
		expect(scrollBySpy).not.toHaveBeenCalled();
	});

	it('destroy() cancels pending rAFs from forceRerender', () => {
		const { paginator, scrollView } = makeActivePaginator({
			clientWidth: 800,
			scrollWidth: 2400,
			scrollLeft: 0,
			totalPages: 3,
			currentPage: 1,
		});
		// 为 forceRerender 提供 CSS 变量初值
		scrollView.style.setProperty('--deeppdf-col-width', '500px');

		// 捕获每次 requestAnimationFrame 的 id
		const rafIds: number[] = [];
		const realRaf = global.requestAnimationFrame;
		const realCaf = global.cancelAnimationFrame;
		let nextId = 1;
		const pending = new Map<number, FrameRequestCallback>();
		global.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
			const id = nextId++;
			pending.set(id, cb);
			rafIds.push(id);
			return id;
		}) as any;
		const cancelSpy = vi.fn((id: number) => {
			pending.delete(id);
		});
		global.cancelAnimationFrame = cancelSpy as any;

		try {
			(paginator as any).forceRerender();
			// forceRerender 第一层立刻排队一个 rAF
			expect(rafIds.length).toBeGreaterThanOrEqual(1);
			const queuedBeforeDestroy = pending.size;
			expect(queuedBeforeDestroy).toBeGreaterThan(0);

			paginator.destroy();

			// destroy 应取消所有挂起 rAF
			expect(cancelSpy).toHaveBeenCalled();
			expect(pending.size).toBe(0);
		} finally {
			global.requestAnimationFrame = realRaf;
			global.cancelAnimationFrame = realCaf;
		}
	});

	it('forceRerender mutations are skipped after destroy (no overflow override)', () => {
		const { paginator, scrollView } = makeActivePaginator({
			clientWidth: 800,
			scrollWidth: 2400,
			scrollLeft: 0,
			totalPages: 3,
			currentPage: 1,
		});
		scrollView.style.setProperty('--deeppdf-col-width', '500px');

		// 手动控制 rAF：把每个回调入队，destroy 后再 flush，验证它们都早退
		const callbacks: FrameRequestCallback[] = [];
		const realRaf = global.requestAnimationFrame;
		const realCaf = global.cancelAnimationFrame;
		// 注意：destroy 中的 cancelAnimationFrame 会从我们队列里清掉，本地实现要兼容
		const idToIdx = new Map<number, number>();
		let nextId = 1;
		global.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
			const id = nextId++;
			idToIdx.set(id, callbacks.length);
			callbacks.push(cb);
			return id;
		}) as any;
		global.cancelAnimationFrame = ((id: number) => {
			const idx = idToIdx.get(id);
			if (idx != null) callbacks[idx] = (() => {}) as FrameRequestCallback;
			idToIdx.delete(id);
		}) as any;

		try {
			(paginator as any).forceRerender();
			paginator.destroy();

			// destroy 把 scrollView ref 没断（destroy 不置空 scrollView），
			// 但 _isActive=false。手动 flush 队列，每个 cb 应早退
			scrollView.style.overflow = 'visible'; // sentinel
			while (callbacks.length > 0) {
				const cb = callbacks.shift()!;
				cb(0);
			}
			// 验证 forceRerender 内的 overflow='hidden' 没有覆盖我们的 sentinel
			expect(scrollView.style.overflow).toBe('visible');
		} finally {
			global.requestAnimationFrame = realRaf;
			global.cancelAnimationFrame = realCaf;
		}
	});
});

describe('PagePaginator - Dual-Page Mode', () => {
	let onNavigatePrev: ReturnType<typeof vi.fn>;
	let onNavigateNext: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		(global as any).ResizeObserver = MockResizeObserver;
		onNavigatePrev = vi.fn().mockResolvedValue(true);
		onNavigateNext = vi.fn().mockResolvedValue(true);
		// Mock the global app for isViewportFullyExpanded
		(global as any).app = {
			workspace: {
				rootSplit: { children: [{}] },
				leftSplit: { collapsed: true },
				rightSplit: { collapsed: true },
			},
		};
	});

	afterEach(() => {
		document.body.innerHTML = '';
		delete (global as any).ResizeObserver;
		delete (global as any).app;
		vi.restoreAllMocks();
	});

	function makeActiveDualPaginator(args: {
		clientWidth: number;
		scrollWidth: number;
		scrollLeft: number;
		totalPages: number;
		currentPage: number;
		autoDualPage?: boolean;
	}): { paginator: PagePaginator; scrollView: HTMLElement } {
		const { sizer, scrollView } = createMultiColumnDom({
			clientWidth: args.clientWidth,
			scrollWidth: args.scrollWidth,
			scrollLeft: args.scrollLeft,
		});
		const paginator = new PagePaginator({
			container: sizer,
			onNavigatePrev,
			onNavigateNext,
			hasPrevChapter: () => true,
			hasNextChapter: () => true,
			autoDualPage: args.autoDualPage ?? true,
		});
		(paginator as any)._isActive = true;
		(paginator as any)._totalPages = args.totalPages;
		(paginator as any)._currentPage = args.currentPage;
		return { paginator, scrollView };
	}

	it('should identify dual-page mode when layout is expanded and clientWidth >= 1400', () => {
		const { paginator } = makeActiveDualPaginator({
			clientWidth: 1500,
			scrollWidth: 3000,
			scrollLeft: 0,
			totalPages: 4,
			currentPage: 1,
		});
		expect(paginator.isDualPageMode).toBe(true);
	});

	it('should NOT identify dual-page mode when clientWidth < 1400', () => {
		const { paginator } = makeActiveDualPaginator({
			clientWidth: 1200,
			scrollWidth: 2400,
			scrollLeft: 0,
			totalPages: 4,
			currentPage: 1,
		});
		expect(paginator.isDualPageMode).toBe(false);
	});

	it('should NOT identify dual-page mode when autoDualPage option is false', () => {
		const { paginator } = makeActiveDualPaginator({
			clientWidth: 1500,
			scrollWidth: 3000,
			scrollLeft: 0,
			totalPages: 4,
			currentPage: 1,
			autoDualPage: false,
		});
		expect(paginator.isDualPageMode).toBe(false);
	});

	it('countActualPages should double logic pages in dual page mode', () => {
		const { paginator } = makeActiveDualPaginator({
			clientWidth: 1600,
			scrollWidth: 3200, // 2 screens
			scrollLeft: 0,
			totalPages: 0,
			currentPage: 1,
		});
		// Since each page is half width (800px), 3200px scrollWidth / 800px pageSize = 4 logical pages
		expect((paginator as any).countActualPages()).toBe(4);
	});

	it('nextPage/prevPage should jump by 2 pages in dual page mode', () => {
		const { paginator, scrollView } = makeActiveDualPaginator({
			clientWidth: 1600,
			scrollWidth: 3200,
			scrollLeft: 0,
			totalPages: 4,
			currentPage: 1,
		});
		const scrollBySpy = vi.spyOn(scrollView, 'scrollBy').mockImplementation(() => {});

		paginator.nextPage();
		expect(paginator.getCurrentPage()).toBe(3);

		// Simulate scroll to nextPage (non-zero scrollLeft)
		scrollView.scrollLeft = 1600;

		paginator.prevPage();
		expect(paginator.getCurrentPage()).toBe(1);
	});

	it('updateControls should show left-right range in dual-page mode', () => {
		const { paginator } = makeActiveDualPaginator({
			clientWidth: 1600,
			scrollWidth: 3200,
			scrollLeft: 0,
			totalPages: 4,
			currentPage: 1,
		});
		const mockIndicator = document.createElement('span');
		(paginator as any).pageIndicator = mockIndicator;

		(paginator as any).updateControls();
		expect(mockIndicator.textContent).toBe('1-2 / 4');
	});
});

