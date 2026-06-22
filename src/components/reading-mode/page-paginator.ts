/**
 * PagePaginator - 基于字符数的分页器
 *
 * 每页最多 maxCharsPerPage 个字符，通过隐藏/显示块元素实现翻页。
 * 进度条 sticky 定位在当前 tab 视图底部，翻页按钮 fixed 在视口两侧。
 * 激活时锁住 .markdown-preview-view 的滚动。
 */

import { Platform } from 'obsidian';
import { serviceLog } from '../../utils/logger.js';
import { isViewportFullyExpanded } from './viewport-state.js';

export interface PagePaginatorOptions {
	container: HTMLElement;                    // .markdown-preview-sizer
	onNavigatePrev: () => Promise<boolean>;
	onNavigateNext: () => Promise<boolean>;
	hasPrevChapter: () => boolean;             // 是否有上一章
	hasNextChapter: () => boolean;             // 是否有下一章
	chapterName?: string;                      // 当前章节名称
	bookName?: string;                         // 当前书名
	autoDualPage?: boolean;                    // 是否开启自动双页
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
	/** 待恢复页码：在 _totalPages 稳定后应用（避免 setCurrentPage 被 clamp 到 1） */
	private _pendingRestorePage: number | null = null;

	private leftBtn: HTMLElement | null = null;
	private rightBtn: HTMLElement | null = null;
	private controlsBar: HTMLElement | null = null;
	private progressFill: HTMLElement | null = null;
	private pageIndicator: HTMLElement | null = null;
	private chapterIndicator: HTMLElement | null = null;
	private bookLabelEl: HTMLElement | null = null;

	private touchStartX = 0;
	private touchStartY = 0;
	private touchStartTime = 0;
	private touchHandlerStart: ((e: TouchEvent) => void) | null = null;
	private touchHandlerEnd: ((e: TouchEvent) => void) | null = null;

	private resizeObserver: ResizeObserver | null = null;
	private resizeTimer: ReturnType<typeof setTimeout> | null = null;
	private scrollHandler: ((e: Event) => void) | null = null;
	private mutationObserver: MutationObserver | null = null;
	private verifyTimer: ReturnType<typeof setTimeout> | null = null;
	private chapterName: string;
	private bookName: string;
	private lastKnownViewWidth: number = 0;
	private lastActiveDualPageMode: boolean = false;
	private _rerenderRafIds: number[] = [];

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
		this.lastActiveDualPageMode = this.isDualPageMode;
	}

	isActive(): boolean { return this._isActive; }
	getTotalPages(): number { return this._totalPages; }
	getCurrentPage(): number { return this._currentPage; }

	get isDualPageMode(): boolean {
		if (!this.scrollView) return false;
		if (!this.options.autoDualPage) return false;
		const app = (window as any).app;
		if (!app) return false;
		return isViewportFullyExpanded(app) && this.scrollView.clientWidth >= 1400;
	}

	/** 实时判断是否已滚动到最后一页(不依赖 _currentPage 缓存) */
	isAtLastPage(): boolean {
		if (!this._isActive || !this.scrollView) return false;
		if (this._totalPages <= 1) return true;
		const EPS = 1;
		const max = this.scrollView.scrollWidth - this.scrollView.clientWidth;
		return this.scrollView.scrollLeft + EPS >= max;
	}

	/** 实时判断是否已滚动到第一页 */
	isAtFirstPage(): boolean {
		if (!this._isActive || !this.scrollView) return false;
		return this.scrollView.scrollLeft <= 1;
	}

	/**
	 * 获取当前页的纯文本内容
	 * 使用 simplified 方法：获取所有段落文本，按页码估算当前页内容
	 */
	getCurrentPageText(): string {
		if (!this._isActive || !this.scrollView) return '';

		const sizer = this.scrollView.querySelector('.markdown-preview-sizer') as HTMLElement;
		if (!sizer) return '';

		// 获取所有段落文本
		const paragraphs = Array.from(sizer.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, li'));
		const allTexts = paragraphs
			.map(p => p.textContent?.trim())
			.filter(t => t && t.length > 0);

		if (allTexts.length === 0) return '';

		// 简单估算：按页码比例截取文本
		const totalParagraphs = allTexts.length;
		const currentPage = this._currentPage;
		const totalPages = this._totalPages;

		if (totalPages <= 1) {
			// 只有一页，返回所有文本
			return allTexts.join('\n\n');
		}

		// 按页码比例计算当前页/屏的段落范围
		const step = this.isDualPageMode ? 2 : 1;
		const startIdx = Math.floor((currentPage - 1) * totalParagraphs / totalPages);
		const endIdx = Math.floor(Math.min(currentPage - 1 + step, totalPages) * totalParagraphs / totalPages);

		return allTexts.slice(startIdx, endIdx).join('\n\n');
	}

	getPageParagraphs(pageNumber?: number): { element: HTMLElement; text: string }[] {
		if (!this._isActive || !this.scrollView) return [];

		const sizer = this.scrollView.querySelector('.markdown-preview-sizer') as HTMLElement;
		if (!sizer) return [];

		const allParagraphs = Array.from(
			sizer.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, li'),
		);

		const viewWidth = this.scrollView.clientWidth;
		if (viewWidth === 0) return [];

		const containerRect = this.scrollView.getBoundingClientRect();
		const scrollLeft = this.scrollView.scrollLeft;
		const pageSize = this.isDualPageMode ? viewWidth / 2 : viewWidth;
		const currentPage = pageNumber !== undefined ? pageNumber : this._currentPage;

		return allParagraphs
			.map(el => {
				const rect = el.getBoundingClientRect();
				if (rect.width === 0 && rect.height === 0) {
					return { element: el, text: '', page: -1 };
				}
				// 元素在可滚动内容中的绝对水平位置
				const absoluteLeft = rect.left - containerRect.left + scrollLeft;
				// 计算它所在的页码 (1-based)，加 5px 容差防止边缘浮点误差
				const page = Math.floor((absoluteLeft + 5) / pageSize) + 1;
				return { element: el, text: el.textContent?.trim() || '', page };
			})
			.filter(p => {
				if (p.text.length === 0) return false;
				if (this.isDualPageMode) {
					return p.page === currentPage || p.page === currentPage + 1;
				}
				return p.page === currentPage;
			})
			.map(p => ({ element: p.element, text: p.text }));
	}

	/**
	 * 高亮指定的段落元素（TTS 朗读时使用）
	 * @param el 要高亮的 DOM 元素
	 */
	highlightElement(el: HTMLElement): void {
		this.clearHighlight();
		el.classList.add('deeppdf-tts-reading-paragraph');
	}

	/** 清除段落高亮 */
	clearHighlight(): void {
		if (!this.scrollView) return;
		this.scrollView
			.querySelectorAll('.deeppdf-tts-reading-paragraph')
			.forEach(el => el.classList.remove('deeppdf-tts-reading-paragraph'));
	}

	/** 外部设置当前页码（用于 blockId 跳转后同步状态） */
	setCurrentPage(page: number): void {
		// 布局未稳定（_totalPages=0 或 _totalPages < page）时延后应用
		// 避免 setCurrentPage 在 paginateAndShow 早期被 clamp 到 1
		if (this._totalPages === 0 || page > this._totalPages) {
			this._pendingRestorePage = page;
			return;
		}
		const next = Math.max(1, Math.min(page, this._totalPages));
		if (next === this._currentPage) {
			// 即便页码未变，也要尊重"用户主动跳到这里"的事实，
			// 取消可能仍在排队的不同页码延后恢复
			this.cancelPendingRestoreIfDifferent(next);
			return;
		}
		this._currentPage = next;
		this.cancelPendingRestoreIfDifferent(next);
		this.updateControls();
		this.options.onPageChange?.(this._currentPage, this._totalPages);
	}

	/**
	 * 取消延后恢复：如果 _pendingRestorePage 已设且与 newPage 不同，
	 * 视为用户主动跳转覆盖了恢复意图。清空避免后续 applyPendingRestorePage 覆盖用户选择。
	 */
	private cancelPendingRestoreIfDifferent(newPage: number): void {
		if (this._pendingRestorePage != null && this._pendingRestorePage !== newPage) {
			this._pendingRestorePage = null;
		}
	}

	/**
	 * 应用待恢复的页码（在 _totalPages 稳定后由 calculatePages / handleResize / verifyTimer 触发）
	 * 解决 paginateAndShow 早期 setCurrentPage(2) 被 clamp 到 1 的问题
	 */
	private applyPendingRestorePage(): void {
		if (this._pendingRestorePage == null) return;
		const target = this._pendingRestorePage;
		if (this._totalPages === 0 || target > this._totalPages) return;
		this._pendingRestorePage = null;
		if (target === this._currentPage) return;
		this._currentPage = target;
		this.updateControls();
		this.options.onPageChange?.(this._currentPage, this._totalPages);
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
		this.setupTouchListeners();

		// 延迟验证：multi-column 布局可能在初始化时尚未完全计算
		this.verifyTimer = setTimeout(() => {
			if (!this._isActive) return;
			this.updateColumnSizing();
			const newTotal = this.countActualPages();
			if (newTotal !== this._totalPages) {
				serviceLog(`[PagePaginator] 延迟校正: ${this._totalPages} → ${newTotal} 页`);
				this._totalPages = newTotal;
				this.updateControls();
			}
			this.applyPendingRestorePage();
		}, 600);

		serviceLog(`[PagePaginator] CSS Column Pagination activated`);
	}

	nextPage(): boolean {
		if (!this._isActive || !this.scrollView) return false;

		if (this.isAtLastPage()) {
			// At last page: navigate to next chapter.
			// After navigation, paginator is destroyed and re-created for the new chapter,
			// so the caller should not try to continue paging.
			this.onNavigateNext();
			return false;
		}

		let stepWidth = this.scrollView.clientWidth;
		if (this.isDualPageMode) {
			const style = window.getComputedStyle(this.scrollView);
			const paddingLeft = parseFloat(style.paddingLeft) || 0;
			const paddingRight = parseFloat(style.paddingRight) || 0;
			const columnGap = parseFloat(style.columnGap) || 0;
			stepWidth = this.scrollView.clientWidth - paddingLeft - paddingRight + columnGap;
		}
		this.scrollView.scrollBy({ left: stepWidth, behavior: 'smooth' });
		// 同步更新 _currentPage，确保 getPageParagraphs 等依赖它的方法
		// 在 scroll 事件触发前也能读到正确的页码
		const step = this.isDualPageMode ? 2 : 1;
		this._currentPage = Math.min(this._currentPage + step, this._totalPages);
		this.options.onPageChange?.(this._currentPage, this._totalPages);
		this.forceRerender();
		return true;
	}

	prevPage(): boolean {
		if (!this._isActive || !this.scrollView) return false;

		if (this.isAtFirstPage()) {
			// At first page: navigate to previous chapter (opens at last remembered page).
			this.onNavigatePrev();
			return false;
		}

		let stepWidth = this.scrollView.clientWidth;
		if (this.isDualPageMode) {
			const style = window.getComputedStyle(this.scrollView);
			const paddingLeft = parseFloat(style.paddingLeft) || 0;
			const paddingRight = parseFloat(style.paddingRight) || 0;
			const columnGap = parseFloat(style.columnGap) || 0;
			stepWidth = this.scrollView.clientWidth - paddingLeft - paddingRight + columnGap;
		}
		this.scrollView.scrollBy({ left: -stepWidth, behavior: 'smooth' });
		const step = this.isDualPageMode ? 2 : 1;
		this._currentPage = Math.max(1, this._currentPage - step);
		this.options.onPageChange?.(this._currentPage, this._totalPages);
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
		const id1 = requestAnimationFrame(() => {
			this._rerenderRafIds.splice(this._rerenderRafIds.indexOf(id1), 1);
			if (!this._isActive || !this.scrollView) return;

			// 方法1：修改 column-width 触发重排
			const currentWidth = this.scrollView.style.getPropertyValue('--deeppdf-col-width');
			this.scrollView.style.setProperty('--deeppdf-col-width', `${parseInt(currentWidth) + 0.1}px`);

			const id2 = requestAnimationFrame(() => {
				this._rerenderRafIds.splice(this._rerenderRafIds.indexOf(id2), 1);
				if (!this._isActive || !this.scrollView) return;
				this.scrollView.style.setProperty('--deeppdf-col-width', currentWidth);

				// 方法2：修改 overflow 触发重排
				this.scrollView.style.overflow = 'hidden';
				const id3 = requestAnimationFrame(() => {
					this._rerenderRafIds.splice(this._rerenderRafIds.indexOf(id3), 1);
					if (!this._isActive || !this.scrollView) return;
					this.scrollView.style.overflow = '';
				});
				this._rerenderRafIds.push(id3);
			});
			this._rerenderRafIds.push(id2);
		});
		this._rerenderRafIds.push(id1);
	}

	destroy(): void {
		this._isActive = false;
		if (this.verifyTimer) { clearTimeout(this.verifyTimer); this.verifyTimer = null; }
		this._rerenderRafIds.forEach(id => cancelAnimationFrame(id));
		this._rerenderRafIds = [];
		this.removeControls();
		this.teardownResizeObserver();
		this.teardownScrollListener();
		this.teardownMutationObserver();
		this.teardownTouchListeners();
		this._totalPages = 0;
		this._currentPage = 1;
		this._pendingRestorePage = null;
		serviceLog('[PagePaginator] destroyed');
	}

	private calculatePages(): void {
		if (!this.scrollView) return;

		// 双重 rAF：第一帧等当前渲染完成，第二帧确保 CSS 变量变化触发的重排已计算
		requestAnimationFrame(() => {
			if (!this.scrollView) return;
			requestAnimationFrame(() => {
				if (!this.scrollView) return;

				this.updateColumnSizing();
				this._totalPages = this.countActualPages();

				this.options.onPageChange?.(this._currentPage, this._totalPages);
				this.updateCurrentPageFromScroll();
				this.updateControls();
				this.applyPendingRestorePage();
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

		const scrollW = this.scrollView.scrollWidth;
		if (this.isDualPageMode) {
			const style = window.getComputedStyle(this.scrollView);
			const paddingLeft = parseFloat(style.paddingLeft) || 0;
			const paddingRight = parseFloat(style.paddingRight) || 0;
			const columnGap = parseFloat(style.columnGap) || 0;

			const colWidth = (viewWidth - paddingLeft - paddingRight - columnGap) / 2;
			const colStep = colWidth + columnGap;
			const N = Math.ceil((scrollW - paddingLeft - paddingRight + columnGap) / colStep);
			return N;
		}

		const pageSize = viewWidth;

		// 优先用 scrollWidth（CSS multi-column 撑开后的真实内容宽度）
		if (scrollW > viewWidth) {
			return Math.ceil(scrollW / pageSize);
		}

		// 兜底：通过 sizer offsetWidth
		const sizer = this.scrollView.querySelector('.markdown-preview-sizer') as HTMLElement;
		if (sizer && sizer.offsetWidth > viewWidth) {
			return Math.ceil(sizer.offsetWidth / pageSize);
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

		if (this.isDualPageMode) {
			this.scrollView.classList.add('deeppdf-dual-page');
			this.scrollView.style.setProperty('--deeppdf-col-width', 'auto');
			this.scrollView.style.setProperty('--deeppdf-col-gap', '60px');
			this.scrollView.style.setProperty('--deeppdf-side-padding', '50px');
			return;
		}
		this.scrollView.classList.remove('deeppdf-dual-page');

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

		let step = viewWidth;
		if (this.isDualPageMode) {
			const style = window.getComputedStyle(this.scrollView);
			const paddingLeft = parseFloat(style.paddingLeft) || 0;
			const paddingRight = parseFloat(style.paddingRight) || 0;
			const columnGap = parseFloat(style.columnGap) || 0;
			step = viewWidth - paddingLeft - paddingRight + columnGap;
		}

		// 计算当前处于第几页 (1-based)
		const newPage = this.isDualPageMode
			? Math.round(scrollLeft / step) * 2 + 1
			: Math.round(scrollLeft / step) + 1;

		if (newPage !== this._currentPage) {
			this._currentPage = Math.max(1, Math.min(newPage, this._totalPages));
			this.options.onPageChange?.(this._currentPage, this._totalPages);
			// 用户在等待期间手动滚动 → 取消延后恢复，尊重用户意图
			this.cancelPendingRestoreIfDifferent(this._currentPage);
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
			if (this.isDualPageMode) {
				const leftPage = this._currentPage;
				const rightPage = leftPage + 1;
				if (rightPage <= this._totalPages) {
					this.pageIndicator.textContent = `${leftPage}-${rightPage} / ${this._totalPages}`;
				} else {
					this.pageIndicator.textContent = `${leftPage} / ${this._totalPages}`;
				}
			} else {
				this.pageIndicator.textContent = `${this._currentPage} / ${this._totalPages}`;
			}
		}

		// 边界页且有上/下一章时，不隐藏按钮（用户可点击跳章）
		const atFirstPage = this.isAtFirstPage();
		const atLastPage = this.isAtLastPage();
		this.leftBtn?.classList.toggle(DISABLED_CLASS, atFirstPage && !this.options.hasPrevChapter());
		this.rightBtn?.classList.toggle(DISABLED_CLASS, atLastPage && !this.options.hasNextChapter());
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

	updateLayout(): void {
		if (!this._isActive || !this.scrollView) return;
		this.handleResize();
	}

	private handleResize(): void {
		if (!this._isActive || !this.scrollView) return;

		const currentViewWidth = this.scrollView.clientWidth;
		if (currentViewWidth === 0) return;

		const isDual = this.isDualPageMode;
		const dualModeChanged = isDual !== this.lastActiveDualPageMode;

		// 宽度没变且双页模式状态也没变，跳过（纯滚动不应触发重排）
		if (currentViewWidth === this.lastKnownViewWidth && !dualModeChanged) return;

		this.lastActiveDualPageMode = isDual;
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
				const clampedPage = Math.max(1, Math.min(newPage, this._totalPages));
				this._currentPage = this.isDualPageMode
					? (Math.floor((clampedPage - 1) / 2) * 2 + 1)
					: clampedPage;

				// 立刻强制同步滚动，对齐内容盒子
				let step = this.scrollView.clientWidth;
				if (this.isDualPageMode) {
					const style = window.getComputedStyle(this.scrollView);
					const paddingLeft = parseFloat(style.paddingLeft) || 0;
					const paddingRight = parseFloat(style.paddingRight) || 0;
					const columnGap = parseFloat(style.columnGap) || 0;
					step = this.scrollView.clientWidth - paddingLeft - paddingRight + columnGap;
				}
				const targetScroll = this.isDualPageMode
					? Math.floor((this._currentPage - 1) / 2) * step
					: (this._currentPage - 1) * step;
				this.scrollView.scrollLeft = targetScroll;

				// 更新底部控件
				this.updateControls();
				this.applyPendingRestorePage();
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
					this.applyPendingRestorePage();
				}
			}, 200);
		});
		this.mutationObserver.observe(this.container, { childList: true, subtree: true });
	}

	private teardownMutationObserver(): void {
		this.mutationObserver?.disconnect();
		this.mutationObserver = null;
	}

	private setupTouchListeners(): void {
		if (!this.scrollView || !Platform.isMobile) return;

		this.touchHandlerStart = (e: TouchEvent) => {
			if (e.touches.length !== 1) return;
			this.touchStartX = e.touches[0].clientX;
			this.touchStartY = e.touches[0].clientY;
			this.touchStartTime = Date.now();
		};

		this.touchHandlerEnd = (e: TouchEvent) => {
			if (e.changedTouches.length !== 1) return;
			const deltaX = e.changedTouches[0].clientX - this.touchStartX;
			const deltaY = e.changedTouches[0].clientY - this.touchStartY;
			const deltaTime = Date.now() - this.touchStartTime;

			// 识别为滑动手势的阈值：
			// 1. 水平滑动距离必须大于 50px
			// 2. 垂直偏角不可太大 (deltaY 的绝对值小于 deltaX 的绝对值的 60%)
			// 3. 时间在 400ms 以内（快速滑动）
			if (
				Math.abs(deltaX) > 50 &&
				Math.abs(deltaY) < Math.abs(deltaX) * 0.6 &&
				deltaTime < 400
			) {
				if (deltaX < 0) {
					this.nextPage();
				} else {
					this.prevPage();
				}
			}
		};

		this.scrollView.addEventListener('touchstart', this.touchHandlerStart, { passive: true });
		this.scrollView.addEventListener('touchend', this.touchHandlerEnd, { passive: true });
	}

	private teardownTouchListeners(): void {
		if (this.scrollView) {
			if (this.touchHandlerStart) {
				this.scrollView.removeEventListener('touchstart', this.touchHandlerStart);
				this.touchHandlerStart = null;
			}
			if (this.touchHandlerEnd) {
				this.scrollView.removeEventListener('touchend', this.touchHandlerEnd);
				this.touchHandlerEnd = null;
			}
		}
	}
}
