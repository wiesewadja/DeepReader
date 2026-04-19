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
const MAX_VISIBLE_STRIPES = 5;

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

	/** 外部设置当前页码（用于 blockId 跳转后同步状态） */
	setCurrentPage(page: number): void {
		this._currentPage = Math.max(1, Math.min(page, this._totalPages));
		this.updateControls();
	}

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
	private stripeThumb: HTMLElement | null = null;
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

		// 条纹容器（中间）
		const stripeContainer = document.createElement('div');
		stripeContainer.className = 'deeppdf-page-stripes';
		this.controlsBar.appendChild(stripeContainer);

		// 页码指示器（右侧）
		this.pageIndicator = document.createElement('span');
		this.pageIndicator.className = 'deeppdf-page-indicator';
		this.controlsBar.appendChild(this.pageIndicator);

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

		container.innerHTML = '';
		this.pageStripes = [];

		// 滑块容器（在轨道上滑动）
		this.stripeThumb = document.createElement('div');
		this.stripeThumb.className = 'deeppdf-stripe-thumb';

		for (let i = 0; i < MAX_VISIBLE_STRIPES; i++) {
			const stripe = document.createElement('div');
			stripe.className = 'deeppdf-page-stripe';

			stripe.addEventListener('click', () => {
				const page = parseInt(stripe.dataset.page || '0');
				if (page > 0) this.goToPage(page);
			});
			stripe.addEventListener('mouseenter', (e) => {
				const page = parseInt(stripe.dataset.page || '0');
				if (page > 0) this.showPreview(page, e);
			});
			stripe.addEventListener('mouseleave', () => this.hidePreview());

			this.stripeThumb.appendChild(stripe);
			this.pageStripes.push(stripe);
		}

		container.appendChild(this.stripeThumb);
		this.updateStripeWindow();
	}

	/** 计算滑动窗口页码范围（当前页尽量居中） */
	private getVisiblePageRange(): [number, number] {
		if (this._totalPages <= MAX_VISIBLE_STRIPES) {
			return [1, this._totalPages];
		}
		const half = Math.floor(MAX_VISIBLE_STRIPES / 2);
		let start = this._currentPage - half;
		let end = start + MAX_VISIBLE_STRIPES - 1;
		if (start < 1) { start = 1; end = MAX_VISIBLE_STRIPES; }
		if (end > this._totalPages) { end = this._totalPages; start = end - MAX_VISIBLE_STRIPES + 1; }
		return [start, end];
	}

	/** 更新条纹页码映射 + 滑块位置 */
	private updateStripeWindow(): void {
		const [startPage, endPage] = this.getVisiblePageRange();
		const count = endPage - startPage + 1;
		for (let i = 0; i < this.pageStripes.length; i++) {
			const stripe = this.pageStripes[i];
			if (i < count) {
				stripe.dataset.page = String(startPage + i);
				stripe.style.display = '';
			} else {
				stripe.style.display = 'none';
			}
		}
		this.updateThumbPosition();
	}

	/** 根据当前页进度滑动 thumb */
	private updateThumbPosition(): void {
		if (!this.stripeThumb) return;
		const track = this.stripeThumb.parentElement as HTMLElement | null;
		if (!track) return;

		requestAnimationFrame(() => {
			if (!this.stripeThumb) return;
			const trackW = track.clientWidth;
			const thumbW = this.stripeThumb.offsetWidth;
			if (trackW === 0 || thumbW === 0) return;

			if (this._totalPages <= 1) {
				this.stripeThumb.style.transform = `translateX(${(trackW - thumbW) / 2}px)`;
				return;
			}
			const progress = (this._currentPage - 1) / (this._totalPages - 1);
			const maxOffset = trackW - thumbW;
			this.stripeThumb.style.transform = `translateX(${progress * maxOffset}px)`;
		});
	}

	private goToPage(pageNum: number): void {
		if (!this.scrollView || pageNum < 1 || pageNum > this._totalPages) return;
		
		const viewWidth = this.scrollView.clientWidth;
		this.scrollView.scrollTo({ left: (pageNum - 1) * viewWidth, behavior: 'smooth' });
		this.hidePreview();
	}

	private showPreview(pageNum: number, event: MouseEvent): void {
		if (!this.previewPopup || !this.previewContent || !this.scrollView) return;

		// 通过 data-page 找到对应条纹（支持窗口滑动）
		const stripe = this.pageStripes.find(s => s.dataset.page === String(pageNum));
		if (!stripe) return;

		const stripeRect = stripe.getBoundingClientRect();
		const controlsRect = this.controlsBar!.getBoundingClientRect();

		this.previewPopup.style.left = `${stripeRect.left - controlsRect.left + stripeRect.width / 2}px`;
		this.previewPopup.style.transform = 'translateX(-50%)';
		this.previewPopup.classList.add('visible');

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
		
		// 获取 sizer 内容
		const sizer = this.scrollView.querySelector('.markdown-preview-sizer') as HTMLElement;
		if (!sizer) return;

		// 获取页面文本片段（第一段或标题）
		const textContent = this.getPagePreviewText(pageNum, viewWidth);
		
		// 创建预览文本显示
		const previewText = document.createElement('div');
		previewText.className = 'deeppdf-page-preview-text';
		previewText.textContent = textContent;
		
		this.previewContent.appendChild(previewText);
		
		// 添加页码标签
		const pageLabel = document.createElement('div');
		pageLabel.className = 'deeppdf-page-preview-label';
		pageLabel.textContent = `第 ${pageNum} 页`;
		this.previewContent.appendChild(pageLabel);
	}

	private getPagePreviewText(pageNum: number, viewWidth: number): string {
		// 从 scrollLeft 计算当前页面的起始位置
		const pageStart = (pageNum - 1) * viewWidth;
		
		// 获取所有文本段落
		const paragraphs = this.scrollView?.querySelectorAll('.markdown-preview-sizer > p, .markdown-preview-sizer > h1, .markdown-preview-sizer > h2, .markdown-preview-sizer > h3');
		if (!paragraphs || paragraphs.length === 0) {
			return '页面内容';
		}

		// 找到该页面范围内的第一个段落
		for (const p of paragraphs) {
			const rect = p.getBoundingClientRect();
			const scrollRect = this.scrollView!.getBoundingClientRect();
			// 检查元素是否在目标页面范围内
			const elementLeft = rect.left - scrollRect.left + this.scrollView!.scrollLeft;
			if (elementLeft >= pageStart && elementLeft < pageStart + viewWidth) {
				const text = (p as HTMLElement).textContent?.trim() || '';
				return text.length > 50 ? text.substring(0, 50) + '...' : text;
			}
		}

		// 如果没找到，返回第一个段落
		const firstText = (paragraphs[0] as HTMLElement).textContent?.trim() || '';
		return firstText.length > 50 ? firstText.substring(0, 50) + '...' : firstText;
	}

	private updateControls(): void {
		if (!this._isActive) return;

		if (this.pageIndicator) {
			this.pageIndicator.textContent = `${this._currentPage} / ${this._totalPages}`;
		}

		this.updateStripeWindow();

		for (const stripe of this.pageStripes) {
			const pageNum = parseInt(stripe.dataset.page || '0');
			if (pageNum === 0) continue;
			stripe.classList.toggle('active', pageNum === this._currentPage);
			stripe.classList.toggle('read', pageNum < this._currentPage);
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
		this.previewPopup = null;
		this.previewContent = null;
		this.stripeThumb = null;
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
