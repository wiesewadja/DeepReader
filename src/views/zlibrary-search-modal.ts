/**
 * Z-Library 搜索 Modal — 在 Modal 中展示搜索结果并选择下载
 */

import { Modal, App, Notice } from 'obsidian';
import { ZLibraryClient } from '../zlibrary/client';
import type { ZLibraryBook, SearchResult } from '../zlibrary/types';

const FORMAT_ORDER: Record<string, number> = {
	epub: 0,
	pdf: 1,
	mobi: 2,
	azw3: 3,
	djvu: 4,
};

export class ZLibrarySearchModal extends Modal {
	private result: 'select' | 'cancel' = 'cancel';
	private selectedBook: ZLibraryBook | null = null;

	constructor(
		app: App,
		private query: string,
		private client: ZLibraryClient,
		private onSelect?: (book: ZLibraryBook) => void,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('deeppdf-zlib-modal');

		contentEl.createEl('h2', { text: `搜索：${this.query}` });

		const listEl = contentEl.createDiv({ cls: 'deeppdf-zlib-results' });
		listEl.createEl('div', { text: '搜索中...', cls: 'deeppdf-zlib-loading' });

		this.doSearch(listEl);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	private async doSearch(container: HTMLElement): Promise<void> {
		let result: SearchResult;
		try {
			result = await this.client.search(this.query, {
				limit: 10,
				languages: ['chinese'],
			});
			// 无结果时去掉语言限制重试
			if (result.books.length === 0) {
				result = await this.client.search(this.query, { limit: 10 });
			}
		} catch (e: any) {
			container.empty();
			const errorDiv = container.createDiv({ cls: 'deeppdf-zlib-error' });
			errorDiv.createEl('span', { text: `搜索失败：${e.message}` });
			errorDiv.createEl('button', { text: '重试' }).addEventListener('click', () => {
				container.empty();
				container.createEl('div', { text: '搜索中...', cls: 'deeppdf-zlib-loading' });
				this.doSearch(container);
			});
			return;
		}

		container.empty();

		if (result.books.length === 0) {
			container.createEl('div', {
				text: '未找到相关书籍',
				cls: 'deeppdf-zlib-empty',
			});
			return;
		}

		// 排序：EPUB > PDF > MOBI，同格式按年份倒序
		const sorted = [...result.books].sort((a, b) => {
			const fa = FORMAT_ORDER[a.extension?.toLowerCase()] ?? 99;
			const fb = FORMAT_ORDER[b.extension?.toLowerCase()] ?? 99;
			if (fa !== fb) return fa - fb;
			return (b.year ?? 0) - (a.year ?? 0);
		});

		for (const book of sorted) {
			this.renderBookCard(container, book);
		}

		// 底部分页信息
		container.createEl('div', {
			text: `共 ${result.total} 个结果（第 ${result.page}/${result.totalPages} 页）`,
			cls: 'deeppdf-zlib-pagination',
		});
	}

	private renderBookCard(container: HTMLElement, book: ZLibraryBook): void {
		const card = container.createDiv({ cls: 'deeppdf-zlib-card' });

		// 封面
		const coverWrap = card.createDiv({ cls: 'deeppdf-zlib-cover' });
		if (book.cover) {
			const img = coverWrap.createEl('img');
			img.src = book.cover;
			img.alt = book.title;
			img.loading = 'lazy';
			img.addEventListener('error', () => {
				img.replaceWith(createPlaceholder(coverWrap));
			});
		} else {
			createPlaceholder(coverWrap);
		}

		// 信息区
		const info = card.createDiv({ cls: 'deeppdf-zlib-info' });
		info.createEl('div', { text: book.title, cls: 'deeppdf-zlib-title' });
		info.createEl('div', { text: book.author, cls: 'deeppdf-zlib-author' });

		const meta = info.createDiv({ cls: 'deeppdf-zlib-meta' });
		meta.createEl('span', {
			text: book.extension?.toUpperCase() ?? '?',
			cls: `deeppdf-zlib-tag deeppdf-zlib-tag-${book.extension?.toLowerCase()}`,
		});
		meta.createEl('span', { text: book.filesizeString || `${(book.filesize / 1024 / 1024).toFixed(1)} MB` });
		if (book.year) meta.createEl('span', { text: `${book.year}` });
		if (book.language) meta.createEl('span', { text: book.language });

		// 点击选择
		card.addEventListener('click', () => {
			this.selectedBook = book;
			this.result = 'select';
			this.onSelect?.(book);
			this.close();
		});
	}
}

function createPlaceholder(parent: HTMLElement): HTMLElement {
	return parent.createDiv({ cls: 'deeppdf-zlib-placeholder', text: '无封面' });
}
