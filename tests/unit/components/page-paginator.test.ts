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
