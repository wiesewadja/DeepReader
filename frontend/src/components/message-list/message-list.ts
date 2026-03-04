/**
 * DeepPDF 消息列表组件
 * 管理和渲染聊天消息列表
 */

import { App } from 'obsidian';
import { Component } from '../component';
import { createMessage, Message, MessageData, CitationData } from '../message/message';
import type { ExcerptContent, ExcerptMetadata } from '../../types/excerpt';

/**
 * 消息操作回调接口
 */
export interface MessageCallbacks {
	/** 重新生成消息 */
	onRegenerate?: (messageId: string) => void;
	/** 复制消息 */
	onCopy?: (messageId: string) => void;
	/** 复制消息和引用 */
	onCopyWithCitation?: (messageId: string) => void;
	/** 跳转到引用 */
	onCitationJump?: (citation: CitationData) => void;
	/** 追问问题点击 */
	onQuestionClick?: (question: string) => void;
	/** 生成阅读大纲点击 */
	onGenerateOutline?: () => void;
	/** 保存摘录 */
	onExcerpt?: (messageId: string, content: ExcerptContent, metadata: ExcerptMetadata) => void;
}

/**
 * 消息列表组件
 * 管理消息的添加、更新和渲染
 */
export class MessageList extends Component {
	private messages: Map<string, Message> = new Map();
	private messagesContainer: HTMLElement | null = null;
	private emptyState: HTMLElement | null = null;
	private quickActionsEl: HTMLElement | null = null;
	private callbacks: MessageCallbacks;
	private app?: App;
	private currentPdfName: string = '';

	constructor(callbacks: MessageCallbacks = {}, app?: App) {
		super();
		this.callbacks = callbacks;
		this.app = app;
		this.el = this.render();
	}

	/**
	 * 设置当前 PDF 名称（用于空状态显示）
	 */
	setCurrentPdfName(name: string): void {
		this.currentPdfName = name;
		this.updateEmptyState();
	}

	/**
	 * 渲染消息列表容器
	 */
	render(): HTMLElement {
		const container = document.createElement('div');
		container.addClass('deeppdf-message-list');

		// 消息容器
		this.messagesContainer = container.createEl('div', {
			cls: 'deeppdf-messages-container'
		});

		// 空状态
		this.emptyState = container.createEl('div', {
			cls: 'deeppdf-empty-state'
		});

		// 快捷操作区域（包含所有内容）
		this.quickActionsEl = this.emptyState.createEl('div', {
			cls: 'deeppdf-quick-actions'
		});

		// 初始显示空状态
		this.updateEmptyState();

		this.el = container;
		return container;
	}

	/**
	 * 添加消息到列表
	 */
	addMessage(messageData: MessageData): Message {
		// ID 唯一性验证
		if (this.messages.has(messageData.id)) {
			throw new Error(`Message with id ${messageData.id} already exists`);
		}

		// 创建消息组件
		const message = createMessage(messageData, {
			onRegenerate: () => {
				this.callbacks.onRegenerate?.(messageData.id);
			},
			onCopy: () => {
				this.callbacks.onCopy?.(messageData.id);
			},
			onCopyWithCitation: () => {
				this.callbacks.onCopyWithCitation?.(messageData.id);
			},
			onQuestionClick: (question: string) => {
				this.callbacks.onQuestionClick?.(question);
			},
			onCitationJump: (citation: CitationData) => {
				this.callbacks.onCitationJump?.(citation);
			},
			onExcerpt: (content: ExcerptContent, metadata: ExcerptMetadata) => {
				this.callbacks.onExcerpt?.(messageData.id, content, metadata);
			},
			app: this.app
		});

		// 添加到存储
		this.messages.set(messageData.id, message);

		// 添加到 DOM
		if (this.messagesContainer) {
			const messageEl = message.getElement();
			if (messageEl) {
				this.messagesContainer.appendChild(messageEl);
			}
			this.updateEmptyState();
		}

		// 自动滚动到底部
		this.scrollToBottom();

		return message;
	}

	/**
	 * 清空消息列表
	 */
	clear(): void {
		this.messages.forEach(message => {
			message.getElement().remove();
		});
		this.messages.clear();
		this.updateEmptyState();
	}

	/**
	 * 更新消息
	 */
	updateMessage(messageId: string, updates: Partial<MessageData>): void {
		const message = this.messages.get(messageId);
		if (!message) {
			console.warn(`Message with id ${messageId} not found`);
			return;
		}

		// 更新消息（citations 改变时会自动重新渲染并绑定回调）
		message.update(updates);

		// 如果正在流式更新，自动滚动到底部以显示最新内容
		if (updates.isStreaming !== false) {
			this.scrollToBottom();
		}
	}

	/**
	 * 获取所有消息数据
	 * 注意：Map 按照 insertion order 迭代，因此返回的消息顺序与添加顺序一致
	 */
	getAllMessages(): MessageData[] {
		return Array.from(this.messages.values()).map(msg => msg.getData());
	}

	/**
	 * 获取消息
	 */
	getMessage(messageId: string): Message | undefined {
		return this.messages.get(messageId);
	}

	/**
	 * 获取所有消息
	 */
	getMessages(): Message[] {
		return Array.from(this.messages.values());
	}

	/**
	 * 获取所有消息数据
	 */
	getMessagesData(): MessageData[] {
		return this.getMessages().map(msg => msg.getData());
	}

	/**
	 * 清空所有消息
	 */
	clearMessages(): void {
		// 清空 DOM
		if (this.messagesContainer) {
			this.messagesContainer.empty();
		}

		// 清空存储
		this.messages.clear();

		// 更新空状态
		this.updateEmptyState();
	}

	/**
	 * 删除指定消息
	 */
	removeMessage(messageId: string): void {
		const message = this.messages.get(messageId);
		if (!message) {
			return;
		}

		// 从 DOM 移除
		const el = message.getElement();
		if (el && el.parentNode) {
			el.parentNode.removeChild(el);
		}

		// 从存储移除
		this.messages.delete(messageId);

		// 更新空状态
		this.updateEmptyState();
	}

	/**
	 * 滚动到底部
	 */
	scrollToBottom(): void {
		// 使用 requestAnimationFrame 确保 DOM 更新后再滚动
		requestAnimationFrame(() => {
			if (this.messagesContainer) {
				this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
			}
		});
	}

	/**
	 * 滚动到指定消息
	 */
	scrollToMessage(messageId: string): void {
		const message = this.messages.get(messageId);
		if (!message || !this.el) {
			return;
		}

		const el = message.getElement();
		if (!el) {
			console.warn(`Message element for ${messageId} is null`);
			return;
		}
		el.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	/**
	 * 更新空状态显示
	 */
	private updateEmptyState(): void {
		if (!this.emptyState || !this.messagesContainer || !this.quickActionsEl) {
			return;
		}

		const hasMessages = this.messages.size > 0;

		if (hasMessages) {
			this.emptyState.addClass('deeppdf-hidden');
			this.messagesContainer.removeClass('deeppdf-hidden');
		} else {
			this.emptyState.removeClass('deeppdf-hidden');
			this.messagesContainer.addClass('deeppdf-hidden');

			// 更新快捷操作按钮
			this.renderQuickActions();
		}
	}

	/**
	 * 渲染快捷操作按钮
	 */
	private renderQuickActions(): void {
		if (!this.quickActionsEl) return;

		// 清空现有内容
		this.quickActionsEl.empty();

		// 如果有当前 PDF 名称，显示生成阅读大纲按钮
		if (this.currentPdfName && this.callbacks.onGenerateOutline) {
			// 右上角按钮区域
			const headerArea = this.quickActionsEl.createEl('div', { cls: 'deeppdf-empty-header' });
			const outlineBtn = headerArea.createEl('button', {
				cls: 'deeppdf-quick-action-btn'
			});

			// 图标（使用 SVG）
			const iconEl = outlineBtn.createEl('span', { cls: 'deeppdf-quick-action-icon' });
			iconEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`;

			// 简洁文本
			outlineBtn.createEl('span', { cls: 'deeppdf-quick-action-label', text: '生成阅读大纲' });

			// 点击事件
			outlineBtn.addEventListener('click', () => {
				this.callbacks.onGenerateOutline?.();
			});

			// 中心书籍图标
			const centerIcon = this.quickActionsEl.createEl('div', { cls: 'deeppdf-empty-center-icon' });
			centerIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>`;
		} else {
			// 无 PDF 选中时的提示
			const placeholder = this.quickActionsEl.createEl('div', {
				cls: 'deeppdf-empty-placeholder'
			});
			placeholder.createEl('div', { cls: 'deeppdf-empty-icon' }).innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2"></path><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"></path><path d="M7 12h.01"></path><path d="M12 12h.01"></path><path d="M17 12h.01"></path></svg>`;
			placeholder.createEl('div', { cls: 'deeppdf-empty-title', text: '选择一本书籍开始阅读' });
			placeholder.createEl('div', { cls: 'deeppdf-empty-desc', text: '从左侧列表中选择要阅读的书籍' });
		}
	}

	/**
	 * 更新底部间距（适应输入框高度变化）
	 * @param inputHeight 输入框的高度（像素）
	 */
	updateBottomPadding(inputHeight: number): void {
		if (!this.messagesContainer) return;

		// 基础间距 + 输入框高度 + 额外间距
		// 基础间距 16px（顶部）+ 额外间距 16px（消息与输入框之间的视觉间距）
		const basePadding = 16;
		const extraGap = 16;
		const bottomPadding = basePadding + inputHeight + extraGap;

		this.messagesContainer.style.paddingBottom = `${bottomPadding}px`;
	}

	/**
	 * 销毁组件
	 */
	override destroy(): void {
		// 销毁所有消息
		this.messages.forEach(message => {
			const el = message.getElement();
			if (el && el.parentNode) {
				el.parentNode.removeChild(el);
			}
		});

		// 清空存储
		this.messages.clear();

		// 调用父类销毁方法
		super.destroy();
	}
}
