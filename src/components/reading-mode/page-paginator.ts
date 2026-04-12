/**
 * PagePaginator - 基于字符数的分页器
 *
 * 每页最多 maxCharsPerPage 个字符，通过隐藏/显示块元素实现翻页。
 * 进度条 sticky 定位在当前 tab 视图底部，翻页按钮 fixed 在视口两侧。
 * 激活时锁住 .markdown-preview-view 的滚动。
 */

import { serviceLog } from '../../utils/logger.js';

export interface PagePaginatorOptions {
	container: HTMLElement;                    // .markdown-preview-sizer
	onNavigatePrev: () => Promise<boolean>;
	onNavigateNext: () => Promise<boolean>;
}

const DISABLED_CLASS = 'deeppdf-page-btn-disabled';

export class PagePaginator {
	private container: HTMLElement;
	private scrollView: HTMLElement | null = null;   // .markdown-preview-view
	private viewContent: HTMLElement | null = null;  // .view-content (用来挂载按钮)
	private onNavigatePrev: () => Promise<boolean>;
	private onNavigateNext: () => Promise<boolean>;

	private _isActive = false;
	private _currentPage = 1;
	private _totalPages = 0;

	private leftBtn: HTMLElement | null = null;
	private rightBtn: HTMLElement | null = null;
	private controlsBar: HTMLElement | null = null;
	private progressFill: HTMLElement | null = null;
	private pageIndicator: HTMLElement | null = null;

	private resizeObserver: ResizeObserver | null = null;
	private resizeTimer: ReturnType<typeof setTimeout> | null = null;
	private scrollHandler: ((e: Event) => void) | null = null;

	constructor(options: PagePaginatorOptions) {
		this.container = options.container;
		this.onNavigatePrev = options.onNavigatePrev;
		this.onNavigateNext = options.onNavigateNext;

		this.scrollView = this.container.closest('.markdown-preview-view') as HTMLElement;
		this.viewContent = this.container.closest('.view-content') as HTMLElement;
	}

	isActive(): boolean { return this._isActive; }
	getTotalPages(): number { return this._totalPages; }
	getCurrentPage(): number { return this._currentPage; }

	paginateAndShow(): void {
		if (!this.scrollView || !this.viewContent) {
			serviceLog.warn('[PagePaginator] Required containers not found');
			return;
		}

		this._isActive = true;
		
		this.updateColumnSizing();
		this.createControls();
		this.calculatePages();
		this.setupResizeObserver();
		this.setupScrollListener();
		
		serviceLog(`[PagePaginator] CSS Column Pagination activated`);
	}

	nextPage(): boolean {
		if (!this._isActive || !this.scrollView) return false;
		
		if (this._currentPage >= this._totalPages) {
			this.onNavigateNext();
			return false;
		}
		
		const pageWidth = this.scrollView.clientWidth;
		this.scrollView.scrollBy({ left: pageWidth, behavior: 'smooth' });
		return true;
	}

	prevPage(): boolean {
		if (!this._isActive || !this.scrollView) return false;
		
		if (this._currentPage <= 1) {
			this.onNavigatePrev();
			return false;
		}
		
		const pageWidth = this.scrollView.clientWidth;
		this.scrollView.scrollBy({ left: -pageWidth, behavior: 'smooth' });
		return true;
	}

	destroy(): void {
		this._isActive = false;
		this.removeControls();
		this.teardownResizeObserver();
		this.teardownScrollListener();
		this._totalPages = 0;
		this._currentPage = 1;
		serviceLog('[PagePaginator] destroyed');
	}

	private calculatePages(): void {
		if (!this.scrollView) return;
		
		// 利用 CSS 分列后的 scrollWidth 和 clientWidth 计算总页数
		// 如果 scrollWidth 尚未完全计算出，可能需要延迟一帧
		requestAnimationFrame(() => {
			if (!this.scrollView) return;
			const totalWidth = this.scrollView.scrollWidth;
			const viewWidth = this.scrollView.clientWidth;
			
			// 防御性检查
			if (viewWidth === 0) return;
			
			this._totalPages = Math.ceil(totalWidth / viewWidth);
			
			// 如果只有1页，但内容并没有超过容器，也至少算1页
			if (this._totalPages < 1) this._totalPages = 1;
			
			this.updateCurrentPageFromScroll();
			this.updateControls();
		});
	}

	private setupScrollListener(): void {
		if (!this.scrollView) return;
		
		this.scrollHandler = () => {
			if (!this._isActive) return;
			this.updateCurrentPageFromScroll();
			this.updateControls();
		};
		
		this.scrollView.addEventListener('scroll', this.scrollHandler, { passive: true });
	}

	private teardownScrollListener(): void {
		if (this.scrollView && this.scrollHandler) {
			this.scrollView.removeEventListener('scroll', this.scrollHandler);
			this.scrollHandler = null;
		}
	}

	private updateColumnSizing(): void {
		if (!this.scrollView) return;
		
		const viewWidth = this.scrollView.clientWidth;
		if (viewWidth === 0) return;

		// 获取当前容器计算出的 padding (Obsidian 阅读视图可能因主题而异，我们通过 CSS 获取，或 fallback 到 40)
		const computedStyle = window.getComputedStyle(this.scrollView);
		const pl = parseFloat(computedStyle.paddingLeft) || 40;
		const pr = parseFloat(computedStyle.paddingRight) || 40;

		// 计算精确的内容区宽度 (content box)
		const columnWidth = Math.max(200, viewWidth - pl - pr);
		
		// 通过 CSS 变量动态设定
		this.scrollView.style.setProperty('--deeppdf-col-width', `${columnWidth}px`);
		this.scrollView.style.setProperty('--deeppdf-col-gap', `${pl + pr}px`);
	}

	private updateCurrentPageFromScroll(): void {
		if (!this.scrollView) return;
		
		const scrollLeft = this.scrollView.scrollLeft;
		const viewWidth = this.scrollView.clientWidth;
		
		if (viewWidth === 0) return;
		
		// 计算当前处于第几页 (1-based)
		const newPage = Math.round(scrollLeft / viewWidth) + 1;
		
		if (newPage !== this._currentPage) {
			this._currentPage = newPage;
		}
	}

	// ── 控制栏 ───────────────────────────────────────────────

	private createControls(): void {
		this.removeControls();

		// 左侧翻页按钮
		this.leftBtn = document.createElement('button');
		this.leftBtn.className = 'deeppdf-page-btn left';
		this.leftBtn.setAttribute('aria-label', '上一页');
		this.leftBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
		this.leftBtn.addEventListener('click', () => this.prevPage());

		// 右侧翻页按钮
		this.rightBtn = document.createElement('button');
		this.rightBtn.className = 'deeppdf-page-btn right';
		this.rightBtn.setAttribute('aria-label', '下一页');
		this.rightBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
		this.rightBtn.addEventListener('click', () => this.nextPage());

		// 进度条（absolute，贴底）
		this.controlsBar = document.createElement('div');
		this.controlsBar.className = 'deeppdf-page-controls';

		const progressBar = document.createElement('div');
		progressBar.className = 'deeppdf-page-progress-bar';

		this.progressFill = document.createElement('div');
		this.progressFill.className = 'deeppdf-page-progress-fill';
		progressBar.appendChild(this.progressFill);

		this.pageIndicator = document.createElement('span');
		this.pageIndicator.className = 'deeppdf-page-indicator';

		this.controlsBar.appendChild(progressBar);
		this.controlsBar.appendChild(this.pageIndicator);

		// 将按钮和进度条挂载到 .view-content 容器上（取代 document.body，避免被侧边栏遮挡或影响其他页面）
		if (this.viewContent) {
			// 确保 view-content 有相对定位
			if (getComputedStyle(this.viewContent).position === 'static') {
				this.viewContent.style.position = 'relative';
			}
			this.viewContent.appendChild(this.leftBtn);
			this.viewContent.appendChild(this.rightBtn);
			this.viewContent.appendChild(this.controlsBar);
		}
	}

	private updateControls(): void {
		if (!this._isActive) return;

		if (this.progressFill) {
			const pct = this._totalPages > 1
				? ((this._currentPage - 1) / (this._totalPages - 1)) * 100
				: 0;
			this.progressFill.style.width = `${pct}%`;
		}

		if (this.pageIndicator) {
			this.pageIndicator.textContent = `${this._currentPage} / ${this._totalPages}`;
		}

		this.leftBtn?.classList.toggle(DISABLED_CLASS, this._currentPage <= 1);
		this.rightBtn?.classList.toggle(DISABLED_CLASS, this._currentPage >= this._totalPages);
	}

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

	// ── ResizeObserver ────────────────────────────────────────

	private setupResizeObserver(): void {
		this.teardownResizeObserver();
		if (!this.scrollView) return;

		this.resizeObserver = new ResizeObserver(() => {
			// 防抖处理窗口改变大小导致的列数变化
			if (this.resizeTimer) clearTimeout(this.resizeTimer);
			this.resizeTimer = setTimeout(() => this.handleResize(), 150);
		});
		this.resizeObserver.observe(this.scrollView);
	}

	private teardownResizeObserver(): void {
		if (this.resizeTimer) { clearTimeout(this.resizeTimer); this.resizeTimer = null; }
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
	}

	private handleResize(): void {
		if (!this._isActive || !this.scrollView) return;

		// 记录当前进度百分比
		const prevProgress = this._totalPages > 1
			? (this._currentPage - 1) / (this._totalPages - 1) : 0;

		// 更新精确的列宽和间距
		this.updateColumnSizing();

		// 重新计算总页数
		this.calculatePages();

		if (this._totalPages <= 1) { 
			// 如果视口变大到一页就能装下，保持控制栏但不提供翻页
			return; 
		}

		// 根据之前的进度计算新的页码
		const newPage = Math.round(prevProgress * (this._totalPages - 1)) + 1;
		this._currentPage = Math.max(1, Math.min(newPage, this._totalPages));

		// 滚动到新的计算位置
		const viewWidth = this.scrollView.clientWidth;
		this.scrollView.scrollLeft = (this._currentPage - 1) * viewWidth;
		
		this.updateControls();
	}
}
