/**
 * DeepPDF 消息列表组件
 * 管理和渲染聊天消息列表
 */

import { App } from 'obsidian';
import { Component } from '../component';
import { createMessage, Message, MessageData, CitationData } from '../message/message';

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
}

/**
 * 消息列表组件
 * 管理消息的添加、更新和渲染
 */
export class MessageList extends Component {
	private messages: Map<string, Message> = new Map();
	private messagesContainer: HTMLElement | null = null;
	private emptyState: HTMLElement | null = null;
	private callbacks: MessageCallbacks;
	private app?: App;

	constructor(callbacks: MessageCallbacks = {}, app?: App) {
		super();
		this.callbacks = callbacks;
		this.app = app;
		this.el = this.render();
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
		// 使用 DOM 方法而非 innerHTML 以避免 XSS 风险
		const emptyIcon = this.emptyState.createEl('div', { cls: 'deeppdf-empty-icon' });
		emptyIcon.textContent = '💬';
		this.emptyState.createEl('div', { cls: 'deeppdf-empty-text', text: '开始对话' });
		this.emptyState.createEl('div', { cls: 'deeppdf-empty-hint', text: '发送消息开始与 DeepPDF 对话' });

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
	}

	/**
	 * 获取所有消息数据
	 */
	getAllMessages(): MessageData[] {
		// 对 map values 进行排序可能有问题，Map 保持插入顺序
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
			if (this.el) {
				this.el.scrollTop = this.el.scrollHeight;
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
		if (!this.emptyState || !this.messagesContainer) {
			return;
		}

		const hasMessages = this.messages.size > 0;

		if (hasMessages) {
			this.emptyState.addClass('deeppdf-hidden');
			this.messagesContainer.removeClass('deeppdf-hidden');
		} else {
			this.emptyState.removeClass('deeppdf-hidden');
			this.messagesContainer.addClass('deeppdf-hidden');
		}
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
