/**
 * DeepReader 书库视图
 * 在主面板全屏展示书库，支持自适应宽度布局
 */

import { ItemView, type WorkspaceLeaf, Notice, TFile } from 'obsidian';
import type { DeepReaderPluginInterface } from '../agent/tools/context/vault.js';
import { ConfirmModal } from '../components/confirm-modal.js';
import type { DeepPDFSettings } from '../config/settings.js';
import { loadArchivedBookIds, toggleArchive, batchToggleArchive } from '../pageindex/archive.js';
import { PAGEINDEX_DIR } from '../pageindex/paths.js';
import { stripFileExtension, type IndexListItem, type Booklist } from '../types/index.js';
import { bookNotePath } from '../utils/book-paths.js';
import { error as logError, uiLog } from '../utils/logger.js';
import { getVaultPath } from '../utils/mobile-fs.js';
import { getVaultAdapter } from '../utils/vault.js';
import { SyncStateManager } from '../weread/sync/state.js';
import { sanitizeFileName } from '../weread/utils/file.js';
import { createBookCard, createBooklistCard, updateCoverHeights, addCoverActions } from './library/library-card-builder.js';
import type { CardBuilderContext } from './library/library-card-builder.js';
import { CoverManager } from './library/library-cover-manager.js';
import { FilterSort } from './library/library-filter-sort.js';
import type { FilterType, SortKey } from './library/library-filter-sort.js';
import { IndexLifecycle } from './library/library-index-lifecycle.js';
import { MultiSelectController } from './library/library-multi-select.js';
import { WereadBridge } from './library/library-weread-bridge.js';

export const LIBRARY_VIEW_TYPE = 'deeppdf-library-view';

const PROCESSING_STATUSES = new Set([
	'processing', 'indexing', 'started', 'created',
	'running', 'active', 'pending', 'queued', 'uploading',
]);
const READY_STATUSES = new Set(['ready', 'completed', 'success']);

// SVG 图标
const Icons = {
	add: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
	booksStacked: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M2 7v14.5A2.5 2.5 0 0 0 4.5 22H8" opacity="0.5"/></svg>`,
	archive: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>`,
};

export interface LibraryViewOptions {
	indexes: IndexListItem[];
	selectedIndexId: string | null;
	selectedBooklistId?: string | null;
	onIndexChange?: (indexId: string) => void;
	onCreateIndex?: () => Promise<void>;
	onDeleteIndex?: (indexId: string) => Promise<IndexListItem[] | undefined>;
	onRefresh?: () => Promise<IndexListItem[]>;
	onDownloadCover?: (indexId: string, pdfName: string) => Promise<string | null>;
	onStartThematicReading?: (booklist: Booklist, reenter?: boolean) => void;
	plugin: DeepReaderPluginInterface;
}

export class LibraryView extends ItemView {
	private options: LibraryViewOptions;
	private indexes: IndexListItem[] = [];
	private selectedIndexId: string | null = null;
	private selectedBooklistId: string | null = null;
	private searchQuery: string = '';
	private gridEl: HTMLElement | null = null;
	private searchInputEl: HTMLInputElement | null = null;
	private cardElements: Map<string, HTMLElement> = new Map();
	private resizeObserver: ResizeObserver | null = null;
	private _searchDebounce: number | null = null;
	private _showArchived: boolean = false;
	private _archivedBookIds: Set<string> = new Set();
	private _archiveBtnEl: HTMLElement | null = null;
	private _filterBtnEl: HTMLElement | null = null;

	// Sub-modules (initialized in onOpen)
	private coverManager!: CoverManager;
	private filterSort!: FilterSort;
	private multiSelect!: MultiSelectController;
	private wereadBridge!: WereadBridge;
	private indexLifecycle!: IndexLifecycle;

	constructor(leaf: WorkspaceLeaf, options: LibraryViewOptions) {
		super(leaf);
		this.options = options;
	}

	getViewType(): string {
		return LIBRARY_VIEW_TYPE;
	}

	getDisplayText(): string {
		return '书库';
	}

	getIcon(): string {
		return 'lucide-library';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('deeppdf-library-view');

		// Initialize sub-modules
		this.coverManager = new CoverManager(this.app, {
			getIndexes: () => this.indexes,
			getDisplayName: (name) => this.getDisplayName(name),
			plugin: { manifest: { id: this.options.plugin.manifest.id } },
			addCoverActions: (coverEl, indexId) => {
				addCoverActions(coverEl, indexId, {
					getIndexes: () => this.indexes,
					wereadMappingCache: this.wereadBridge.getMappingCache(),
					archivedBookIds: this._archivedBookIds,
					actions: {
						onHandleZlibDownload: (idx) => this.wereadBridge.handleZlibDownload(idx),
						onHandleLocalAssociate: (idx) => this.wereadBridge.handleLocalAssociate(idx),
						onHandleArchiveBook: (idx) => this.handleArchiveBook(idx),
						onConfirmDelete: (idx) => this.confirmDelete(idx),
					},
				});
			},
		});

		this.wereadBridge = new WereadBridge({
			app: this.app,
			plugin: { manifest: { id: this.options.plugin.manifest.id }, settings: this.options.plugin.settings },
			getIndexes: () => this.indexes,
			setIndexes: (indexes) => { this.indexes = indexes; },
			getCardElements: () => this.cardElements,
			getDisplayName: (name) => this.getDisplayName(name),
			onRefreshIndexes: () => this.indexLifecycle.refreshIndexes(),
			onLoadWereadMapping: () => this.wereadBridge.loadWereadMapping(),
			onRenderGrid: () => this.renderGrid(),
			onUpdateCardProgress: (id, progress, status, message) => this.indexLifecycle.updateCardProgress(id, progress, status, message),
			onCreateBookCard: (index) => this.buildBookCard(index),
		});

		this.filterSort = new FilterSort({
			getIndexes: () => this.indexes,
			isWereadLinked: (index) => this.wereadBridge.isWereadLinked(index),
			onRenderGrid: () => this.renderGrid(),
		});

		this.multiSelect = new MultiSelectController(
			{
				getIndexes: () => this.indexes,
				getCoverCache: () => this.coverManager.getCache(),
				containerEl: this.containerEl.children[1] as HTMLElement,
				options: { onStartThematicReading: this.options.onStartThematicReading },
				onRenderGrid: () => this.renderGrid(),
				onExitMultiSelect: () => {},
				onHandleBatchArchive: () => this.handleBatchArchive(),
			},
			() => this._showArchived,
		);

		this.indexLifecycle = new IndexLifecycle(this.getLifecycleCallbacks());

		// 从 state 初始化数据
		const state = this.getState() as { indexes?: IndexListItem[]; selectedIndexId?: string | null; selectedBooklistId?: string | null } | null;
		if (state?.indexes) {
			this.indexes = state.indexes;
			this.selectedIndexId = state.selectedIndexId ?? null;
			this.selectedBooklistId = state.selectedBooklistId ?? null;
		}


		// 串行加载：归档状态 → 渲染
		this.loadArchiveState().then(() => {
			this.render();
			// 总是从文件系统刷新索引状态，避免恢复过时的 processing 快照
			this.app.workspace.onLayoutReady(() => {
				this.indexLifecycle.refreshIndexes();
			});
		});
	}

	async onClose(): Promise<void> {
		this.cleanup();
	}

	async setState(state: unknown): Promise<void> {
		const s = state as { indexes?: IndexListItem[]; selectedIndexId?: string; selectedBooklistId?: string } | null;
		if (s?.indexes) {
			this.indexes = s.indexes;
			this.selectedIndexId = s.selectedIndexId ?? null;
			this.selectedBooklistId = s.selectedBooklistId ?? null;

			if (this.gridEl) {
				this.render();
				// 从持久化 state 恢复后，刷新真实状态（state 可能包含过时的 processing 快照）
				this.indexLifecycle.refreshIndexes();
			}
		}
	}

	private cleanup(): void {
		this.indexLifecycle.cleanup();
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
	}

	private getLifecycleCallbacks() {
		return {
			app: this.app,
			plugin: { settings: this.options.plugin.settings },
			getIndexes: () => this.indexes,
			setIndexes: (indexes: IndexListItem[]) => { this.indexes = indexes; },
			getCardElements: () => this.cardElements,
			getDisplayName: (name: string) => this.getDisplayName(name),
			onRenderGrid: () => this.renderGrid(),
			onCreateBookCard: (index: IndexListItem) => this.buildBookCard(index),
			onRefreshIndexes: () => this.options.onRefresh?.() ?? Promise.resolve(undefined),
			onRefreshExternal: () => this.options.onRefresh?.() ?? Promise.resolve([]),
			externalIndexes: this.options.indexes,
			coverManager: this.coverManager,
			gridEl: this.gridEl,
			options: {
				onRefresh: this.options.onRefresh,
				onDownloadCover: this.options.onDownloadCover,
			},
		};
	}

	private render(): void {
		const container = this.containerEl.children[1];
		container.empty();

		this.filterSort.setFilterBtnEl(null);

		// 标题行
		const header = container.createDiv({ cls: 'deeppdf-lib-header' });
		header.createEl('h2', { text: '我的书库', cls: 'deeppdf-lib-title' });

		// 工具栏
		const toolbar = container.createDiv({ cls: 'deeppdf-lib-toolbar' });

		const searchWrap = toolbar.createDiv({ cls: 'deeppdf-lib-search' });
		this.searchInputEl = searchWrap.createEl('input', {
			cls: 'deeppdf-lib-search-input',
			attr: { type: 'text', placeholder: '搜索书籍...' }
		});
		this.searchInputEl.addEventListener('input', () => {
			if (this._searchDebounce != null) clearTimeout(this._searchDebounce);
			this._searchDebounce = window.setTimeout(() => {
				this.searchQuery = this.searchInputEl?.value || '';
				this.renderGrid();
			}, 300);
		});

		const addBtn = toolbar.createEl('button', { cls: 'deeppdf-lib-add-btn' });
		addBtn.innerHTML = Icons.add;
		addBtn.title = '添加书籍';
		addBtn.addEventListener('click', () => this.indexLifecycle.handleAddDocument());

		const thematicBtn = toolbar.createEl('button', { cls: 'deeppdf-lib-add-btn' });
		thematicBtn.innerHTML = Icons.booksStacked;
		thematicBtn.title = '主题阅读';
		thematicBtn.addEventListener('click', () => this.multiSelect.toggleMultiSelectMode());

		this._archiveBtnEl = toolbar.createEl('button', { cls: 'deeppdf-lib-add-btn' });
		this._archiveBtnEl.innerHTML = Icons.archive;
		this._archiveBtnEl.title = '显示已归档';
		this._archiveBtnEl.addEventListener('click', () => this.toggleArchiveView());

		this._filterBtnEl = toolbar.createEl('button', { cls: 'deeppdf-lib-filter-btn' });
		this.filterSort.setFilterBtnEl(this._filterBtnEl);
		this.filterSort.updateFilterBtnLabel();
		this._filterBtnEl.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			const btn = this.filterSort.getFilterBtnEl();
			if (btn) this.filterSort.showFilterPanel(btn);
		});

		this.gridEl = container.createDiv({ cls: 'deeppdf-lib-grid' });

		// Re-create IndexLifecycle with updated gridEl reference
		const lcCallbacks = this.getLifecycleCallbacks();
		this.indexLifecycle = new IndexLifecycle({
			...lcCallbacks,
			gridEl: this.gridEl,
		});

		this.renderGrid();
	}

	private renderGrid(): void {
		if (!this.gridEl) return;

		// 首次渲染时异步加载微信读书映射
		if (this.wereadBridge.getMappingCache().size === 0) {
			this.wereadBridge.loadWereadMapping().then(() => {
				if (this.wereadBridge.getMappingCache().size > 0) {
					this.renderGrid();
				}
			});
		}

		this.cardElements.clear();
		this.indexLifecycle.getLastIndexStates().clear();
		this.coverManager.clearLoading();

		this.gridEl.innerHTML = '';

		// 1. 文本搜索过滤
		let filtered = this.searchQuery
			? this.indexes.filter(idx =>
				  idx.pdf_name.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
				  (idx.author && idx.author.toLowerCase().includes(this.searchQuery.toLowerCase()))
			  )
			: [...this.indexes];

		// 2. 类型筛选
		const filterType = this.filterSort.getFilterType();
		if (filterType !== 'all') {
			if (filterType === 'weread') {
				filtered = filtered.filter(idx => this.wereadBridge.isWereadLinked(idx));
			} else {
				filtered = filtered.filter(idx => (idx.fileType || 'pdf') === filterType);
			}
		}

		// 3. 作者筛选
		const filterAuthor = this.filterSort.getFilterAuthor();
		if (filterAuthor !== null) {
			if (filterAuthor === '__unknown__') {
				filtered = filtered.filter(idx => !idx.author);
			} else {
				filtered = filtered.filter(idx => idx.author === filterAuthor);
			}
		}

		// 4. 归档过滤
		if (!this._showArchived) {
			filtered = filtered.filter(idx => !this._archivedBookIds.has(idx.id));
		} else {
			filtered = filtered.filter(idx => this._archivedBookIds.has(idx.id));
		}

		if (filtered.length === 0) {
			this.gridEl.innerHTML = `
				<div class="deeppdf-lib-empty">
					<div class="deeppdf-lib-empty-icon"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
					<div class="deeppdf-lib-empty-text">${this.searchQuery || filterType !== 'all' || filterAuthor ? '未找到匹配书籍' : '书架空空如也'}</div>
					<div class="deeppdf-lib-empty-hint">${this.searchQuery || filterType !== 'all' || filterAuthor ? '' : '点击右上角 + 添加第一本书'}</div>
				</div>
			`;
			return;
		}

		// 5. 排序
		const sorted = this.filterSort.applySort(filtered);

		// 渲染历史书单卡片
		const history: Booklist[] = this.options.plugin.settings?.booklistHistory || [];
		if (history.length > 0 && !this.searchQuery && filterType === 'all' && filterAuthor === null) {
			history.forEach(booklist => {
				const card = this.buildBooklistCard(booklist);
				this.gridEl!.appendChild(card);
			});
		}

		sorted.forEach(index => {
			const card = this.buildBookCard(index);
			this.gridEl!.appendChild(card);
			this.cardElements.set(index.id, card);
			this.indexLifecycle.getLastIndexStates().set(index.id, {
				status: index.status || 'unknown',
				progress: index.progress_percent || 0,
				message: index.message || '',
			});
		});

		// Start polling if needed
		const hasProcessing = filtered.some(idx => {
			const rawStatus = (idx.status || '').toLowerCase();
			return PROCESSING_STATUSES.has(rawStatus);
		});
		if (hasProcessing) {
			this.indexLifecycle.startProgressPolling();
		}

		requestAnimationFrame(() => {
			if (this.gridEl) updateCoverHeights(this.gridEl);
		});

		if (!this.resizeObserver) {
			this.resizeObserver = new ResizeObserver(() => {
				requestAnimationFrame(() => {
					if (this.gridEl) updateCoverHeights(this.gridEl);
				});
			});
		}
		if (this.gridEl) this.resizeObserver.observe(this.gridEl);
	}

	private buildBookCard(index: IndexListItem): HTMLElement {
		const ctx: CardBuilderContext = {
			coverManager: this.coverManager,
			wereadBridge: this.wereadBridge,
			getDisplayName: (name) => this.getDisplayName(name),
			getIndexes: () => this.indexes,
			selectedIndexId: this.selectedIndexId,
			selectedBooklistId: this.selectedBooklistId,
			wereadMappingCache: this.wereadBridge.getMappingCache(),
			archivedBookIds: this._archivedBookIds,
			multiSelectMode: this.multiSelect.isActive(),
			selectedBookIds: this.multiSelect.getSelectedBookIds(),
			maxMultiSelect: MultiSelectController.MAX_MULTI_SELECT,
			actions: {
				onRetryIndex: (idx) => this.indexLifecycle.retryIndex(idx),
				onHandleSelect: (idx) => this.handleSelect(idx),
				onToggleBookSelection: (id, card) => this.multiSelect.toggleBookSelection(id, card),
				onHandleArchiveBook: (idx) => this.handleArchiveBook(idx),
				onConfirmDelete: (idx) => this.confirmDelete(idx),
				onHandleZlibDownload: (idx) => this.wereadBridge.handleZlibDownload(idx),
				onHandleLocalAssociate: (idx) => this.wereadBridge.handleLocalAssociate(idx),
				onDeleteBooklistHistory: (id) => this.deleteBooklistHistory(id),
				onSelectBooklist: (booklist) => {
					this.selectedIndexId = null;
					this.selectedBooklistId = booklist.id;
					this.renderGrid();
					this.options.onStartThematicReading?.(booklist, true);
				},
			},
		};
		return createBookCard(index, ctx);
	}

	private buildBooklistCard(booklist: Booklist): HTMLElement {
		const ctx: CardBuilderContext = {
			coverManager: this.coverManager,
			wereadBridge: this.wereadBridge,
			getDisplayName: (name) => this.getDisplayName(name),
			getIndexes: () => this.indexes,
			selectedIndexId: this.selectedIndexId,
			selectedBooklistId: this.selectedBooklistId,
			wereadMappingCache: this.wereadBridge.getMappingCache(),
			archivedBookIds: this._archivedBookIds,
			multiSelectMode: this.multiSelect.isActive(),
			selectedBookIds: this.multiSelect.getSelectedBookIds(),
			maxMultiSelect: MultiSelectController.MAX_MULTI_SELECT,
			actions: {
				onRetryIndex: () => {},
				onHandleSelect: () => {},
				onToggleBookSelection: () => {},
				onHandleArchiveBook: () => {},
				onConfirmDelete: () => {},
				onHandleZlibDownload: () => {},
				onHandleLocalAssociate: () => {},
				onDeleteBooklistHistory: (id) => this.deleteBooklistHistory(id),
				onSelectBooklist: (bl) => {
					this.selectedIndexId = null;
					this.selectedBooklistId = bl.id;
					this.renderGrid();
					this.options.onStartThematicReading?.(bl, true);
				},
			},
		};
		return createBooklistCard(booklist, ctx);
	}

	private async handleSelect(index: IndexListItem): Promise<void> {
		const rawStatus = (index.status || 'unknown').toLowerCase();
		const isProcessing = PROCESSING_STATUSES.has(rawStatus);

		if (isProcessing) {
			return;
		}

		// 微信读书：已关联则打开阅读，未关联则打开笔记
		if (index.fileType === 'weread') {
			if (this.wereadBridge.getMappingCache().has(index.id)) {
				const adapter = getVaultAdapter(this.app);
				if (adapter) {
					try {
						const mappingPath = `${PAGEINDEX_DIR}/weread/mapping.json`;
						if (await adapter.exists(mappingPath)) {
							const raw = await adapter.read(mappingPath);
							const mapping = JSON.parse(raw) as { mappings?: Record<string, { deepReaderBookId?: string }> };
							const m = mapping.mappings?.[index.id];
							if (m?.deepReaderBookId) {
								this.selectedIndexId = m.deepReaderBookId;
								this.options.onIndexChange?.(m.deepReaderBookId);
								this.selectedBooklistId = null;
								return;
							}
						}
					} catch { /* fallthrough */ }
				}
			}
			// 未关联：打开笔记
			const safeName = sanitizeFileName(index.pdf_name);
			const notePath = bookNotePath(safeName);
			const file = this.app.vault.getAbstractFileByPath(notePath);
			if (file) {
				this.app.workspace.getLeaf(false).openFile(file as TFile);
			} else {
				new Notice('笔记文件不存在，请重新同步', 3000);
			}
			return;
		}

		const chaptersExist = this.checkBookChaptersExist(index.pdf_name);

		if (!chaptersExist) {
			new Notice('章节文件不存在，请重新索引书籍', 3000);
			return;
		}

		if (READY_STATUSES.has(rawStatus)) {
			const targetFile = this.getLastReadChapterFile(index.pdf_name) || this.getFirstChapterFile(index.pdf_name);
			if (targetFile) {
				// 如果文件已在某个 tab 中打开，激活该 tab；否则在新 tab 中打开
				const existingLeaf = this.app.workspace.getLeavesOfType('markdown')
					.find(l => (l.view as import('obsidian').MarkdownView)?.file?.path === targetFile.path);
				if (existingLeaf) {
					await this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
				} else {
					await this.app.workspace.getLeaf(false).openFile(targetFile);
				}
				this.options.onIndexChange?.(index.id);
				return;
			}
		}

		this.selectedIndexId = index.id;
		this.selectedBooklistId = null;
		this.renderGrid();
		this.options.onIndexChange?.(index.id);
	}

	private getFirstChapterFile(pdfName: string): TFile | null {
		const folderName = this.getDisplayName(pdfName);
		const folderPath = `DeepReader/${folderName}`;
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder) return null;

		const files = this.app.vault.getMarkdownFiles();
		const chapterFiles = files
			.filter(f => f.path.startsWith(folderPath + '/'))
			.sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));
		return chapterFiles[0] || null;
	}

	/**
	 * 查找该书最近阅读的章节文件。
	 * 通过 ReadingModeService 的 lastReadAt 历史匹配书籍文件夹下的文件。
	 * 如果该书从未阅读过，返回 null（调用方 fallback 到第一个章节）。
	 */
	private getLastReadChapterFile(pdfName: string): TFile | null {
		const readingMode = this.options.plugin.readingModeService;
		if (!readingMode) return null;

		const folderName = this.getDisplayName(pdfName);
		const folderPath = `DeepReader/${folderName}`;
		const recentFile = readingMode.findMostRecentInFolder(folderPath);
		if (!recentFile) return null;

		const file = this.app.vault.getAbstractFileByPath(recentFile);
		return file instanceof TFile ? file : null;
	}

	private checkBookChaptersExist(pdfName: string): boolean {
		const folderName = this.getDisplayName(pdfName);
		const folderPath = `DeepReader/${folderName}`;

		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder) return false;

		const files = this.app.vault.getMarkdownFiles();
		const chapterFiles = files.filter(f => f.path.startsWith(folderPath + '/'));

		return chapterFiles.length > 3;
	}

	getDisplayName(pdfName: string): string {
		let name = pdfName;
		if (name.toLowerCase().endsWith('.pdf')) name = name.slice(0, -4);
		if (name.toLowerCase().endsWith('.epub')) name = name.slice(0, -5);

		const separators = ['：', ':', '—', '-', '｜', '|'];
		for (const sep of separators) {
			if (name.includes(sep)) {
				name = name.split(sep)[0].trim();
				break;
			}
		}

		return name;
	}

	/* ── 归档相关 ── */

	private async loadArchiveState(): Promise<void> {
		try {
			this._archivedBookIds = await loadArchivedBookIds(getVaultPath(this.app));
		} catch (e) {
			logError('[DeepPDF] 加载归档状态失败:', e);
			this._archivedBookIds = new Set();
		}
	}

	private toggleArchiveView(): void {
		this._showArchived = !this._showArchived;
		if (this._archiveBtnEl) {
			this._archiveBtnEl.toggleClass('is-active', this._showArchived);
			this._archiveBtnEl.title = this._showArchived ? '隐藏已归档' : '显示已归档';
		}
		this.renderGrid();
	}

	private async handleArchiveBook(index: IndexListItem): Promise<void> {
		try {
			const bookId = index.id;
			const newState = await toggleArchive(getVaultPath(this.app), bookId);
			if (newState) {
				this._archivedBookIds.add(bookId);
				new Notice(`已归档「${this.getDisplayName(index.pdf_name)}」`, 3000);
			} else {
				this._archivedBookIds.delete(bookId);
				new Notice(`已取消归档「${this.getDisplayName(index.pdf_name)}」`, 3000);
			}
			this.renderGrid();
		} catch (e) {
			logError('[DeepPDF] 归档操作失败:', e);
			new Notice('归档操作失败', 3000);
		}
	}

	private async handleBatchArchive(): Promise<void> {
		try {
			const archive = !this._showArchived;
			const bookIds = Array.from(this.multiSelect.getSelectedBookIds());
			const count = await batchToggleArchive(getVaultPath(this.app), bookIds, archive);
			if (count > 0) {
				if (archive) {
					for (const id of bookIds) this._archivedBookIds.add(id);
					new Notice(`已归档 ${count} 本书`, 3000);
				} else {
					for (const id of bookIds) this._archivedBookIds.delete(id);
					new Notice(`已取消归档 ${count} 本书`, 3000);
				}
			}
			this.multiSelect.exitMultiSelectMode();
			this.renderGrid();
		} catch (e) {
			logError('[DeepPDF] 批量归档失败:', e);
			new Notice('批量归档失败', 3000);
		}
	}

	private deleteBooklistHistory(booklistId: string): void {
		const history = this.options.plugin.settings?.booklistHistory || [];
		const booklist = history.find((b: Booklist) => b.id === booklistId);
		if (!booklist) return;
		new Notice(`已移除书单「${booklist.name}」`, 2000);
		const updated = history.filter((b: Booklist) => b.id !== booklistId);
		this.options.plugin.settings.booklistHistory = updated;
		this.options.plugin.saveSettings();
		if (this.selectedBooklistId === booklistId) {
			this.selectedBooklistId = null;
		}
		this.renderGrid();
	}

	updateBooklistName(booklistId: string, newName: string): void {
		const card = this.gridEl?.querySelector(`[data-booklist-id="${booklistId}"]`);
		if (!card) return;
		const titleEl = card.querySelector('.deeppdf-lib-book-title');
		if (titleEl) titleEl.textContent = newName;
	}

	private confirmDelete(index: IndexListItem): void {
		const displayName = this.getDisplayName(index.pdf_name);

		new ConfirmModal(
			this.app,
			'删除索引',
			`确定要删除「${displayName}」吗？此操作将同时删除索引数据和本地导出文件。`,
			async () => {
				const indexToRemove = index.id;
				this.indexes = this.indexes.filter(idx => idx.id !== indexToRemove);

				if (this.selectedIndexId === indexToRemove) {
					this.selectedIndexId = null;
				}

				this.renderGrid();

				try {
					if (index.fileType === 'weread') {
						const adapter = getVaultAdapter(this.app);
						if (adapter) {
							const stateManager = new SyncStateManager(adapter, this.options.plugin.manifest.id);
							await stateManager.excludeBook(index.id);
						}
					}

					if (this.options.onDeleteIndex) {
						const updatedIndexes = await this.options.onDeleteIndex(indexToRemove);
						if (updatedIndexes) {
							this.indexes = updatedIndexes;
							this.renderGrid();
						}
					} else {
						await this.options.onRefresh?.();
					}

					new Notice(`已删除「${displayName}」的索引和导出数据`);
				} catch (error) {
					uiLog.error('[LibraryView] 删除失败:', error);
					new Notice('删除失败');
				}
			},
			{
				confirmLabel: '删除',
				isDestructive: true,
			}
		).open();
	}

	public updateIndexes(indexes: IndexListItem[], selectedId?: string): void {
		this.indexes = [...indexes];
		if (selectedId !== undefined) {
			this.selectedIndexId = selectedId;
			this.selectedBooklistId = null;
		}
		this.renderGrid();
	}
}
