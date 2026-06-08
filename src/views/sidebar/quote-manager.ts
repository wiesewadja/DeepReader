/**
 * 引用卡片管理器
 *
 * 管理用户从阅读模式中选中的引用文字，在输入框上方显示引用卡片。
 */

import type { QuoteItem, QuoteMetadata } from '../../components/chat-input/chat-input.js';
import { uiLog as log } from '../../utils/logger.js';

export interface QuoteManagerHost {
	get chatInput(): import('../../components/chat-input/chat-input.js').ChatInput | null;
	updateMessageListPadding(hasContextTags: boolean): void;
}

export class QuoteManager {
	private host: QuoteManagerHost;
	private quotes: QuoteItem[] = [];
	private container: HTMLElement | null = null;

	constructor(host: QuoteManagerHost) {
		this.host = host;
	}

	setContainer(el: HTMLElement | null): void {
		this.container = el;
	}

	handleQuoteSelection(metadata: QuoteMetadata): void {
		const quote: QuoteItem = {
			id: `quote-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			text: metadata.text.trim(),
			source: metadata.source,
			sourcePath: metadata.sourcePath,
			blockId: metadata.blockId,
			nodeId: metadata.nodeId,
			heading: metadata.heading,
			headingPath: metadata.headingPath
		};

		this.quotes.push(quote);
		this.renderQuoteCard(quote);
		this.updateQuotePlaceholder();
		this.host.chatInput?.focus();
	}

	private renderQuoteCard(quote: QuoteItem): void {
		if (!this.container) return;

		this.container.setAttribute('data-count', String(this.quotes.length));

		requestAnimationFrame(() => {
			this.host.updateMessageListPadding(false);
		});

		const displayText = quote.text.length > 20
			? quote.text.substring(0, 20) + '...'
			: quote.text;

		const card = this.container.createDiv({
			cls: 'deeppdf-quote-card',
			attr: {
				'data-quote-id': quote.id,
				'title': `${quote.source ? quote.source + ': ' : ''}"${quote.text}"`,
				'aria-label': `引用: ${displayText}`
			}
		});

		const iconEl = card.createEl('span', { cls: 'deeppdf-quote-icon' });
		iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>`;

		card.createEl('span', { cls: 'deeppdf-quote-text', text: displayText });

		const removeBtn = card.createEl('button', {
			cls: 'deeppdf-quote-remove-btn',
			attr: { 'aria-label': '移除引用', type: 'button' }
		});
		removeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6"></line><line x1="6" y1="18"></line></svg>`;

		removeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.removeQuote(quote.id);
		});
	}

	removeQuote(quoteId: string): void {
		this.quotes = this.quotes.filter(q => q.id !== quoteId);

		if (this.container) {
			const card = this.container.querySelector(`[data-quote-id="${quoteId}"]`);
			if (card) card.remove();
			this.container.setAttribute('data-count', String(this.quotes.length));
		}

		this.updateQuotePlaceholder();

		requestAnimationFrame(() => {
			this.host.updateMessageListPadding(false);
		});
	}

	clearQuotes(): void {
		this.quotes = [];
		if (this.container) this.container.empty();
		this.updateQuotePlaceholder();

		requestAnimationFrame(() => {
			this.host.updateMessageListPadding(false);
		});
	}

	private updateQuotePlaceholder(): void {
		const textarea = (this.host.chatInput as any)?.textarea as HTMLTextAreaElement | undefined;
		if (!textarea) return;

		if (this.quotes.length > 0) {
			textarea.placeholder = `已引用 ${this.quotes.length} 段文字，请输入你的问题...`;
		} else {
			textarea.placeholder = '输入消息，或使用 @ 引用文件...';
		}
	}

	getQuotes(): QuoteItem[] {
		return [...this.quotes];
	}

	destroy(): void {
		this.quotes = [];
		this.container = null;
	}
}
