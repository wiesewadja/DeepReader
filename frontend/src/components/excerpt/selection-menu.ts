/**
 * DeepPDF 文字选中悬浮菜单
 * 用于选中文字后显示摘录选项
 */

import { App } from 'obsidian';
import { ExcerptModal } from './excerpt-modal';
import type { ExcerptContent, ExcerptMetadata } from '../../types/excerpt';

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
}

/**
 * 悬浮菜单类
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

		// 创建菜单元素
		this.menuEl = document.createElement('div');
		this.menuEl.className = 'deeppdf-selection-menu';
		this.menuEl.style.left = `${x}px`;
		this.menuEl.style.top = `${y}px`;

		// 添加摘录按钮（使用图标）
		const excerptBtn = document.createElement('button');
		excerptBtn.className = 'deeppdf-selection-menu-btn';
		excerptBtn.setAttribute('aria-label', '保存为摘录');
		excerptBtn.setAttribute('title', '摘录到笔记');
		// 书签图标 (bookmark) - Lucide style
		excerptBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path></svg>`;
		excerptBtn.addEventListener('click', () => this.handleExcerpt());
		this.menuEl.appendChild(excerptBtn);

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
	 * 处理点击外部关闭菜单
	 */
	private handleOutsideClick(e: MouseEvent): void {
        if (this.menuEl && !this.menuEl.contains(e.target as Node)) {
            this.hide();
        }
    }
}
