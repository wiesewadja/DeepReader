/**
 * 引用卡片管理器
 *
 * 管理用户从阅读模式中选中的引用文字，在输入框上方显示引用卡片。
 * PR 1 升级：可展开全文 + 跳转原文 + 全部清除 + 只读模式
 */

import type { QuoteItem, QuoteMetadata } from '../../components/chat-input/chat-input.js';
import { uiLog as log } from '../../utils/logger.js';
import { Icons } from '../../utils/icons.js';

export interface QuoteManagerHost {
	get chatInput(): import('../../components/chat-input/chat-input.js').ChatInput | null;
	updateMessageListPadding(hasContextTags: boolean): void;
	/**
	 * 跳转引用卡片到原文位置（调用 reading-mode-service.jumpToBlock）
	 * @param quote 引用项
	 * @returns 是否成功跳转
	 */
	jumpToQuote?(quote: QuoteItem): boolean;
	/**
	 * 在原文章节中加高亮（调用 reading-mode-service.addCitedHighlight）
	 * @param quote 引用项
	 */
	addCitedHighlight?(quote: QuoteItem): void;
	/**
	 * 移除原文章节中的高亮
	 * @param quote 引用项
	 */
	removeCitedHighlight?(quote: QuoteItem): void;
	/**
	 * 清空所有高亮（多引用同时移除时调用）
	 */
	clearCitedHighlights?(): void;
}

const PREVIEW_CHARS = 60;  // 预留：可能用于未来按文本长度调整卡片样式

export class QuoteManager {
	private host: QuoteManagerHost;
	private quotes: QuoteItem[] = [];
	private container: HTMLElement | null = null;
	private readonly: boolean = false;  // 只读模式：恢复的引用不可移除

	constructor(host: QuoteManagerHost) {
		this.host = host;
	}

	setContainer(el: HTMLElement | null): void {
		this.container = el;
	}

	/**
	 * 设置只读模式（恢复引用时调用，禁用移除/清除操作）
	 */
	setReadonly(readonly: boolean): void {
		this.readonly = readonly;
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
			headingPath: metadata.headingPath,
			page: metadata.page,
			messageId: metadata.messageId,
		};

		this.quotes.push(quote);
		this.renderQuoteCard(quote);
		this.updateQuotePlaceholder();
		this.host.chatInput?.focus();
		// 同步：在原文章节中加高亮
		this.host.addCitedHighlight?.(quote);
	}

	/**
	 * 批量恢复引用（从缓存加载对话时调用）
	 */
	restoreQuotes(quotes: QuoteItem[]): void {
		if (!quotes?.length) return;
		// 进入只读模式
		this.setReadonly(true);
		// 反向迭代：renderQuoteCard 用 prepend，最新引用需在最后渲染
		// 这样最终 DOM 顺序：最后引用的在最左
		for (const q of [...quotes].reverse()) {
			this.quotes.push(q);
			this.renderQuoteCard(q);
		}
		this.container?.setAttribute('data-readonly', 'true');
		this.updateQuotePlaceholder();
	}

	private renderQuoteCard(quote: QuoteItem): void {
		if (!this.container) return;

		this.container.setAttribute('data-count', String(this.quotes.length));

		requestAnimationFrame(() => {
			this.host.updateMessageListPadding(false);
		});

		// 章节路径展示（作为副标题/footer）
		const location = quote.headingPath?.length
			? quote.headingPath.join(' › ')
			: (quote.heading || quote.source || '引用');

		const cardConfig = {
			cls: 'deeppdf-quote-card',
			attr: {
				'data-quote-id': quote.id,
				'data-quote-block-id': quote.blockId || '',
				'title': `${quote.source ? quote.source + ' · ' : ''}${location}\n"${quote.text}"`,
				'aria-label': `引用: ${quote.text.substring(0, 30)}`,
			}
		};
		// Obsidian 的 createDiv 默认 append 到末尾
		// 这里需要 prepend（最新引用在最左）— 所以建好后立刻 move 到 firstChild
		const card = this.container.createDiv(cardConfig) as HTMLElement;
		if (this.container.firstChild !== card) {
			this.container.insertBefore(card, this.container.firstChild);
		}

		// ===== 头部行：图标 + 章节路径（只读徽标） =====
		const header = card.createEl('div', { cls: 'deeppdf-quote-card-header' });

		const iconEl = header.createEl('span', { cls: 'deeppdf-quote-icon' });
		iconEl.innerHTML = Icons.quote;

		header.createEl('span', {
			cls: 'deeppdf-quote-source',
			text: location,
		});

		// 只读模式：显示 🕘 图标
		if (this.readonly) {
			const restoredEl = header.createEl('span', {
				cls: 'deeppdf-quote-restored-badge',
				attr: { 'aria-label': '恢复的引用（只读）' }
			});
			restoredEl.innerHTML = Icons.restored;
			restoredEl.title = '已恢复的引用（只读）';
		}

		// ===== 引文主体（hero，2-3 行预览） =====
		// 关键：line-clamp 由 CSS 控制（display: -webkit-box !important）
		const textEl = card.createEl('div', { cls: 'deeppdf-quote-text', text: quote.text });

		// ===== 删除按钮（绝对定位右上角，仅非只读） =====
		if (!this.readonly) {
			const removeBtn = card.createEl('button', {
				cls: 'deeppdf-quote-remove-btn',
				attr: { 'aria-label': '移除引用', type: 'button' }
			});
			removeBtn.innerHTML = Icons.x;
			removeBtn.title = '移除';
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.removeQuote(quote.id);
			});
		}
	}

	/**
	 * 触发卡片黄色闪烁动画（响应 AI 回应徽标点击）
	 */
	flashQuoteCard(quoteId: string): boolean {
		if (!this.container) return false;
		const card = this.container.querySelector(`[data-quote-id="${quoteId}"]`) as HTMLElement;
		if (!card) return false;
		card.scrollIntoView({ behavior: 'smooth', block: 'center' });
		card.classList.add('deeppdf-quote-flash');
		window.setTimeout(() => {
			card.classList.remove('deeppdf-quote-flash');
		}, 2000);
		return true;
	}

	/**
	 * 查找某条引用（用于 AI 徽标 → 卡片映射）
	 */
	findQuote(quoteId: string): QuoteItem | undefined {
		return this.quotes.find(q => q.id === quoteId);
	}

	removeQuote(quoteId: string): void {
		if (this.readonly) {
			log('[QuoteManager] 只读模式，不允许移除');
			return;
		}
		const removed = this.quotes.find(q => q.id === quoteId);
		this.quotes = this.quotes.filter(q => q.id !== quoteId);

		if (this.container) {
			const card = this.container.querySelector(`[data-quote-id="${quoteId}"]`);
			if (card) card.remove();
			this.container.setAttribute('data-count', String(this.quotes.length));
		}

		this.updateQuotePlaceholder();

		// 同步：移除原文章节中的高亮
		if (removed) this.host.removeCitedHighlight?.(removed);

		requestAnimationFrame(() => {
			this.host.updateMessageListPadding(false);
		});
	}

	clearQuotes(): void {
		if (this.readonly) {
			log('[QuoteManager] 只读模式，不允许清除');
			return;
		}
		this.quotes = [];
		if (this.container) this.container.empty();
		this.updateQuotePlaceholder();
		// 同步：清空所有高亮
		this.host.clearCitedHighlights?.();

		requestAnimationFrame(() => {
			this.host.updateMessageListPadding(false);
		});
	}

	private updateQuotePlaceholder(): void {
		const textarea = (this.host.chatInput as any)?.textarea as HTMLTextAreaElement | undefined;
		if (!textarea) return;

		if (this.quotes.length > 0) {
			// 卡片已经可视化显示引用了，placeholder 不再重复提示
			// 只在 readonly 状态下微调以提醒用户
			textarea.placeholder = this.readonly
				? '已恢复引用（只读）。输入新问题发送…'
				: '问点什么…';
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
