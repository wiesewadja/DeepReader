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
	chapterName?: string;                      // 当前章节名称
	bookName?: string;                         // 当前书名
	onPageChange?: (page: number, totalPages: number) => void;
}

const DISABLED_CLASS = 'deeppdf-page-btn-disabled';

export class PagePaginator {
	private options: PagePaginatorOptions;
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
	private chapterIndicator: HTMLElement | null = null;
	private bookLabelEl: HTMLElement | null = null;

	private resizeObserver: ResizeObserver | null = null;
	private resizeTimer: ReturnType<typeof setTimeout> | null = null;
	private scrollHandler: ((e: Event) => void) | null = null;
	private mutationObserver: MutationObserver | null = null;
	private verifyTimer: ReturnType<typeof setTimeout> | null = null;
	private chapterName: string;
	private bookName: string;
	private lastKnownViewWidth: number = 0;

	constructor(options: PagePaginatorOptions) {
		this.options = options;
		this.container = options.container;
		this.onNavigatePrev = options.onNavigatePrev;
		this.onNavigateNext = options.onNavigateNext;
		this.chapterName = options.chapterName || '';
		this.bookName = options.bookName || '';

		this.scrollView = this.container.closest('.markdown-preview-view') as HTMLElement;
		this.viewContent = this.container.closest('.view-content') as HTMLElement;
		this.lastKnownViewWidth = this.scrollView?.clientWidth || 0;
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
		this.setupMutationObserver();

		// 延迟验证：multi-column 布局可能在初始化时尚未完全计算
		this.verifyTimer = setTimeout(() => {
			if (!this._isActive) return;
			const newTotal = this.countActualPages();
			if (newTotal !== this._totalPages) {
				serviceLog(`[PagePaginator] 延迟校正: ${this._totalPages} → ${newTotal} 页`);
				this._totalPages = newTotal;
				this.updateControls();
			}
		}, 600);

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
		// 翻页后触发强制重绘，避免空白页问题
		this.forceRerender();
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
		// 翻页后触发强制重绘，避免空白页问题
		this.forceRerender();
		return true;
	}

	/**
	 * 强制重绘，解决 CSS multi-column 滚动时列渲染空白的问题
	 * 通过多种方式触发浏览器重排
	 */
	private forceRerender(): void {
		if (!this.scrollView) return;
		
		// 使用多次 requestAnimationFrame 确保在滚动完成后执行
		requestAnimationFrame(() => {
			if (!this.scrollView) return;
			
			// 方法1：修改 column-width 触发重排
			const currentWidth = this.scrollView.style.getPropertyValue('--deeppdf-col-width');
			this.scrollView.style.setProperty('--deeppdf-col-width', `${parseInt(currentWidth) + 0.1}px`);
			
			requestAnimationFrame(() => {
				if (!this.scrollView) return;
				this.scrollView.style.setProperty('--deeppdf-col-width', currentWidth);
				
				// 方法2：修改 overflow 触发重排
				this.scrollView.style.overflow = 'hidden';
				requestAnimationFrame(() => {
					if (this.scrollView) {
						this.scrollView.style.overflow = '';
					}
				});
			});
		});
	}

	destroy(): void {
		this._isActive = false;
		if (this.verifyTimer) { clearTimeout(this.verifyTimer); this.verifyTimer = null; }
		this.removeControls();
		this.teardownResizeObserver();
		this.teardownScrollListener();
		this.teardownMutationObserver();
		this._totalPages = 0;
		this._currentPage = 1;
		serviceLog('[PagePaginator] destroyed');
	}

	private calculatePages(): void {
		if (!this.scrollView) return;

		// 双重 rAF：第一帧等当前渲染完成，第二帧确保 CSS 变量变化触发的重排已计算
		requestAnimationFrame(() => {
			if (!this.scrollView) return;
			requestAnimationFrame(() => {
				if (!this.scrollView) return;

				this._totalPages = this.countActualPages();

				this.options.onPageChange?.(this._currentPage, this._totalPages);
				this.updateCurrentPageFromScroll();
				this.updateControls();
			});
		});
	}

	/**
	 * 计算真实页数。
	 * 方法1（优先）：用 sizer 的 offsetWidth 作为内容总宽度，比 scrollWidth 更准确
	 * 方法2（备选）：遍历子元素位置做 bucket 分桶
	 */
	private countActualPages(): number {
		if (!this.scrollView) return 1;

		const viewWidth = this.scrollView.clientWidth;
		if (viewWidth === 0) return 1;

		// 优先用 scrollWidth（CSS multi-column 撑开后的真实内容宽度）
		const scrollW = this.scrollView.scrollWidth;
		if (scrollW > viewWidth) {
			return Math.ceil(scrollW / viewWidth);
		}

		// 兜底：通过 sizer offsetWidth
		const sizer = this.scrollView.querySelector('.markdown-preview-sizer') as HTMLElement;
		if (sizer && sizer.offsetWidth > viewWidth) {
			return Math.ceil(sizer.offsetWidth / viewWidth);
		}

		return 1;
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

		// 纸质书最佳阅读行宽（基础值）
		const MAX_TEXT_WIDTH = 640;
		// 宽屏下允许扩展到的最大内容宽度，避免超宽屏上边距过大
		const WIDE_MAX_TEXT_WIDTH = 860;
		// 窄视口阈值（视口宽度小于此值时，使用自适应留白）
		const NARROW_THRESHOLD = 700;
		// 窄视口最小留白
		const MIN_PADDING_NARROW = 40;
		// 宽屏下最大边距，超过此值时扩展内容宽度
		const MAX_SIDE_PADDING = 160;

		let contentWidth: number;
		let sidePadding: number;

		if (viewWidth < NARROW_THRESHOLD) {
			// 窄视口：留白 = 最小留白和 (视口-640)/2 中的较大值
			// 这样在视口>=720px 时 contentWidth=640，在更窄时留白至少 40px
			sidePadding = Math.max((viewWidth - MAX_TEXT_WIDTH) / 2, MIN_PADDING_NARROW);
			contentWidth = viewWidth - sidePadding * 2;
		} else {
			// 宽视口：先按最佳行宽计算边距
			sidePadding = (viewWidth - MAX_TEXT_WIDTH) / 2;

			// 如果边距超过上限，适当扩展内容宽度，改善宽屏阅读体验
			if (sidePadding > MAX_SIDE_PADDING) {
				contentWidth = viewWidth - 2 * MAX_SIDE_PADDING;
				// 内容宽度不超过宽屏最大值
				if (contentWidth > WIDE_MAX_TEXT_WIDTH) {
					contentWidth = WIDE_MAX_TEXT_WIDTH;
				}
				sidePadding = (viewWidth - contentWidth) / 2;
			} else {
				contentWidth = MAX_TEXT_WIDTH;
			}
		}

		// 确保内容宽度为正数
		if (contentWidth < 100) contentWidth = 100;

		// column-gap = viewWidth - contentWidth，确保每页宽度正好等于视口宽度
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
			this._currentPage = Math.max(1, Math.min(newPage, this._totalPages));
			this.options.onPageChange?.(this._currentPage, this._totalPages);
		}
	}

	// ── 控制栏 ───────────────────────────────────────────────

	private createControls(): void {
		this.removeControls();

		// 兜底：清理 viewContent 上可能残留的旧浮层 DOM
		if (this.viewContent) {
			this.viewContent.querySelectorAll(
				'.deeppdf-page-controls, .deeppdf-page-book-label, .deeppdf-page-btn'
			).forEach(el => el.remove());
		}

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

		// 底部浮层：章节名（左） · 页码（中）
		this.controlsBar = document.createElement('div');
		this.controlsBar.className = 'deeppdf-page-controls';

		// 左侧：章节名
		if (this.chapterName) {
			this.chapterIndicator = document.createElement('span');
			this.chapterIndicator.className = 'deeppdf-page-chapter';
			this.chapterIndicator.textContent = this.chapterName;
			this.controlsBar.appendChild(this.chapterIndicator);
		}

		// 中间：页码
		this.pageIndicator = document.createElement('span');
		this.pageIndicator.className = 'deeppdf-page-num';
		this.controlsBar.appendChild(this.pageIndicator);

		// 左上角：书名浮层
		if (this.bookName) {
			this.bookLabelEl = document.createElement('div');
			this.bookLabelEl.className = 'deeppdf-page-book-label';
			this.bookLabelEl.textContent = this.bookName;
		}

		if (this.viewContent) {
			if (getComputedStyle(this.viewContent).position === 'static') {
				this.viewContent.style.position = 'relative';
			}
			this.viewContent.appendChild(this.leftBtn);
			this.viewContent.appendChild(this.rightBtn);
			this.viewContent.appendChild(this.controlsBar);
			if (this.bookLabelEl) this.viewContent.appendChild(this.bookLabelEl);
		}
	}

	private updateControls(): void {
		if (!this._isActive) return;

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
		this.bookLabelEl?.remove();
		this.leftBtn = null;
		this.rightBtn = null;
		this.controlsBar = null;
		this.bookLabelEl = null;
		this.progressFill = null;
		this.pageIndicator = null;
		this.chapterIndicator = null;
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

		const currentViewWidth = this.scrollView.clientWidth;
		if (currentViewWidth === 0) return;

		// 宽度没变，跳过（纯滚动不应触发重排）
		if (currentViewWidth === this.lastKnownViewWidth) return;

		this.lastKnownViewWidth = currentViewWidth;

		// 记录调整前的进度百分比
		const prevProgress = this._totalPages > 1
			? (this._currentPage - 1) / (this._totalPages - 1) : 0;

		// 1. 同步更新 CSS 变量（列宽和间距），这会立即触发浏览器的重排
		this.updateColumnSizing();

		// 2. CSS column 重排需要多帧才能稳定，用双 rAF 确保布局完成
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				if (!this._isActive || !this.scrollView) return;

				// 计算新的总页数（用实际列位置，不用 scrollWidth）
				this._totalPages = this.countActualPages();

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
				this.scrollView.scrollLeft = (this._currentPage - 1) * this.scrollView.clientWidth;

				// 更新底部控件
				this.updateControls();
			});
		});
	}

	// ── MutationObserver ──────────────────────────────────────

	private setupMutationObserver(): void {
		this.teardownMutationObserver();
		if (!this.container) return;

		this.mutationObserver = new MutationObserver(() => {
			if (!this._isActive) return;
			if (this.resizeTimer) clearTimeout(this.resizeTimer);
			this.resizeTimer = setTimeout(() => {
				if (!this._isActive) return;
				const newTotal = this.countActualPages();
				if (newTotal !== this._totalPages) {
					serviceLog(`[PagePaginator] DOM 变化校正: ${this._totalPages} → ${newTotal} 页`);
					this._totalPages = newTotal;
					this.updateControls();
				}
			}, 200);
		});
		this.mutationObserver.observe(this.container, { childList: true, subtree: true });
	}

	private teardownMutationObserver(): void {
		this.mutationObserver?.disconnect();
		this.mutationObserver = null;
	}
}
