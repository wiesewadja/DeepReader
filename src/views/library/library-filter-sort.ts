/**
 * 筛选与排序控制器
 * 管理筛选状态（类型、作者）和排序逻辑
 */

import type { IndexListItem } from '../../types/index.js';

export interface FilterSortCallbacks {
	getIndexes: () => IndexListItem[];
	isWereadLinked: (index: IndexListItem) => boolean;
	onRenderGrid: () => void;
}

export type FilterType = 'all' | 'pdf' | 'epub' | 'weread';
export type SortKey = 'time-desc' | 'time-asc' | 'name-asc' | 'name-desc' | 'author-asc' | 'author-desc' | 'status' | 'recent-read';

export class FilterSort {
	private filterType: FilterType = 'all';
	private filterAuthor: string | null = null;
	private sortKey: SortKey = 'recent-read';
	private _filterBtnEl: HTMLElement | null = null;
	private _activeDropdown: HTMLElement | null = null;

	constructor(private callbacks: FilterSortCallbacks) {}

	getFilterType(): FilterType { return this.filterType; }
	getFilterAuthor(): string | null { return this.filterAuthor; }
	getSortKey(): SortKey { return this.sortKey; }
	getFilterBtnEl(): HTMLElement | null { return this._filterBtnEl; }
	setFilterBtnEl(el: HTMLElement | null): void { this._filterBtnEl = el; }

	updateFilterBtnLabel(): void {
		if (!this._filterBtnEl) return;
		const hasFilter = this.filterType !== 'all' || this.filterAuthor !== null;
		this._filterBtnEl.textContent = hasFilter ? '筛选 ●' : '筛选';
	}

	showFilterPanel(anchor: HTMLElement): void {
		this.closeDropdown();
		const panel = document.body.createDiv({ cls: 'deeppdf-lib-filter-panel' });
		this._activeDropdown = panel;

		// ── 类型筛选 ──
		panel.createDiv({ cls: 'deeppdf-lib-filter-section-title', text: '类型' });
		const typeRow = panel.createDiv({ cls: 'deeppdf-lib-filter-chip-row' });
		const chipEls = new Map<string, HTMLElement>();

		const chipTypes: Array<{ key: FilterType; label: string }> = [
			{ key: 'all', label: '全部' },
			{ key: 'pdf', label: 'PDF' },
			{ key: 'epub', label: 'EPUB' },
			{ key: 'weread', label: '微信读书' },
		];
		for (const { key, label } of chipTypes) {
			const chip = typeRow.createDiv({ cls: 'deeppdf-lib-type-chip' });
			if (this.filterType === key) chip.classList.add('active');
			chip.textContent = `${label}(0)`;
			chip.addEventListener('click', (e) => {
				e.stopPropagation();
				this.filterType = key;
				for (const [, el] of chipEls) el.classList.remove('active');
				chip.classList.add('active');
				this.updateFilterBtnLabel();
				this.callbacks.onRenderGrid();
				this.updateFilterCounts(chipEls);
			});
			chipEls.set(key, chip);
		}
		this.updateFilterCounts(chipEls);

		// ── 排序 ──
		panel.createDiv({ cls: 'deeppdf-lib-filter-section-title', text: '排序' });
		const sortOptions: Array<{ key: SortKey; label: string }> = [
			{ key: 'recent-read', label: '最近阅读（默认）' },
			{ key: 'time-desc', label: '添加时间（最新优先）' },
			{ key: 'time-asc', label: '添加时间（最早优先）' },
			{ key: 'name-asc', label: '书名 A→Z' },
			{ key: 'name-desc', label: '书名 Z→A' },
			{ key: 'author-asc', label: '作者 A→Z' },
			{ key: 'author-desc', label: '作者 Z→A' },
			{ key: 'status', label: '按状态' },
		];
		for (const opt of sortOptions) {
			const item = panel.createDiv({ cls: 'deeppdf-lib-filter-option' });
			if (this.sortKey === opt.key) item.classList.add('active');
			item.textContent = opt.label;
			item.addEventListener('click', (e) => {
				e.stopPropagation();
				this.sortKey = opt.key;
				this.updateFilterBtnLabel();
				panel.querySelectorAll('.deeppdf-lib-filter-option').forEach(el => el.classList.remove('active'));
				item.classList.add('active');
				this.callbacks.onRenderGrid();
			});
		}

		// ── 作者 ──
		panel.createDiv({ cls: 'deeppdf-lib-filter-section-title', text: '作者' });
		const authorContainer = panel.createDiv({ cls: 'deeppdf-lib-filter-author-list' });

		const allAuthorItem = authorContainer.createDiv({ cls: 'deeppdf-lib-filter-option' });
		if (this.filterAuthor === null) allAuthorItem.classList.add('active');
		allAuthorItem.textContent = '全部作者';
		allAuthorItem.addEventListener('click', (e) => {
			e.stopPropagation();
			this.filterAuthor = null;
			this.updateFilterBtnLabel();
			authorContainer.querySelectorAll('.deeppdf-lib-filter-option').forEach(el => el.classList.remove('active'));
			allAuthorItem.classList.add('active');
			this.callbacks.onRenderGrid();
		});

		const authors = this.collectAuthors();
		for (const { name, count } of authors) {
			const item = authorContainer.createDiv({ cls: 'deeppdf-lib-filter-option' });
			const displayName = name === '__unknown__' ? '未知作者' : name;
			if (this.filterAuthor === name) item.classList.add('active');
			item.textContent = `${displayName} (${count})`;
			item.addEventListener('click', (e) => {
				e.stopPropagation();
				this.filterAuthor = name;
				this.updateFilterBtnLabel();
				authorContainer.querySelectorAll('.deeppdf-lib-filter-option').forEach(el => el.classList.remove('active'));
				item.classList.add('active');
				this.callbacks.onRenderGrid();
			});
		}

		// ── 底部重置 ──
		if (this.filterType !== 'all' || this.filterAuthor !== null || this.sortKey !== 'recent-read') {
			const resetRow = panel.createDiv({ cls: 'deeppdf-lib-filter-reset-row' });
			const resetBtn = resetRow.createEl('button', { cls: 'deeppdf-lib-filter-reset-btn', text: '重置筛选' });
			resetBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.filterType = 'all';
				this.filterAuthor = null;
				this.sortKey = 'recent-read';
				this.updateFilterBtnLabel();
				this.closeDropdown();
				this.callbacks.onRenderGrid();
			});
		}

		// 定位
		const rect = anchor.getBoundingClientRect();
		panel.style.position = 'fixed';
		panel.style.top = `${rect.bottom + 4}px`;
		panel.style.right = `${window.innerWidth - rect.right}px`;

		// 点击外部关闭
		setTimeout(() => {
			document.addEventListener('click', this._dropdownCloseHandler, { once: true });
		}, 0);
	}

	private _dropdownCloseHandler = (): void => {
		this.closeDropdown();
	};

	closeDropdown(): void {
		if (this._activeDropdown) {
			this._activeDropdown.remove();
			this._activeDropdown = null;
		}
	}

	/** 更新筛选栏中各 chip 的数量显示 */
	updateFilterCounts(chipEls: Map<string, HTMLElement>): void {
		const base = this.callbacks.getIndexes();

		const counts: Record<string, number> = {
			all: base.length,
			pdf: base.filter(idx => (idx.fileType || 'pdf') === 'pdf').length,
			epub: base.filter(idx => idx.fileType === 'epub').length,
			weread: base.filter(idx => this.callbacks.isWereadLinked(idx)).length,
		};

		for (const [key, el] of chipEls) {
			const count = counts[key] ?? 0;
			const labels: Record<string, string> = { all: '全部', pdf: 'PDF', epub: 'EPUB', weread: '微信读书' };
			el.textContent = `${labels[key] || key}(${count})`;
		}
	}

	/** 收集去重作者列表，按书籍数量降序排列 */
	collectAuthors(): Array<{ name: string; count: number }> {
		const authorMap = new Map<string, number>();
		const base = this.callbacks.getIndexes();
		for (const idx of base) {
			const author = idx.author || '__unknown__';
			authorMap.set(author, (authorMap.get(author) || 0) + 1);
		}
		return Array.from(authorMap.entries())
			.map(([name, count]) => ({ name, count }))
			.sort((a, b) => b.count - a.count);
	}

	sortIndexes(indexes: IndexListItem[]): IndexListItem[] {
		const priority: Record<string, number> = {
			'processing': 0, 'indexing': 0, 'started': 0, 'running': 0,
			'pending': 1, 'queued': 1,
			'ready': 2, 'completed': 2, 'success': 2,
			'failed': 3, 'error': 3,
		};
		return [...indexes].sort((a, b) =>
			(priority[(a.status || '').toLowerCase()] ?? 4) -
			(priority[(b.status || '').toLowerCase()] ?? 4)
		);
	}

	applySort(indexes: IndexListItem[], getLastReadTime?: (index: IndexListItem) => number): IndexListItem[] {
		const sorted = [...indexes];
		const processingPriority: Record<string, number> = {
			'processing': 0, 'indexing': 0, 'started': 0, 'running': 0,
			'pending': 1, 'queued': 1,
			'ready': 2, 'completed': 2, 'success': 2,
			'failed': 3, 'error': 3,
		};
		const getStatusPriority = (idx: IndexListItem) =>
			processingPriority[(idx.status || '').toLowerCase()] ?? 4;

		const comparator = (a: IndexListItem, b: IndexListItem): number => {
			// processing/pending 状态始终置顶
			const pa = getStatusPriority(a);
			const pb = getStatusPriority(b);
			if (pa <= 1 && pb > 1) return -1;
			if (pb <= 1 && pa > 1) return 1;

			switch (this.sortKey) {
				case 'recent-read': {
					const timeA = getLastReadTime?.(a) ?? 0;
					const timeB = getLastReadTime?.(b) ?? 0;
					return timeB - timeA;
				}
				case 'time-desc':
					return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
				case 'time-asc':
					return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
				case 'name-asc':
					return a.pdf_name.localeCompare(b.pdf_name, 'zh');
				case 'name-desc':
					return b.pdf_name.localeCompare(a.pdf_name, 'zh');
				case 'author-asc':
					return (a.author || 'zzz').localeCompare(b.author || 'zzz', 'zh');
				case 'author-desc':
					return (b.author || 'zzz').localeCompare(a.author || 'zzz', 'zh');
				case 'status':
					return pa - pb;
				default:
					return 0;
			}
		};

		return sorted.sort(comparator);
	}
}
