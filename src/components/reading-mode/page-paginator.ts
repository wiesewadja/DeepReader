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
		
		requestAnimationFrame(() => {
			if (!this.scrollView) return;
			const totalWidth = this.scrollView.scrollWidth;
			const viewWidth = this.scrollView.clientWidth;
			
			if (viewWidth === 0) return;
			
			this._totalPages = Math.max(1, Math.ceil(totalWidth / viewWidth));
			
			// 创建条纹
			this.createStripes();
			
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

		// 纸质书最佳阅读行宽 (约 640px 左右)
		const MAX_TEXT_WIDTH = 640;
		// 最小安全边距（针对窄屏幕或手机）
		const MIN_PADDING = 40;

		let contentWidth: number;
		let sidePadding: number;

		if (viewWidth <= MAX_TEXT_WIDTH + MIN_PADDING * 2) {
			// 窄屏模式：扣除双边最小边距
			contentWidth = viewWidth - MIN_PADDING * 2;
			sidePadding = MIN_PADDING;
		} else {
			// 宽屏模式：锁定行宽，两边均分留白，实现绝对居中
			contentWidth = MAX_TEXT_WIDTH;
			sidePadding = (viewWidth - MAX_TEXT_WIDTH) / 2;
		}

		// The mathematical constraint to perfectly center every page is:
		// stride = columnWidth + columnGap = viewWidth
		// Therefore: columnGap = viewWidth - contentWidth
		const columnGap = viewWidth - contentWidth;

		// 通过 CSS 变量动态设定列宽、列间距和容器的左右 Padding
		this.scrollView.style.setProperty('--deeppdf-col-width', `${contentWidth}px`);
		this.scrollView.style.setProperty('--deeppdf-col-gap', `${columnGap}px`);
		this.scrollView.style.setProperty('--deeppdf-side-padding', `${sidePadding}px`);
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

	private pageStripes: HTMLElement[] = [];
	private previewPopup: HTMLElement | null = null;
	private previewContent: HTMLElement | null = null;

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

		// 控制栏（absolute，贴底）
		this.controlsBar = document.createElement('div');
		this.controlsBar.className = 'deeppdf-page-controls';

		// 页码指示器（左侧）
		this.pageIndicator = document.createElement('span');
		this.pageIndicator.className = 'deeppdf-page-indicator';
		this.controlsBar.appendChild(this.pageIndicator);

		// 条纹容器（中间）
		const stripeContainer = document.createElement('div');
		stripeContainer.className = 'deeppdf-page-stripes';
		this.controlsBar.appendChild(stripeContainer);

		// 预览弹出框（用于悬停显示）
		this.previewPopup = document.createElement('div');
		this.previewPopup.className = 'deeppdf-page-preview-popup';
		this.previewContent = document.createElement('div');
		this.previewContent.className = 'deeppdf-page-preview-content';
		this.previewPopup.appendChild(this.previewContent);
		this.controlsBar.appendChild(this.previewPopup);

		// 将按钮和控制栏挂载到 .view-content
		if (this.viewContent) {
			if (getComputedStyle(this.viewContent).position === 'static') {
				this.viewContent.style.position = 'relative';
			}
			this.viewContent.appendChild(this.leftBtn);
			this.viewContent.appendChild(this.rightBtn);
			this.viewContent.appendChild(this.controlsBar);
		}
	}

	private createStripes(): void {
		const container = this.controlsBar?.querySelector('.deeppdf-page-stripes');
		if (!container) return;

		// 清空旧条纹
		container.innerHTML = '';
		this.pageStripes = [];

		// 为每一页创建一个小条纹
		for (let i = 1; i <= this._totalPages; i++) {
			const stripe = document.createElement('div');
			stripe.className = 'deeppdf-page-stripe';
			stripe.dataset.page = String(i);

			// 点击跳转
			stripe.addEventListener('click', () => this.goToPage(i));

			// 悬停预览
			stripe.addEventListener('mouseenter', (e) => this.showPreview(i, e));
			stripe.addEventListener('mouseleave', () => this.hidePreview());

			container.appendChild(stripe);
			this.pageStripes.push(stripe);
		}
	}

	private goToPage(pageNum: number): void {
		if (!this.scrollView || pageNum < 1 || pageNum > this._totalPages) return;
		
		const viewWidth = this.scrollView.clientWidth;
		this.scrollView.scrollTo({ left: (pageNum - 1) * viewWidth, behavior: 'smooth' });
		this.hidePreview();
	}

	private showPreview(pageNum: number, event: MouseEvent): void {
		if (!this.previewPopup || !this.previewContent || !this.scrollView) return;

		// 定位预览框在条纹上方
		const stripe = this.pageStripes[pageNum - 1];
		if (!stripe) return;
		
		const stripeRect = stripe.getBoundingClientRect();
		const controlsRect = this.controlsBar!.getBoundingClientRect();
		
		// 预览框定位在条纹上方
		this.previewPopup.style.left = `${stripeRect.left - controlsRect.left + stripeRect.width / 2}px`;
		this.previewPopup.style.transform = 'translateX(-50%)';
		this.previewPopup.classList.add('visible');

		// 生成预览内容（克隆当前页的可见内容）
		this.generatePreviewContent(pageNum);
	}

	private hidePreview(): void {
		if (this.previewPopup) {
			this.previewPopup.classList.remove('visible');
		}
	}

	private generatePreviewContent(pageNum: number): void {
		if (!this.previewContent || !this.scrollView) return;

		// 清空旧预览
		this.previewContent.innerHTML = '';

		const viewWidth = this.scrollView.clientWidth;
		const viewHeight = this.scrollView.clientHeight;
		
		// 克隆整个 sizer 内容
		const sizer = this.scrollView.querySelector('.markdown-preview-sizer') as HTMLElement;
		if (!sizer) return;

		const clone = sizer.cloneNode(true) as HTMLElement;
		
		// 预览窗口尺寸 140x100
		// 原始页面尺寸 viewWidth x viewHeight
		// 缩放比例
		const scaleX = 140 / viewWidth;
		const scaleY = 100 / viewHeight;
		const scale = Math.min(scaleX, scaleY);
		
		// 计算要显示的页面偏移（pageNum 从1开始）
		const pageOffset = (pageNum - 1) * viewWidth;
		
		// 设置克隆元素的样式
		clone.style.cssText = `
			position: absolute;
			width: ${viewWidth}px;
			height: ${viewHeight}px;
			transform: scale(${scale}) translateX(${-pageOffset}px);
			transform-origin: 0 0;
			top: 0;
			left: 0;
			overflow: hidden;
			background: var(--background-primary);
		`;

		this.previewContent.appendChild(clone);
	}

	private updateControls(): void {
		if (!this._isActive) return;

		// 更新页码指示器
		if (this.pageIndicator) {
			this.pageIndicator.textContent = `${this._currentPage} / ${this._totalPages}`;
		}

		// 更新条纹状态
		for (let i = 0; i < this.pageStripes.length; i++) {
			const stripe = this.pageStripes[i];
			const pageNum = i + 1;
			
			// 当前页高亮
			stripe.classList.toggle('active', pageNum === this._currentPage);
			
			// 已读页面标记
			stripe.classList.toggle('read', pageNum < this._currentPage);
		}

		// 更新翻页按钮状态
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
		this.previewPopup = null;
		this.previewContent = null;
		this.pageStripes = [];
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

		// 记录调整前的进度百分比
		const prevProgress = this._totalPages > 1
			? (this._currentPage - 1) / (this._totalPages - 1) : 0;

		// 1. 同步更新 CSS 变量（列宽和间距），这会立即触发浏览器的重排
		this.updateColumnSizing();

		// 2. 为了获取重排后正确的 scrollWidth，必须延迟到下一帧
		requestAnimationFrame(() => {
			if (!this._isActive || !this.scrollView) return;

			const totalWidth = this.scrollView.scrollWidth;
			const viewWidth = this.scrollView.clientWidth;
			if (viewWidth === 0) return;

			// 计算新的总页数
			this._totalPages = Math.max(1, Math.ceil(totalWidth / viewWidth));

			// 重新创建条纹
			this.createStripes();

			if (this._totalPages <= 1) { 
				// 只有一页，滚动到最左侧
				this.scrollView.scrollLeft = 0;
				this.updateControls();
				return; 
			}

			// 根据之前的进度计算调整后的新页码
			const newPage = Math.round(prevProgress * (this._totalPages - 1)) + 1;
			this._currentPage = Math.max(1, Math.min(newPage, this._totalPages));

			// 立刻强制同步滚动，对齐内容盒子
			this.scrollView.scrollLeft = (this._currentPage - 1) * viewWidth;
			
			// 更新底部控件
			this.updateControls();
		});
	}
}
