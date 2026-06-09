import type { App } from 'obsidian';
import type { ExcerptContent, ExcerptMetadata } from '../../types/excerpt';
import type { QuoteMetadata } from '../chat-input/chat-input';
import type { MessageData } from './types.js';
import { SelectionMenu } from '../excerpt/selection-menu';
import { uiLog as log } from '../../utils/logger.js';

/**
 * 选中菜单管理器
 * 管理文字选中检测、选中菜单显示/隐藏、摘录保存
 */

export interface SelectionHost {
	get el(): HTMLElement | null;
	get app(): App | undefined;
	get data(): MessageData;
	onExcerpt?(content: ExcerptContent, metadata: ExcerptMetadata): void;
	onQuote?(metadata: QuoteMetadata): void;
}

export class SelectionManager {
	private host: SelectionHost;
	private selectionMenu: SelectionMenu | null = null;

	constructor(host: SelectionHost) {
		this.host = host;
	}

	/** 处理摘录保存 */
	handleExcerpt(): void {
		if (!this.host.onExcerpt) return;

		log(`[DeepPDF] handleExcerpt - pdfName: ${this.host.data.pdfName}`);

		const content: ExcerptContent = {
			text: this.host.data.content,
			rawMarkdown: this.host.data.content
		};

		const metadata: ExcerptMetadata = {
			sourcePdf: this.host.data.pdfName || 'Unknown',
			page: this.host.data.page,
			question: this.host.data.question,
			createdAt: new Date().toISOString(),
			conversationId: this.host.data.conversationId,
			messageId: this.host.data.id
		};

		this.host.onExcerpt(content, metadata);
	}

	/** 设置文字选中监听 */
	setupSelectionListener(contentEl: HTMLElement): void {
		log(`[DeepPDF] setupSelectionListener - pdfName: ${this.host.data.pdfName}`);
		contentEl.addEventListener('mouseup', (e: MouseEvent) => {
			const selection = window.getSelection();
			if (!selection) return;

			const selectedText = selection.toString().trim();
			if (selectedText.length < 10) {
				this.selectionMenu?.hide();
				return;
			}

			const range = selection.getRangeAt(0);
			if (!contentEl.contains(range.commonAncestorContainer)) {
				this.selectionMenu?.hide();
				return;
			}

			const isReadingMode = document.body.classList.contains('deeppdf-reading-mode');
			if (isReadingMode) {
				return;
			}

			// Destroy previous menu and create a fresh one with updated options
			if (this.selectionMenu) {
				this.selectionMenu.hide();
			}

			this.selectionMenu = new SelectionMenu({
				selectedText,
				sourcePdf: this.host.data.pdfName,
				page: this.host.data.page,
				question: this.host.data.question,
				conversationId: this.host.data.conversationId,
				messageId: this.host.data.id,
				app: this.host.app!,
				onQuote: (metadata: QuoteMetadata) => {
					this.host.onQuote?.(metadata);
				}
			});

			const menuX = e.clientX + 10;
			const menuY = e.clientY + 10;
			this.selectionMenu.show(menuX, menuY);
		});
	}

	destroy(): void {
		if (this.selectionMenu) {
			this.selectionMenu.hide();
			this.selectionMenu = null;
		}
	}
}
