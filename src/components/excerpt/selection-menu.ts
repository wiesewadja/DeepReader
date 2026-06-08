/**
 * DeepPDF 文字选中悬浮菜单
 * 用于 AI 对话气泡中选中文字后显示引用/摘录选项
 * 与阅读模式的 SelectionToolbar 保持一致的按钮样式
 */

import { App } from 'obsidian';
import { ExcerptModal } from './excerpt-modal';
import { Icons } from '../../utils/icons.js';
import type { ExcerptContent, ExcerptMetadata } from '../../types/excerpt';
import type { QuoteMetadata } from '../chat-input/chat-input';

// 高亮颜色配置（与 SelectionToolbar 一致）
const HIGHLIGHT_COLORS = [
    { id: 'yellow', label: '黄色', bg: 'rgba(255, 235, 59, 0.5)' },
    { id: 'green', label: '绿色', bg: 'rgba(76, 175, 80, 0.4)' },
    { id: 'blue', label: '蓝色', bg: 'rgba(33, 150, 243, 0.4)' },
    { id: 'pink', label: '粉色', bg: 'rgba(233, 30, 99, 0.4)' },
    { id: 'orange', label: '橙色', bg: 'rgba(255, 152, 0, 0.4)' },
] as const;

type HighlightColorId = typeof HIGHLIGHT_COLORS[number]['id'];

export interface SelectionMenuOptions {
	/** 选中的文本内容 */
	selectedText: string;
	/** 来源 PDF 名称 */
	sourcePdf?: string;
	/** 页码 */
	page?: number;
	/** 用户问题 */
	question?: string;
	/** 对话 ID */
	conversationId?: string;
	/** 消息 ID */
	messageId?: string;
	/** 应用实例 */
	app: App;
	/** 引用回调（添加到对话上下文） */
	onQuote?: (metadata: QuoteMetadata) => void;
	/** 高亮保存回调（可选，传入则保存高亮） */
	onSaveHighlight?: (text: string, color: HighlightColorId) => Promise<void>;
}

/**
 * 悬浮菜单类（三按钮样式，与 SelectionToolbar 一致）
 */
export class SelectionMenu {
	private menuEl: HTMLDivElement | null = null;
	private options: SelectionMenuOptions;
	private boundHandleOutsideClick: (e: MouseEvent) => void;

	constructor(options: SelectionMenuOptions) {
		this.options = options;
		this.boundHandleOutsideClick = this.handleOutsideClick.bind(this);
	}

	/**
	 * 显示悬浮菜单
	 */
	show(x: number, y: number): void {
		// 移除已存在的菜单
		this.hide();

		// 创建菜单元素（使用与 SelectionToolbar 一致的样式类）
		this.menuEl = document.createElement('div');
		this.menuEl.className = 'deeppdf-selection-toolbar visible';
		// 使用 fixed 定位（添加到 body，需要相对于视口定位）
		this.menuEl.style.position = 'fixed';
		this.menuEl.style.left = `${x}px`;
		this.menuEl.style.top = `${y}px`;

		// 添加引用按钮
		const quoteBtn = document.createElement('button');
		quoteBtn.className = 'deeppdf-toolbar-btn primary';
		quoteBtn.setAttribute('aria-label', '引用到对话');
		quoteBtn.setAttribute('title', '引用');
		quoteBtn.innerHTML = Icons.quote;
		quoteBtn.addEventListener('click', () => this.handleQuote());
		this.menuEl.appendChild(quoteBtn);

		// 添加摘录按钮
		const excerptBtn = document.createElement('button');
		excerptBtn.className = 'deeppdf-toolbar-btn';
		excerptBtn.setAttribute('aria-label', '保存为摘录');
		excerptBtn.setAttribute('title', '摘录');
		excerptBtn.innerHTML = Icons.excerpt;
		excerptBtn.addEventListener('click', () => this.handleExcerpt());
		this.menuEl.appendChild(excerptBtn);

		// 添加高亮按钮
		const highlightBtn = document.createElement('button');
		highlightBtn.className = 'deeppdf-toolbar-btn';
		highlightBtn.setAttribute('aria-label', '高亮文本');
		highlightBtn.setAttribute('title', '高亮');
		highlightBtn.innerHTML = Icons.highlight;
		highlightBtn.addEventListener('click', () => this.handleHighlight());
		this.menuEl.appendChild(highlightBtn);

		// 添加到 DOM
		document.body.appendChild(this.menuEl);

		// 点击其他地方关闭菜单
		setTimeout(() => {
			document.addEventListener('click', this.boundHandleOutsideClick);
		}, 0);
	}

	/**
	 * 隐藏悬浮菜单
	 */
	hide(): void {
		if (this.menuEl) {
			this.menuEl.remove();
			this.menuEl = null;
			document.removeEventListener('click', this.boundHandleOutsideClick);
		}
	}

	/**
	 * 处理引用点击
	 * 从 AI 回复中选中的文字，包装为 QuoteMetadata
	 */
	private handleQuote(): void {
		if (this.options.onQuote) {
			// 从 AI 回复中选中，尝试从渲染 DOM 提取 blockId（如果 LLM 上次输出了 [[书名#^xxx]]）
			const blockId = this.extractBlockIdFromSelection();
			const metadata: QuoteMetadata = {
				text: this.options.selectedText,
				source: this.options.sourcePdf,
				messageId: this.options.messageId,  // 保留二级引用的来源消息
				blockId,
			};
			this.options.onQuote(metadata);
		}
		this.hide();
	}

	/**
	 * 从 AI 渲染的 DOM 中提取 ^blockId
	 * Obsidian 渲染 wiki 链接为 <a id="^xxx">...</a>，或子元素带 [id^="^"]
	 */
	private extractBlockIdFromSelection(): string | undefined {
		try {
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) return undefined;
			const range = selection.getRangeAt(0);

			// 在选区祖先链上找 id="^xxx" 的元素
			let node: Node | null = range.startContainer;
			while (node && node !== document.body) {
				if (node instanceof HTMLElement) {
					// 1. 自身 id
					if (node.id?.startsWith('^')) return node.id.slice(1);
					// 2. 子元素中最近一个 [id^="^"]
					const sub = node.querySelector('[id^="^"]');
					if (sub?.id) return sub.id.slice(1);
				}
				node = node.parentNode;
			}
		} catch (err) {
			// 忽略提取失败（无 blockId 时仍可作为纯文本引用）
		}
		return undefined;
	}

	/**
	 * 处理摘录点击
	 */
	private handleExcerpt(): void {
		const content: ExcerptContent = {
			text: this.options.selectedText
		};

		const metadata: ExcerptMetadata = {
			sourcePdf: this.options.sourcePdf || 'Unknown',
			page: this.options.page,
			question: this.options.question,
			createdAt: new Date().toISOString(),
			conversationId: this.options.conversationId,
			messageId: this.options.messageId
		};

		// 打开摘录模态框
		const modal = new ExcerptModal({
			content,
			metadata,
			app: this.options.app
		});
		modal.open();

		this.hide();
	}

	/**
	 * 处理高亮点击（视觉效果 + 可选持久化）
	 */
	private handleHighlight(): void {
		// 获取当前选中范围
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) {
			this.hide();
			return;
		}

		try {
			const range = selection.getRangeAt(0);
			// 随机选择高亮颜色
			const colorIndex = Math.floor(Math.random() * HIGHLIGHT_COLORS.length);
			const selectedColor = HIGHLIGHT_COLORS[colorIndex];

			const highlightSpan = document.createElement('mark');
			highlightSpan.setAttribute('data-highlight', selectedColor.id);
			highlightSpan.style.backgroundColor = selectedColor.bg;

			// 包装选中内容
			const fragment = range.extractContents();
			highlightSpan.appendChild(fragment);
			range.insertNode(highlightSpan);

			// 清除选中
			selection.removeAllRanges();

			// 如果有保存回调，则持久化高亮
			if (this.options.onSaveHighlight) {
				this.options.onSaveHighlight(this.options.selectedText, selectedColor.id);
			}
		} catch (err) {
			// 忽略高亮失败的情况
		}

		this.hide();
	}

	/**
	 * 处理点击外部关闭菜单
	 */
	private handleOutsideClick(e: MouseEvent): void {
		if (this.menuEl && !this.menuEl.contains(e.target as Node)) {
			this.hide();
		}
	}
}
