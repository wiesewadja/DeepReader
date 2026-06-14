/**
 * 书籍详情视图 — 展示微信读书书籍的划线、笔记、热门划线
 * 参考 weread 插件的 wereadBookDetailView.ts
 */

import { ItemView, WorkspaceLeaf, setIcon, Notice } from 'obsidian';
import { getActivePluginId } from '../../pageindex/paths';
import { WereadApiClient } from '../api/client';
import type { WereadHighlightResponse, WereadReviewResponse, WereadBestBookmarksResponse } from '../types';

export const BOOK_DETAIL_VIEW_ID = 'weread-book-detail-view';

export class WereadBookDetailView extends ItemView {
	private bookId = '';
	private bookTitle = '';
	private bookCover = '';
	private localFilePath = '';
	private currentTab = 'highlights';

	private highlightResp?: WereadHighlightResponse;
	private reviewResp?: WereadReviewResponse;
	private popularResp?: WereadBestBookmarksResponse;

	private headerEl!: HTMLElement;
	private tabBarEl!: HTMLElement;
	private contentChildEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return BOOK_DETAIL_VIEW_ID;
	}

	getDisplayText(): string {
		return this.bookTitle || '书籍详情';
	}

	getIcon(): string {
		return 'book-open';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('weread-book-detail-view');

		this.headerEl = this.contentEl.createDiv({ cls: 'weread-book-detail-header' });
		this.tabBarEl = this.contentEl.createDiv({ cls: 'weread-book-detail-tabbar' });
		this.contentChildEl = this.contentEl.createDiv({ cls: 'weread-book-detail-content' });
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	getState(): Record<string, unknown> {
		return {
			bookId: this.bookId,
			bookTitle: this.bookTitle,
			bookCover: this.bookCover,
			localFilePath: this.localFilePath,
			currentTab: this.currentTab,
		};
	}

	async setState(state: Record<string, unknown>, _result: any): Promise<void> {
		const newBookId = (state.bookId as string) || '';
		const newTitle = (state.bookTitle as string) || '';

		if (newBookId !== this.bookId) {
			this.bookId = newBookId;
			this.bookTitle = (state.bookTitle as string) || '';
			this.bookCover = (state.bookCover as string) || '';
			this.localFilePath = (state.localFilePath as string) || '';
			this.currentTab = (state.currentTab as string) || 'highlights';

			if (this.bookId) {
				await this.loadData();
			}
			this.render();
		}
	}

	private async loadData(): Promise<void> {
		const pluginId = getActivePluginId();
		const apiKey = (this.app as any).plugins?.plugins?.[pluginId]?.settings?.wereadApiKey;
		if (!apiKey) return;

		const client = new WereadApiClient(apiKey);
		try {
			const [highlights, reviews, popular] = await Promise.allSettled([
				client.getHighlights(this.bookId),
				client.getReviews(this.bookId),
				client.getBestBookmarks(this.bookId),
			]);

			this.highlightResp = highlights.status === 'fulfilled' ? highlights.value : undefined;
			this.reviewResp = reviews.status === 'fulfilled' ? reviews.value : undefined;
			this.popularResp = popular.status === 'fulfilled' ? popular.value : undefined;
		} catch (e) {
			console.error('[WereadBookDetailView] 加载数据失败:', e);
		}
	}

	private render(): void {
		this.headerEl.empty();
		this.tabBarEl.empty();

		this.renderHeader();
		this.renderTabBar();
		this.renderContent();
	}

	private renderHeader(): void {
		const topRow = this.headerEl.createDiv({ cls: 'weread-book-detail-header-top' });

		// 封面
		if (this.bookCover) {
			const coverEl = topRow.createEl('img', { cls: 'weread-book-detail-cover' });
			coverEl.src = this.bookCover;
			coverEl.alt = this.bookTitle;
		}

		// 信息
		const info = topRow.createDiv({ cls: 'weread-book-detail-info' });
		info.createEl('h2', { text: this.bookTitle, cls: 'weread-book-detail-title' });

		// 统计
		const statsRow = info.createDiv({ cls: 'weread-book-detail-stats-row' });
		const highlightCount = this.highlightResp?.updated?.length || 0;
		const reviewCount = this.reviewResp?.totalCount || 0;
		const popularCount = this.popularResp?.items?.length || 0;

		if (highlightCount > 0) {
			const badge = statsRow.createDiv({ cls: 'weread-book-detail-stat' });
			setIcon(badge.createSpan(), 'highlighter');
			badge.createSpan({ text: ` 划线 ${highlightCount}` });
		}
		if (reviewCount > 0) {
			const badge = statsRow.createDiv({ cls: 'weread-book-detail-stat' });
			setIcon(badge.createSpan(), 'pencil');
			badge.createSpan({ text: ` 笔记 ${reviewCount}` });
		}
		if (popularCount > 0) {
			const badge = statsRow.createDiv({ cls: 'weread-book-detail-stat' });
			setIcon(badge.createSpan(), 'flame');
			badge.createSpan({ text: ` 热门 ${popularCount}` });
		}
	}

	private renderTabBar(): void {
		const tabs = [
			{ id: 'highlights', label: '划线', icon: 'highlighter' },
			{ id: 'notes', label: '笔记', icon: 'pencil' },
			{ id: 'popular', label: '热门划线', icon: 'flame' },
		];

		for (const tab of tabs) {
			const btn = this.tabBarEl.createEl('button', {
				cls: 'weread-book-detail-tab' + (this.currentTab === tab.id ? ' is-active' : ''),
			});
			setIcon(btn, tab.icon);
			btn.createSpan({ text: ` ${tab.label}` });
			btn.addEventListener('click', () => {
				this.currentTab = tab.id;
				this.tabBarEl.querySelectorAll('.weread-book-detail-tab').forEach(b => b.removeClass('is-active'));
				btn.addClass('is-active');
				this.renderContent();
			});
		}
	}

	private renderContent(): void {
		if (!this.contentChildEl) return;
		this.contentChildEl.empty();

		switch (this.currentTab) {
			case 'highlights':
				this.renderHighlightsTab(this.contentChildEl);
				break;
			case 'notes':
				this.renderNotesTab(this.contentChildEl);
				break;
			case 'popular':
				this.renderPopularTab(this.contentChildEl);
				break;
		}
	}

	private renderHighlightsTab(container: HTMLElement): void {
		const highlights = this.highlightResp?.updated || [];
		if (highlights.length === 0) {
			container.createDiv({ text: '暂无划线', cls: 'weread-book-detail-empty' });
			return;
		}

		for (const h of highlights) {
			const card = container.createDiv({ cls: 'weread-book-detail-hl-card' });
			const quoteRow = card.createDiv({ cls: 'weread-book-detail-hl-quote' });
			quoteRow.createDiv({ text: h.markText, cls: 'weread-book-detail-hl-text' });

			const meta = card.createDiv({ cls: 'weread-book-detail-hl-meta' });
			if (h.createTime) {
				meta.createSpan({ text: this.formatDateTime(h.createTime), cls: 'weread-book-detail-hl-meta-item' });
			}
		}
	}

	private renderNotesTab(container: HTMLElement): void {
		const reviews = this.reviewResp?.reviews || [];
		if (reviews.length === 0) {
			container.createDiv({ text: '暂无笔记', cls: 'weread-book-detail-empty' });
			return;
		}

		for (const r of reviews) {
			const card = container.createDiv({ cls: 'weread-book-detail-note-card' });
			const content = r.review?.content;
			if (content) {
				card.createDiv({ text: content, cls: 'weread-book-detail-note-content' });
			}
			const meta = card.createDiv({ cls: 'weread-book-detail-note-meta' });
			if (r.review?.createTime) {
				meta.createSpan({ text: this.formatDateTime(r.review.createTime), cls: 'weread-book-detail-hl-meta-item' });
			}
		}
	}

	private renderPopularTab(container: HTMLElement): void {
		const items = this.popularResp?.items || [];
		if (items.length === 0) {
			container.createDiv({ text: '暂无热门划线', cls: 'weread-book-detail-empty' });
			return;
		}

		for (const h of items) {
			const card = container.createDiv({ cls: 'weread-book-detail-popular-card' });
			card.createDiv({ text: h.markText, cls: 'weread-book-detail-popular-text' });

			const meta = card.createDiv({ cls: 'weread-book-detail-popular-meta' });
			if (h.totalCount > 0) {
				const countBadge = meta.createSpan({ cls: 'weread-book-detail-popular-count' });
				setIcon(countBadge, 'flame');
				countBadge.createSpan({ text: ` ${h.totalCount}人划线` });
			}
		}
	}

	private formatDateTime(ts: number): string {
		if (!ts) return '';
		return window.moment(ts * 1000).format('YYYY-MM-DD HH:mm');
	}
}
