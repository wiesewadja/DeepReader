/**
 * PagePaginator - 动态高度分页器
 *
 * 基于 viewport 可用高度，将容器中的块级元素自动分成多个"页面"，
 * 通过隐藏/显示元素实现翻页效果。适用于 Obsidian 阅读模式下的
 * 长文档阅读体验优化。
 */

import { serviceLog } from '../../utils/logger.js';

// ============================================================================
// 类型定义
// ============================================================================

export interface PagePaginatorOptions {
	/** 需要分页的容器元素（通常是 .markdown-preview-sizer） */
	container: HTMLElement;
	/** 翻到上一章的回调，返回 true 表示成功 */
	onNavigatePrev: () => Promise<boolean>;
	/** 翻到下一章的回调，返回 true 表示成功 */
	onNavigateNext: () => Promise<boolean>;
	/** 容器顶部内边距（px），默认 80 */
	topPadding?: number;
	/** 容器底部内边距（px），默认 120 */
	bottomPadding?: number;
	/** 底部控制栏高度（px），默认 60 */
	controlsHeight?: number;
}

/** 隐藏元素用的 CSS 类名 */
const HIDDEN_CLASS = 'deeppdf-page-hidden';

/** 禁用按钮用的 CSS 类名 */
const DISABLED_CLASS = 'deeppdf-page-btn-disabled';

// ============================================================================
// PagePaginator
// ============================================================================

export class PagePaginator {
	private container: HTMLElement;
	private onNavigatePrev: () => Promise<boolean>;
	private onNavigateNext: () => Promise<boolean>;
	private topPadding: number;
	private bottomPadding: number;
	private controlsHeight: number;

	/** 是否已激活分页 */
	private _isActive = false;
	/** 当前页码（1-based） */
	private _currentPage = 1;
	/** 总页数 */
	private _totalPages = 0;
	/** 分页结果：每页是元素数组的集合 */
	private pages: HTMLElement[][] = [];

	// 控制元素
	private leftBtn: HTMLElement | null = null;
	private rightBtn: HTMLElement | null = null;
	private controlsBar: HTMLElement | null = null;
	private progressFill: HTMLElement | null = null;
	private pageIndicator: HTMLElement | null = null;

	// ResizeObserver
	private resizeObserver: ResizeObserver | null = null;
	private resizeTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(options: PagePaginatorOptions) {
		this.container = options.container;
		this.onNavigatePrev = options.onNavigatePrev;
		this.onNavigateNext = options.onNavigateNext;
		this.topPadding = options.topPadding ?? 80;
		this.bottomPadding = options.bottomPadding ?? 120;
		this.controlsHeight = options.controlsHeight ?? 60;
	}

	// ========================================================================
	// 公共 API
	// ========================================================================

	/** 是否已激活分页 */
	isActive(): boolean {
		return this._isActive;
	}

	/** 获取总页数 */
	getTotalPages(): number {
		return this._totalPages;
	}

	/** 获取当前页码（1-based） */
	getCurrentPage(): number {
		return this._currentPage;
	}

	/** 执行分页并显示第一页 */
	paginateAndShow(): void {
		const availableHeight = this.getAvailableHeight();
		const blocks = this.collectBlocks();

		if (blocks.length === 0) {
			this._totalPages = 0;
			this.clearPages();
			return;
		}

		this.pages = this.groupIntoPages(blocks, availableHeight);
		this._totalPages = this.pages.length;

		// 不超过 1 页则不激活
		if (this._totalPages <= 1) {
			this._totalPages = 0;
			this.pages = [];
			this.clearPages();
			return;
		}

		this._isActive = true;
		this._currentPage = 1;

		this.createControls();
		this.showPage(0);
		this.updateControls();
		this.setupResizeObserver();

		serviceLog(`[PagePaginator] 分页完成: ${this._totalPages} 页, ${blocks.length} 个块`);
	}

	/** 下一页，返回 true 表示翻页成功 */
	nextPage(): boolean {
		if (!this._isActive) return false;

		if (this._currentPage >= this._totalPages) {
			// 已在最后一页，触发章节导航
			this.onNavigateNext();
			return false;
		}

		this._currentPage++;
		this.showPage(this._currentPage - 1);
		this.updateControls();
		return true;
	}

	/** 上一页，返回 true 表示翻页成功 */
	prevPage(): boolean {
		if (!this._isActive) return false;

		if (this._currentPage <= 1) {
			// 已在第一页，触发章节导航
			this.onNavigatePrev();
			return false;
		}

		this._currentPage--;
		this.showPage(this._currentPage - 1);
		this.updateControls();
		return true;
	}

	/** 销毁分页器，恢复所有元素可见 */
	destroy(): void {
		this.clearPages();
		this.removeControls();
		this.teardownResizeObserver();

		this._isActive = false;
		this._totalPages = 0;
		this._currentPage = 1;
		this.pages = [];

		serviceLog('[PagePaginator] 已销毁');
	}

	// ========================================================================
	// 内部方法
	// ========================================================================

	/**
	 * 计算可用高度：viewport - 顶部内边距 - 底部内边距 - 控制栏高度
	 */
	private getAvailableHeight(): number {
		return window.innerHeight - this.topPadding - this.bottomPadding - this.controlsHeight;
	}

	/**
	 * 收集容器中的顶层块元素
	 * 排除：章节导航、分页控制、frontmatter、已隐藏元素
	 */
	private collectBlocks(): HTMLElement[] {
		const blocks: HTMLElement[] = [];
		const children = this.container.children;

		for (let i = 0; i < children.length; i++) {
			const el = children[i] as HTMLElement;

			// 跳过非元素节点
			if (el.nodeType !== Node.ELEMENT_NODE) continue;

			// 跳过排除列表中的元素
			if (el.classList.contains('deeppdf-chapter-nav')) continue;
			if (el.classList.contains('deeppdf-page-controls')) continue;
			if (el.classList.contains('frontmatter')) continue;
			if (el.classList.contains('deeppdf-page-hidden')) continue;

			blocks.push(el);
		}

		return blocks;
	}

	/**
	 * 将块元素按可用高度分组为页面
	 *
	 * 规则：
	 * - 当前页有元素且加入下一个块会溢出时，封页
	 * - 即使单个块超过可用高度，也会独占一页（不会被拆分）
	 */
	private groupIntoPages(blocks: HTMLElement[], availableHeight: number): HTMLElement[][] {
		const pages: HTMLElement[][] = [];
		let currentPage: HTMLElement[] = [];
		let currentHeight = 0;

		for (const block of blocks) {
			const blockHeight = block.offsetHeight;

			// 当前页已有元素，且加入此块会溢出 → 封页
			if (currentPage.length > 0 && currentHeight + blockHeight > availableHeight) {
				pages.push(currentPage);
				currentPage = [];
				currentHeight = 0;
			}

			// 始终将块加入当前页（即使超大也独占一页）
			currentPage.push(block);
			currentHeight += blockHeight;
		}

		// 最后一页
		if (currentPage.length > 0) {
			pages.push(currentPage);
		}

		return pages;
	}

	/**
	 * 显示指定索引的页面（0-based）
	 * 隐藏其他页面的元素
	 */
	private showPage(pageIndex: number): void {
		// 先隐藏所有页面的元素
		for (let i = 0; i < this.pages.length; i++) {
			for (const el of this.pages[i]) {
				if (i === pageIndex) {
					el.classList.remove(HIDDEN_CLASS);
				} else {
					el.classList.add(HIDDEN_CLASS);
				}
			}
		}

		// 对超大页面（单页总高度超过可用高度）启用滚动
		const pageBlocks = this.pages[pageIndex];
		if (pageBlocks) {
			const pageHeight = pageBlocks.reduce((sum, el) => sum + el.offsetHeight, 0);
			if (pageHeight > this.getAvailableHeight()) {
				this.container.style.overflowY = 'auto';
				this.container.style.maxHeight = `${this.getAvailableHeight()}px`;
			} else {
				this.container.style.overflowY = '';
				this.container.style.maxHeight = '';
			}
		}
	}

	/**
	 * 清除分页状态，恢复所有元素可见
	 */
	private clearPages(): void {
		// 移除所有隐藏类
		const hiddenElements = this.container.querySelectorAll(`.${HIDDEN_CLASS}`);
		hiddenElements.forEach(el => el.classList.remove(HIDDEN_CLASS));

		// 重置容器溢出
		this.container.style.overflowY = '';
		this.container.style.maxHeight = '';
	}

	/**
	 * 创建翻页控制元素
	 */
	private createControls(): void {
		this.removeControls();

		// 左侧按钮（上一页）
		this.leftBtn = document.createElement('button');
		this.leftBtn.className = 'deeppdf-page-btn left';
		this.leftBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
		this.leftBtn.style.cssText = 'position:fixed;top:50%;transform:translateY(-50%);left:8px;width:44px;height:44px;border-radius:50%;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-muted);cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:100;transition:opacity 0.2s;';
		this.leftBtn.addEventListener('click', () => this.prevPage());

		// 右侧按钮（下一页）
		this.rightBtn = document.createElement('button');
		this.rightBtn.className = 'deeppdf-page-btn right';
		this.rightBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
		this.rightBtn.style.cssText = 'position:fixed;top:50%;transform:translateY(-50%);right:8px;width:44px;height:44px;border-radius:50%;border:1px solid var(--background-modifier-border);background:var(--background-secondary);color:var(--text-muted);cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:100;transition:opacity 0.2s;';
		this.rightBtn.addEventListener('click', () => this.nextPage());

		// 底部进度条
		this.controlsBar = document.createElement('div');
		this.controlsBar.className = 'deeppdf-page-controls';
		this.controlsBar.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 16px;margin-top:8px;';

		this.progressFill = document.createElement('div');
		this.progressFill.className = 'deeppdf-page-progress-fill';
		this.progressFill.style.cssText = 'flex:1;height:4px;background:var(--background-modifier-border);border-radius:2px;overflow:hidden;position:relative;';

		const fillInner = document.createElement('div');
		fillInner.style.cssText = 'height:100%;background:var(--interactive-accent);border-radius:2px;transition:width 0.3s;';
		this.progressFill.appendChild(fillInner);

		this.pageIndicator = document.createElement('span');
		this.pageIndicator.className = 'deeppdf-page-indicator';
		this.pageIndicator.style.cssText = 'font-size:12px;color:var(--text-muted);white-space:nowrap;';

		this.controlsBar.appendChild(this.progressFill);
		this.controlsBar.appendChild(this.pageIndicator);

		// 挂载
		document.body.appendChild(this.leftBtn);
		document.body.appendChild(this.rightBtn);
		this.container.appendChild(this.controlsBar);
	}

	/**
	 * 更新控制元素状态
	 */
	private updateControls(): void {
		if (!this._isActive) return;

		// 更新进度条
		if (this.progressFill) {
			const fillInner = this.progressFill.querySelector('div');
			if (fillInner && this._totalPages > 1) {
				const progress = ((this._currentPage - 1) / (this._totalPages - 1)) * 100;
				fillInner.style.width = `${progress}%`;
			}
		}

		// 更新页码指示器
		if (this.pageIndicator) {
			this.pageIndicator.textContent = `${this._currentPage} / ${this._totalPages}`;
		}

		// 更新按钮禁用状态
		if (this.leftBtn) {
			if (this._currentPage <= 1) {
				this.leftBtn.classList.add(DISABLED_CLASS);
			} else {
				this.leftBtn.classList.remove(DISABLED_CLASS);
			}
		}

		if (this.rightBtn) {
			if (this._currentPage >= this._totalPages) {
				this.rightBtn.classList.add(DISABLED_CLASS);
			} else {
				this.rightBtn.classList.remove(DISABLED_CLASS);
			}
		}
	}

	/**
	 * 移除所有控制元素
	 */
	private removeControls(): void {
		this.leftBtn?.remove();
		this.rightBtn?.remove();
		this.controlsBar?.remove();
		this.leftBtn = null;
		this.rightBtn = null;
		this.controlsBar = null;
		this.progressFill = null;
		this.pageIndicator = null;
	}

	/**
	 * 设置 ResizeObserver 监听窗口变化
	 */
	private setupResizeObserver(): void {
		this.teardownResizeObserver();

		this.resizeObserver = new ResizeObserver(() => {
			// 300ms 防抖
			if (this.resizeTimer) {
				clearTimeout(this.resizeTimer);
			}
			this.resizeTimer = setTimeout(() => {
				this.handleResize();
			}, 300);
		});

		this.resizeObserver.observe(document.body);
	}

	/**
	 * 断开 ResizeObserver
	 */
	private teardownResizeObserver(): void {
		if (this.resizeTimer) {
			clearTimeout(this.resizeTimer);
			this.resizeTimer = null;
		}
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
	}

	/**
	 * 窗口大小变化时重新分页
	 * 保持近似阅读位置（按进度比例）
	 */
	private handleResize(): void {
		if (!this._isActive) return;

		// 记录当前阅读进度
		const prevProgress = this._totalPages > 1
			? (this._currentPage - 1) / (this._totalPages - 1)
			: 0;

		// 清除旧状态并重新分页
		this.clearPages();
		const availableHeight = this.getAvailableHeight();
		const blocks = this.collectBlocks();

		if (blocks.length === 0) return;

		this.pages = this.groupIntoPages(blocks, availableHeight);
		this._totalPages = this.pages.length;

		if (this._totalPages <= 1) {
			this.destroy();
			return;
		}

		// 恢复近似阅读位置
		const newPage = Math.round(prevProgress * (this._totalPages - 1)) + 1;
		this._currentPage = Math.max(1, Math.min(newPage, this._totalPages));

		this.showPage(this._currentPage - 1);
		this.updateControls();

		serviceLog(`[PagePaginator] resize 重新分页: ${this._totalPages} 页, 当前第 ${this._currentPage} 页`);
	}
}
