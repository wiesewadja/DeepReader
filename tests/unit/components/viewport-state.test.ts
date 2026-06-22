import { describe, it, expect, vi } from 'vitest';
import { App } from 'obsidian';
import { isViewportFullyExpanded, getDualPageMetrics } from '@/components/reading-mode/viewport-state';

describe('isViewportFullyExpanded', () => {
	it('should return true when rootSplit has 1 child and both sidebars are collapsed', () => {
		const mockApp = {
			workspace: {
				rootSplit: { children: [{}] },
				leftSplit: { collapsed: true },
				rightSplit: { collapsed: true },
			},
		} as unknown as App;

		expect(isViewportFullyExpanded(mockApp)).toBe(true);
	});

	it('should return false when rootSplit has multiple children', () => {
		const mockApp = {
			workspace: {
				rootSplit: { children: [{}, {}] },
				leftSplit: { collapsed: true },
				rightSplit: { collapsed: true },
			},
		} as unknown as App;

		expect(isViewportFullyExpanded(mockApp)).toBe(false);
	});

	it('should return false when left sidebar is not collapsed', () => {
		const mockApp = {
			workspace: {
				rootSplit: { children: [{}] },
				leftSplit: { collapsed: false },
				rightSplit: { collapsed: true },
			},
		} as unknown as App;

		expect(isViewportFullyExpanded(mockApp)).toBe(false);
	});

	it('should return false when right sidebar is not collapsed', () => {
		const mockApp = {
			workspace: {
				rootSplit: { children: [{}] },
				leftSplit: { collapsed: true },
				rightSplit: { collapsed: false },
			},
		} as unknown as App;

		expect(isViewportFullyExpanded(mockApp)).toBe(false);
	});

	it('should return false if workspace or split objects are missing', () => {
		const mockApp = {
			workspace: {},
		} as unknown as App;

		expect(isViewportFullyExpanded(mockApp)).toBe(false);
	});
});

describe('getDualPageMetrics', () => {
	/** 构造带 mock clientWidth 与 computed style 的 scrollView */
	function makeScrollView(opts: {
		clientWidth: number;
		paddingLeft: number;
		paddingRight: number;
		columnGap: number;
	}): HTMLElement {
		const el = document.createElement('div');
		Object.defineProperty(el, 'clientWidth', { value: opts.clientWidth, configurable: true });
		vi.spyOn(window, 'getComputedStyle').mockReturnValue({
			paddingLeft: `${opts.paddingLeft}px`,
			paddingRight: `${opts.paddingRight}px`,
			columnGap: `${opts.columnGap}px`,
		} as CSSStyleDeclaration);
		return el;
	}

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('colStep = 列宽 + 列间距, spreadStep = 2 × colStep', () => {
		// clientWidth=1500, padding 左右各 50 → contentWidth=1400
		// colWidth = (1400 - 60) / 2 = 670, colStep = 730, spreadStep = 1460
		const el = makeScrollView({ clientWidth: 1500, paddingLeft: 50, paddingRight: 50, columnGap: 60 });
		const m = getDualPageMetrics(el);
		expect(m.paddingLeft).toBe(50);
		expect(m.paddingRight).toBe(50);
		expect(m.columnGap).toBe(60);
		expect(m.colStep).toBe(730);
		expect(m.spreadStep).toBe(1460);
	});

	it('零 padding/gap 时退化为全宽双列', () => {
		// clientWidth=1600, 无 padding/gap → colStep=800, spreadStep=1600
		const el = makeScrollView({ clientWidth: 1600, paddingLeft: 0, paddingRight: 0, columnGap: 0 });
		const m = getDualPageMetrics(el);
		expect(m.colStep).toBe(800);
		expect(m.spreadStep).toBe(1600);
	});

	it('spreadStep 等价于翻页/restore 使用的旧公式 (clientWidth - paddingLeft - paddingRight + columnGap)', () => {
		// 回归保护：确保重构后步长与原翻页逻辑一致
		const el = makeScrollView({ clientWidth: 1920, paddingLeft: 40, paddingRight: 40, columnGap: 80 });
		const m = getDualPageMetrics(el);
		expect(m.spreadStep).toBe(1920 - 40 - 40 + 80);
	});
});
