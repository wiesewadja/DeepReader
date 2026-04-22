/**
 * DeepPDF 消息列表组件
 * 管理和渲染聊天消息列表
 */

import { App } from 'obsidian';
import { Component } from '../component';
import { createMessage, Message, MessageData } from '../message/message';
import type { ExcerptContent, ExcerptMetadata } from '../../types/excerpt';
import type { QuoteMetadata } from '../chat-input/chat-input';
import { warn } from '../../utils/logger.js';
import { QuestionMinimap } from '../question-minimap';
import type { TTSPlayState } from '../../services/tts/tts-service.js';

/**
 * 引导按钮类型
 */
export type GuidanceType =
	| 'overview'        // 这本书讲了什么
	| 'core-views'      // 核心观点
	| 'chapter-nav'     // 章节导航
	| 'key-concepts'    // 关键概念
	| 'author-info'     // 作者背景
	| 'explore';        // 探索这本书

/**
 * 引导按钮配置
 */
export interface GuidanceButton {
	type: GuidanceType;
	label: string;
	prompt: string;
}

/**
 * 引导按钮配置列表
 */
export const GUIDANCE_BUTTONS: GuidanceButton[] = [
	{ type: 'overview', label: '这本书讲了什么', prompt: '这本书主要讲了什么内容？请给我一个概览' },
	{ type: 'core-views', label: '核心观点', prompt: '这本书的核心观点和主要论点是什么？' },
	{ type: 'chapter-nav', label: '章节导航', prompt: '请介绍一下这本书的章节结构，帮助我了解全书的框架' },
	{ type: 'key-concepts', label: '关键概念', prompt: '这本书有哪些关键概念和重要术语？' },
	{ type: 'author-info', label: '作者背景', prompt: '请介绍一下这本书的作者及其背景' },
	{
		type: 'explore',
		label: '探索这本书',
		prompt: '我刚刚开始阅读这本书，请先浏览目录和关键章节，了解这本书的主题和结构，然后用自然友好的方式向我介绍这本书，并建议我可以从哪里开始阅读。'
	},
];

/**
 * 消息操作回调接口
 */
export interface MessageCallbacks {
	/** 重新生成消息 */
	onRegenerate?: (messageId: string) => void;
	/** 复制消息 */
	onCopy?: (messageId: string) => void;
	/** 追问问题点击 */
	onQuestionClick?: (question: string) => void;
	/** 生成阅读大纲点击 */
	onGenerateOutline?: () => void;
	/** 引导按钮点击 */
	onGuidanceClick?: (type: GuidanceType) => void;
	/** 保存摘录 */
	onExcerpt?: (messageId: string, content: ExcerptContent, metadata: ExcerptMetadata) => void;
	/** 引用文字到对话 */
	onQuote?: (metadata: QuoteMetadata) => void;
	/** 删除消息对（删除 AI 回复时同时删除对应的用户问题） */
	onDelete?: (messageId: string) => void;
	/** TTS 朗读 */
	onTTS?: (messageId: string, content: string) => void;
	/** 获取当前书籍信息（封面、作者、书名） */
	getCurrentBookInfo?: () => { coverUrl: string | null; author: string | null; bookName: string | null };
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
	private minimap: QuestionMinimap | null = null;

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

		// 创建 minimap（在消息容器后）
		this.minimap = new QuestionMinimap({
			containerEl: this.messagesContainer,
			onMessageClick: (id) => this.scrollToMessage(id),
		});
		const minimapEl = this.minimap.getElement();
		if (minimapEl) {
			container.appendChild(minimapEl);
		}

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

		// 跳过隐藏消息的 UI 渲染（但仍保存到存储中）
		if (messageData.hidden) {
			// 创建消息但不添加到 DOM
			const message = createMessage(messageData, {
				onRegenerate: () => this.callbacks.onRegenerate?.(messageData.id),
				onCopy: () => this.callbacks.onCopy?.(messageData.id),
				onQuestionClick: (question: string) => this.callbacks.onQuestionClick?.(question),
				onExcerpt: (content: ExcerptContent, metadata: ExcerptMetadata) =>
					this.callbacks.onExcerpt?.(messageData.id, content, metadata),
				onTTS: (messageId: string, content: string) =>
					this.callbacks.onTTS?.(messageId, content),
				app: this.app,
				getAllMessages: () => this.getMessagesData(),
				getCurrentBookInfo: this.callbacks.getCurrentBookInfo,
			});
			this.messages.set(messageData.id, message);
			return message;
		}

		// 创建消息组件
		const message = createMessage(messageData, {
			onRegenerate: () => {
				this.callbacks.onRegenerate?.(messageData.id);
			},
			onCopy: () => {
				this.callbacks.onCopy?.(messageData.id);
			},
			onQuestionClick: (question: string) => {
				this.callbacks.onQuestionClick?.(question);
			},
			onExcerpt: (content: ExcerptContent, metadata: ExcerptMetadata) => {
				this.callbacks.onExcerpt?.(messageData.id, content, metadata);
			},
			onQuote: (metadata: QuoteMetadata) => {
				this.callbacks.onQuote?.(metadata);
			},
			onDelete: () => {
				this.callbacks.onDelete?.(messageData.id);
			},
			onTTS: (messageId: string, content: string) => {
				this.callbacks.onTTS?.(messageId, content);
			},
			getAllMessages: () => this.getMessagesData(),
			getCurrentBookInfo: this.callbacks.getCurrentBookInfo,
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

		// 更新 minimap
		this.updateMinimap();

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
			warn(`Message with id ${messageId} not found`);
			return;
		}

		// 更新消息
		message.update(updates);

		// 不再自动滚动到底部，由用户手动控制滚动位置
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

		// 更新 minimap
		this.updateMinimap();
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

		// 更新 minimap
		this.updateMinimap();
	}

	/**
	 * 批量删除多条消息
	 * @param messageIds 要删除的消息 ID 数组
	 */
	removeMessages(messageIds: string[]): void {
		for (const id of messageIds) {
			const message = this.messages.get(id);
			if (message) {
				const el = message.getElement();
				if (el && el.parentNode) {
					el.parentNode.removeChild(el);
				}
				this.messages.delete(id);
			}
		}
		this.updateEmptyState();
		this.updateMinimap();
	}

	/**
	 * 更新指定消息的 TTS 播放状态
	 */
	updateTTSState(messageId: string, state: TTSPlayState): void {
		const msg = this.messages.get(messageId);
		if (msg && 'setTTSState' in msg) {
			(msg as any).setTTSState(state);
		}
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
			warn(`Message element for ${messageId} is null`);
			return;
		}
		el.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	/**
	 * 更新 minimap
	 */
	private updateMinimap(): void {
		if (this.minimap) {
			// 延迟更新，等待 DOM 渲染完成
			requestAnimationFrame(() => {
				this.minimap?.updateMessages(this.getMessagesData());
			});
		}
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

		// 如果有当前 PDF 名称，显示引导按钮
		if (this.currentPdfName && this.callbacks.onGuidanceClick) {
			// 中心书籍图标
			const centerIcon = this.quickActionsEl.createEl('div', { cls: 'deeppdf-empty-center-icon' });
			centerIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>`;

			// 按钮网格容器
			const gridContainer = this.quickActionsEl.createEl('div', { cls: 'deeppdf-guidance-grid' });

			// 创建 6 个引导按钮
			GUIDANCE_BUTTONS.forEach((button) => {
				const btn = gridContainer.createEl('button', {
					cls: 'deeppdf-guidance-btn'
				});
				btn.createEl('span', { cls: 'deeppdf-guidance-label', text: button.label });

				// 点击事件
				btn.addEventListener('click', () => {
					this.callbacks.onGuidanceClick?.(button.type);
				});
			});
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
	 * @param quotesHeight 引用卡片容器的高度（像素），可选
	 */
	updateBottomPadding(inputHeight: number, quotesHeight: number = 0): void {
		if (!this.messagesContainer) return;

		// 基础间距 + 输入框高度 + 引用卡片高度 + 额外间距
		// 基础间距 16px（顶部）+ 额外间距 8px（消息与输入框之间的视觉间距）
		const basePadding = 16;
		const extraGap = 8;
		const bottomPadding = basePadding + inputHeight + quotesHeight + extraGap;

		this.messagesContainer.style.paddingBottom = `${bottomPadding}px`;
	}

	/**
	 * 销毁组件
	 */
	override destroy(): void {
		// 销毁 minimap
		if (this.minimap) {
			this.minimap.destroy();
			this.minimap = null;
		}

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
