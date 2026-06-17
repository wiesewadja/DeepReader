/**
 * 卡片构建辅助函数
 * 无状态纯函数集合，接收参数返回 DOM 元素
 */

import type { IndexListItem, Booklist } from '../../types/index.js';
import { stripFileExtension } from '../../types/index.js';
import type { CoverManager } from './library-cover-manager.js';
import type { WereadBridge } from './library-weread-bridge.js';

const PROCESSING_STATUSES = new Set([
	'processing', 'indexing', 'started', 'created',
	'running', 'active', 'pending', 'queued', 'uploading',
]);
const FAILED_STATUSES = new Set(['failed', 'error']);

// SVG 图标
const Icons = {
	trash: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
	check: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`,
	checkCircle: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" fill="#10b981" stroke="#10b981"/><polyline points="16 9 10.5 14.5 8 12" stroke="white" stroke-width="2.5"/></svg>`,
	loading: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
	archive: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>`,
};

export interface CardBuilderContext {
	coverManager: CoverManager;
	wereadBridge: WereadBridge;
	getDisplayName: (pdfName: string) => string;
	getIndexes: () => IndexListItem[];
	selectedIndexId: string | null;
	selectedBooklistId: string | null;
	wereadMappingCache: Set<string>;
	archivedBookIds: Set<string>;
	multiSelectMode: boolean;
	selectedBookIds: Set<string>;
	maxMultiSelect: number;
	actions: {
		onRetryIndex: (index: IndexListItem) => void;
		onHandleSelect: (index: IndexListItem) => void;
		onToggleBookSelection: (indexId: string, card: HTMLElement) => void;
		onHandleArchiveBook: (index: IndexListItem) => void;
		onConfirmDelete: (index: IndexListItem) => void;
		onHandleZlibDownload: (index: IndexListItem) => void;
		onHandleLocalAssociate: (index: IndexListItem) => void;
		onDeleteBooklistHistory: (booklistId: string) => void;
		onSelectBooklist: (booklist: Booklist) => void;
	};
}

export function createBookCard(
	index: IndexListItem,
	ctx: CardBuilderContext,
): HTMLElement {
	const card = document.createElement('div');
	card.className = 'deeppdf-lib-book-card';

	const isSelected = index.id === ctx.selectedIndexId;
	if (isSelected) {
		card.classList.add('selected');
	}

	const rawStatus = (index.status || 'unknown').toLowerCase();
	let statusClass = 'ready';

	if (PROCESSING_STATUSES.has(rawStatus)) {
		statusClass = 'processing';
	} else if (['pending', 'queued', 'waiting'].includes(rawStatus)) {
		statusClass = 'queued';
	} else if (FAILED_STATUSES.has(rawStatus)) {
		statusClass = 'failed';
	}

	let bookName = index.pdf_name;
	bookName = stripFileExtension(bookName);
	const coverName = ctx.getDisplayName(bookName);

	const coverEl = card.createDiv({ cls: 'deeppdf-lib-book-cover' });
	if (statusClass === 'processing') {
		const coverContentEl = coverEl.createDiv({ cls: 'deeppdf-lib-cover-content' });
		const cachedCover = ctx.coverManager.getCache().get(index.id);
		if (cachedCover) {
			const imgEl = coverContentEl.createEl('img', { cls: 'deeppdf-lib-cover-img', attr: { style: 'filter: brightness(0.5);' } });
			imgEl.src = cachedCover;
			imgEl.alt = bookName;
			imgEl.addEventListener('error', () => {
				ctx.coverManager.getCache().delete(index.id);
				if (!ctx.coverManager.getLoadingCovers().has(index.id)) {
					ctx.coverManager.getLoadingCovers().add(index.id);
					ctx.coverManager.loadCoverAndDisplay(index.id, coverName, coverEl);
				}
			});
		} else {
			coverContentEl.innerHTML = ctx.coverManager.createCoverPlaceholder(coverName);
			if (!ctx.coverManager.getLoadingCovers().has(index.id)) {
				ctx.coverManager.getLoadingCovers().add(index.id);
				ctx.coverManager.loadCoverAndDisplay(index.id, coverName, coverEl);
			}
		}

		// Loading spinner overlay
		const spinnerEl = coverEl.createDiv({ cls: 'deeppdf-lib-cover-loading', attr: { style: 'position: absolute; top: 0; left: 0; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; color: #fff; z-index: 2;' } });
		spinnerEl.innerHTML = Icons.loading;

		const progress = index.progress_percent || 0;
		const message = index.message || '';
		const progressEl = coverEl.createDiv({ cls: 'deeppdf-lib-progress-overlay', attr: { style: 'z-index: 2;' } });
		progressEl.createDiv({ cls: 'deeppdf-lib-progress-bar', attr: { style: `width: ${progress}%` } });

		const progressInfo = progressEl.createDiv({ cls: 'deeppdf-lib-progress-info' });
		progressInfo.createDiv({ cls: 'deeppdf-lib-progress-text', text: `${Math.round(progress)}%` });

		if (message) {
			progressInfo.createDiv({ cls: 'deeppdf-lib-progress-message', text: message });
		}
	} else if (statusClass === 'failed') {
		coverEl.innerHTML = ctx.coverManager.createCoverPlaceholder(coverName, true);

		const retryBtn = coverEl.createDiv({ cls: 'deeppdf-lib-cover-btn retry' });
		retryBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>`;
		retryBtn.title = '重试索引';
		retryBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			ctx.actions.onRetryIndex(index);
		});
	} else {
		const cachedCover = ctx.coverManager.getCache().get(index.id);
		if (cachedCover) {
			coverEl.innerHTML = '';
			const imgEl = coverEl.createEl('img', { cls: 'deeppdf-lib-cover-img' });
			imgEl.src = cachedCover;
			imgEl.alt = bookName;
			imgEl.addEventListener('error', () => {
				ctx.coverManager.getCache().delete(index.id);
				if (!ctx.coverManager.getLoadingCovers().has(index.id)) {
					ctx.coverManager.getLoadingCovers().add(index.id);
					ctx.coverManager.loadCoverAndDisplay(index.id, coverName, coverEl);
				}
			});
		} else {
			coverEl.innerHTML = ctx.coverManager.createCoverPlaceholder(coverName);

			if (!ctx.coverManager.getLoadingCovers().has(index.id)) {
				ctx.coverManager.getLoadingCovers().add(index.id);
				ctx.coverManager.loadCoverAndDisplay(index.id, coverName, coverEl);
			}
		}

		addCoverActions(coverEl, index.id, ctx);
	}

	if (isSelected && statusClass === 'ready') {
		const checkMark = coverEl.createDiv({ cls: 'deeppdf-lib-cover-check' });
		checkMark.innerHTML = Icons.checkCircle;
	}

	const infoEl = card.createDiv({ cls: 'deeppdf-lib-book-info' });

	const titleEl = infoEl.createDiv({ cls: 'deeppdf-lib-book-title', text: bookName });
	titleEl.title = index.pdf_name;

	const typeKey = index.fileType || 'pdf';
	const typeTag = typeKey === 'weread' ? '微信读书' : typeKey.toUpperCase();

	const tagRow = infoEl.createDiv({ cls: 'deeppdf-lib-book-tag-row' });
	tagRow.createDiv({ cls: `deeppdf-lib-type-tag deeppdf-lib-type-${typeKey}`, text: typeTag });

	if (index.fileType === 'weread') {
		tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-zlibrary', text: '待下载' });
	} else if (ctx.wereadBridge.isWereadLinked(index)) {
		tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-weread', text: '微信读书' });
	}

	const wereadStats = ctx.wereadBridge.getStatsCache().get(index.id);
	if (wereadStats) {
		if (wereadStats.noteCount > 0) {
			tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-stat', text: `${wereadStats.noteCount} 笔记` });
		}
		if (wereadStats.reviewCount > 0) {
			tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-stat', text: `${wereadStats.reviewCount} 评论` });
		}
	}

	if (index.author) {
		infoEl.createDiv({ cls: 'deeppdf-lib-book-author', text: index.author });
	}

	const metaParts: string[] = [];
	if (index.node_count > 0) {
		metaParts.push(`${index.node_count} 章节`);
	}
	if (wereadStats?.readingTime) {
		metaParts.push(wereadStats.readingTime);
	}
	if (index.created_at) {
		const date = new Date(index.created_at);
		metaParts.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
	}
	if (metaParts.length > 0) {
		infoEl.createDiv({ cls: 'deeppdf-lib-book-meta', text: metaParts.join(' · ') });
	}

	card.addEventListener('click', () => {
		if (ctx.multiSelectMode) {
			if (statusClass !== 'ready') return;
			ctx.actions.onToggleBookSelection(index.id, card);
		} else {
			if (statusClass === 'ready') {
				ctx.actions.onHandleSelect(index);
			}
		}
	});

	if (ctx.multiSelectMode && statusClass === 'ready') {
		card.classList.add('deeppdf-lib-multi-selectable');
		if (ctx.selectedBookIds.has(index.id)) {
			card.classList.add('deeppdf-lib-multi-selected');
		}
		if (ctx.selectedBookIds.size >= ctx.maxMultiSelect && !ctx.selectedBookIds.has(index.id)) {
			card.classList.add('deeppdf-lib-multi-disabled');
		}
		const checkbox = card.createDiv({ cls: 'deeppdf-lib-checkbox' });
		if (ctx.selectedBookIds.has(index.id)) {
			checkbox.classList.add('checked');
			checkbox.innerHTML = Icons.check;
		}
	}

	return card;
}

export function createBooklistCard(
	booklist: Booklist,
	ctx: CardBuilderContext,
): HTMLElement {
	const card = document.createElement('div');
	card.className = 'deeppdf-lib-book-card deeppdf-lib-booklist-card';
	card.dataset.booklistId = booklist.id;

	const isSelected = booklist.id === ctx.selectedBooklistId;
	if (isSelected) {
		card.classList.add('selected');
	}

	const coverEl = card.createDiv({ cls: 'deeppdf-lib-book-cover deeppdf-lib-booklist-covers' });
	const maxShow = Math.min(booklist.bookIds.length, 3);
	for (let i = 0; i < maxShow; i++) {
		const cover = coverEl.createDiv({ cls: 'deeppdf-lib-inline-cover' });
		const bookId = booklist.bookIds[i];
		const cachedUrl = ctx.coverManager.getCache().get(bookId);
		if (cachedUrl) {
			cover.style.backgroundImage = `url(${cachedUrl})`;
		} else {
			const idx = ctx.getIndexes().find(ix => ix.id === bookId);
			const bookName = stripFileExtension(idx?.pdf_name || booklist.bookNames[i] || '');
			if (bookName) {
				ctx.coverManager.loadCoverForBooklistCard(bookId, bookName, cover);
			}
		}
	}

	const infoEl = card.createDiv({ cls: 'deeppdf-lib-book-info' });
	infoEl.createDiv({ cls: 'deeppdf-lib-book-title', text: booklist.name });

	const tagRow = infoEl.createDiv({ cls: 'deeppdf-lib-book-tag-row' });
	tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-booklist', text: '主题阅读' });

	const namesText = booklist.bookNames.slice(0, 3).join('、');
	const suffix = booklist.bookNames.length > 3 ? '…' : '';
	infoEl.createDiv({ cls: 'deeppdf-lib-book-author', text: namesText + suffix });

	if (booklist.createdAt) {
		const date = new Date(booklist.createdAt);
		infoEl.createDiv({ cls: 'deeppdf-lib-book-meta', text: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` });
	}

	const coverActions = coverEl.createDiv({ cls: 'deeppdf-lib-cover-actions' });
	const deleteBtn = coverActions.createDiv({ cls: 'deeppdf-lib-cover-btn delete' });
	deleteBtn.innerHTML = Icons.trash;
	deleteBtn.title = '移除书单';
	deleteBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		ctx.actions.onDeleteBooklistHistory(booklist.id);
	});

	if (isSelected) {
		const checkMark = coverEl.createDiv({ cls: 'deeppdf-lib-cover-check' });
		checkMark.innerHTML = Icons.checkCircle;
	}

	card.addEventListener('click', () => {
		ctx.actions.onSelectBooklist(booklist);
	});

	return card;
}

export function updateCoverHeights(gridEl: HTMLElement): void {
	const cards = gridEl.querySelectorAll('.deeppdf-lib-book-card');
	cards.forEach(card => {
		const coverEl = card.querySelector('.deeppdf-lib-book-cover') as HTMLElement | null;
		if (!coverEl) return;
		const cardWidth = (card as HTMLElement).offsetWidth;
		if (cardWidth > 0) {
			const height = Math.round(cardWidth * 4 / 3);
			coverEl.style.height = `${height}px`;
		}
	});
}

export function addCoverActions(
	coverEl: HTMLElement,
	indexId: string,
	ctx: {
		getIndexes: () => IndexListItem[];
		wereadMappingCache: Set<string>;
		archivedBookIds: Set<string>;
		actions: {
			onHandleZlibDownload: (index: IndexListItem) => void;
			onHandleLocalAssociate: (index: IndexListItem) => void;
			onHandleArchiveBook: (index: IndexListItem) => void;
			onConfirmDelete: (index: IndexListItem) => void;
		};
	},
): void {
	const actionsOverlay = coverEl.createDiv({ cls: 'deeppdf-lib-cover-actions' });

	const index = ctx.getIndexes().find(idx => idx.id === indexId);
	if (index?.fileType === 'weread' && !ctx.wereadMappingCache.has(indexId)) {
		const cloudBtn = actionsOverlay.createDiv({ cls: 'deeppdf-lib-cover-btn cloud' });
		cloudBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`;
		cloudBtn.title = '从 Z-Library 下载';
		cloudBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			ctx.actions.onHandleZlibDownload(index);
		});

		const linkBtn = actionsOverlay.createDiv({ cls: 'deeppdf-lib-cover-btn link' });
		linkBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
		linkBtn.title = '从本地文件关联';
		linkBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			ctx.actions.onHandleLocalAssociate(index);
		});
	}

	const isArchived = ctx.archivedBookIds.has(indexId);
	const archiveBtn = actionsOverlay.createDiv({ cls: 'deeppdf-lib-cover-btn archive' });
	archiveBtn.innerHTML = Icons.archive;
	archiveBtn.title = isArchived ? '取消归档' : '归档';
	archiveBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const idx = ctx.getIndexes().find(i => i.id === indexId);
		if (idx) {
			ctx.actions.onHandleArchiveBook(idx);
		}
	});

	const deleteBtn = actionsOverlay.createDiv({ cls: 'deeppdf-lib-cover-btn delete' });
	deleteBtn.innerHTML = Icons.trash;
	deleteBtn.title = '删除索引';
	deleteBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		const idx = ctx.getIndexes().find(i => i.id === indexId);
		if (idx) {
			ctx.actions.onConfirmDelete(idx);
		}
	});
}
