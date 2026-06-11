/**
 * DeepPDF 消息列表组件
 * 管理和渲染聊天消息列表
 */

import { type App } from "obsidian";
import type { TTSPlayState } from "../../services/tts/tts-service.js";
import type { ExcerptContent, ExcerptMetadata } from "../../types/excerpt";
import { warn } from "../../utils/logger.js";
import type { QuoteMetadata } from "../chat-input/chat-input";
import { Component } from "../component";
import {
	createMessage,
	type Message,
	type MessageData,
} from "../message/message";
import { QuestionMinimap } from "../question-minimap";
// @ts-ignore — esbuild dataurl loader handles .jpg
const XITONG_IMG = require("../../assets/xitong.jpg") as string;

/**
 * 引导按钮类型
 */
export type GuidanceType =
	| "overview" // 这本书讲了什么
	| "core-views" // 核心观点
	| "mindmap" // 全书导图
	| "key-concepts" // 关键概念
	| "reading-guide" // 从哪开始读
	| "relevance" // 跟我有什么关系
	| "recommend" // 推荐一本好书
	| "organize" // 整理读书笔记
	| "summary" // 我的阅读总结
	| "method"; // 聊聊阅读方法

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
	{
		type: "overview",
		label: "这本书讲了什么",
		prompt: "这本书主要讲了什么内容？请给我一个概览",
	},
	{
		type: "core-views",
		label: "核心观点",
		prompt: "这本书的核心观点和主要论点是什么？",
	},
	{
		type: "mindmap",
		label: "全书导图",
		prompt:
			"请根据目录和章节摘要，为这本书生成一张全书思维导图，展现核心主题和各章节之间的逻辑关系",
	},
	{
		type: "key-concepts",
		label: "关键概念",
		prompt: "这本书有哪些关键概念和重要术语？",
	},
	{
		type: "reading-guide",
		label: "从哪开始读",
		prompt:
			"我刚拿到这本书，请根据目录和章节难度，给我一个阅读路线建议：哪些章节必读、哪些可以跳过、推荐什么顺序？",
	},
	{
		type: "relevance",
		label: "跟我有什么关系",
		prompt:
			"请结合这本书的核心内容，谈谈它对普通读者的实际价值，以及哪些章节最值得我花时间精读？",
	},
];

/**
 * 阅读顾问引导按钮配置
 */
export const ADVISOR_BUTTONS: GuidanceButton[] = [
	{
		type: "recommend",
		label: "推荐一本好书",
		prompt: "根据我的书架和阅读偏好，推荐一本我可能喜欢的书",
	},
	{
		type: "organize",
		label: "整理读书笔记",
		prompt: "帮我把最近的读书笔记整理一下",
	},
	{
		type: "summary",
		label: "我的阅读总结",
		prompt: "帮我做个阅读总结，看看我最近都读了什么",
	},
	{
		type: "method",
		label: "聊聊阅读方法",
		prompt: "聊聊如何提高阅读效率，有什么好的阅读方法推荐？",
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
	onExcerpt?: (
		messageId: string,
		content: ExcerptContent,
		metadata: ExcerptMetadata,
	) => void;
	/** 引用文字到对话 */
	onQuote?: (metadata: QuoteMetadata) => void;
	/** 删除消息对（删除 AI 回复时同时删除对应的用户问题） */
	onDelete?: (messageId: string) => void;
	/** TTS 朗读 */
	onTTS?: (messageId: string, content: string) => void;
	/** 获取当前书籍信息（封面、作者、书名） */
	getCurrentBookInfo?: () => {
		coverUrl: string | null;
		author: string | null;
		bookName: string | null;
	};
	getBubbleTheme?: () => string;
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
	private currentPdfName: string = "";
	private minimap: QuestionMinimap | null = null;
	private _typewriterActive: boolean = false;

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
		const container = document.createElement("div");
		container.addClass("deeppdf-message-list");

		// 消息容器
		this.messagesContainer = container.createEl("div", {
			cls: "deeppdf-messages-container",
		});
		// 屏幕阅读器可访问性：chat log 语义
		// role=log 隐式 aria-live=polite：新消息到达时屏幕阅读器会播报
		this.messagesContainer.setAttribute("role", "log");
		this.messagesContainer.setAttribute("aria-label", "对话历史");
		// 注：aria-busy 暂不设 —— 当前没有公开的 setLoading 接口，
		// 除非有真实的加载生命周期（如初始会话加载 / 重新生成中）需要广播，
		// 否则该属性是"假合规"。需要时同步增加 setLoading API。

		// 空状态
		this.emptyState = container.createEl("div", {
			cls: "deeppdf-empty-state",
		});
		// 屏幕阅读器可访问性：status 角色让 AT 感知“无消息”状态
		this.emptyState.setAttribute("role", "status");

		// 快捷操作区域（包含所有内容）
		this.quickActionsEl = this.emptyState.createEl("div", {
			cls: "deeppdf-quick-actions",
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
				onQuestionClick: (question: string) =>
					this.callbacks.onQuestionClick?.(question),
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
			getBubbleTheme: this.callbacks.getBubbleTheme,
			app: this.app,
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
		this._typewriterActive = false;
		this.messages.forEach((message) => {
			message.getElement().remove();
		});
		this.messages.clear();
		this.updateEmptyState();
		this.updateMinimap();
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
		return Array.from(this.messages.values()).map((msg) => msg.getData());
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
		return this.getMessages().map((msg) => msg.getData());
	}

	/**
	 * 清空所有消息
	 */
	clearMessages(): void {
		this._typewriterActive = false;
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
		if (msg?.setTTSState) {
			msg.setTTSState(state);
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
		el.scrollIntoView({ behavior: "smooth", block: "start" });
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
			this.emptyState.addClass("deeppdf-hidden");
			this.emptyState.setAttribute("aria-hidden", "true");
			this.messagesContainer.removeClass("deeppdf-hidden");
			this.messagesContainer.setAttribute("aria-hidden", "false");
		} else {
			this.emptyState.removeClass("deeppdf-hidden");
			this.emptyState.setAttribute("aria-hidden", "false");
			this.messagesContainer.addClass("deeppdf-hidden");
			this.messagesContainer.setAttribute("aria-hidden", "true");

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
			const advisorState = this.quickActionsEl.createEl("div", {
				cls: "deeppdf-advisor-welcome",
			});
			const bg = advisorState.createEl("div", { cls: "deeppdf-advisor-bg" });
			bg.style.backgroundImage = `url(${XITONG_IMG})`;
			advisorState.createEl("div", { cls: "deeppdf-advisor-overlay" });
			const content = advisorState.createEl("div", {
				cls: "deeppdf-advisor-content",
			});
			const titleEl = content.createEl("div", { cls: "deeppdf-advisor-title" });
			this.startTypewriter(
				titleEl,
				"\u4f60\u597d\uff0c\u6211\u662f\u595a\u7ae5",
			);
			content.createEl("div", {
				cls: "deeppdf-advisor-subtitle",
				text: `\u4f60\u7684 AI \u4f34\u8bfb \u00b7 ${this.currentPdfName}`,
			});
			content.createEl("div", {
				cls: "deeppdf-advisor-hint",
				text: "\u5f00\u59cb\u9605\u8bfb\u5427\uff0c\u6709\u4ec0\u4e48\u60f3\u804a\u7684\u968f\u65f6\u95ee\u6211",
			});

			const gridContainer = content.createEl("div", {
				cls: "deeppdf-guidance-grid",
			});

			GUIDANCE_BUTTONS.forEach((button) => {
				const btn = gridContainer.createEl("button", {
					cls: "deeppdf-guidance-btn",
				});
				btn.createEl("span", {
					cls: "deeppdf-guidance-label",
					text: button.label,
				});

				btn.addEventListener("click", () => {
					this.callbacks.onGuidanceClick?.(button.type);
				});
			});
		} else if (this.callbacks.onGuidanceClick) {
			// 阅读顾问模式：沉浸式背景欢迎界面
			const advisorState = this.quickActionsEl.createEl("div", {
				cls: "deeppdf-advisor-welcome",
			});
			const bg = advisorState.createEl("div", { cls: "deeppdf-advisor-bg" });
			bg.style.backgroundImage = `url(${XITONG_IMG})`;
			advisorState.createEl("div", { cls: "deeppdf-advisor-overlay" });
			const content = advisorState.createEl("div", {
				cls: "deeppdf-advisor-content",
			});
			const titleEl = content.createEl("div", { cls: "deeppdf-advisor-title" });
			this.startTypewriter(titleEl, "你好，我是奚童");
			content.createEl("div", {
				cls: "deeppdf-advisor-subtitle",
				text: "你的 AI 伴读",
			});
			content.createEl("div", {
				cls: "deeppdf-advisor-hint",
				text: "有什么想聊的，随时问我",
			});
			const grid = content.createEl("div", {
				cls: "deeppdf-guidance-grid deeppdf-advisor-grid",
			});
			ADVISOR_BUTTONS.forEach((button) => {
				const btn = grid.createEl("button", { cls: "deeppdf-guidance-btn" });
				btn.createEl("span", {
					cls: "deeppdf-guidance-label",
					text: button.label,
				});
				btn.addEventListener("click", () => {
					this.callbacks.onGuidanceClick?.(button.type);
				});
			});
		} else {
			// 无回调时的降级占位符
			const placeholder = this.quickActionsEl.createEl("div", {
				cls: "deeppdf-empty-placeholder",
			});
			placeholder.createEl("div", {
				cls: "deeppdf-empty-title",
				text: "选择一本书籍开始阅读",
			});
		}
	}

	/**
	 * 循环打字机效果
	 */
	private startTypewriter(el: HTMLElement, text: string): void {
		this._typewriterActive = true;
		el.addClass("deeppdf-advisor-title-cursor");
		let charIndex = 0;
		let phase: "typing" | "holding" | "erasing" | "waiting" = "typing";

		const tick = () => {
			if (!this._typewriterActive) return;

			switch (phase) {
				case "typing":
					charIndex++;
					el.textContent = text.slice(0, charIndex);
					if (charIndex >= text.length) {
						phase = "holding";
						setTimeout(tick, 2500);
						return;
					}
					setTimeout(tick, 160);
					break;
				case "holding":
					phase = "erasing";
					setTimeout(tick, 400);
					break;
				case "erasing":
					charIndex--;
					el.textContent = text.slice(0, charIndex);
					if (charIndex <= 0) {
						phase = "waiting";
						setTimeout(tick, 600);
						return;
					}
					setTimeout(tick, 80);
					break;
				case "waiting":
					phase = "typing";
					setTimeout(tick, 400);
					break;
			}
		};

		setTimeout(tick, 600);
	}

	/**
	 * 更新底部间距（适应输入框高度变化）
	 * @param inputHeight 输入框的高度（像素）
	 * @param quotesHeight 引用卡片容器的高度（像素），可选
	 */
	updateBottomPadding(inputHeight: number, quotesHeight: number = 0): void {
		if (!this.messagesContainer) return;

		// 输入框已是 flex 子元素，只需保留基础间距
		const basePadding = 16;
		this.messagesContainer.style.paddingBottom = `${basePadding}px`;
	}

	/**
	 * 销毁组件
	 */
	override destroy(): void {
		// 停止打字机
		this._typewriterActive = false;

		// 销毁 minimap
		if (this.minimap) {
			this.minimap.destroy();
			this.minimap = null;
		}

		// 销毁所有消息
		this.messages.forEach((message) => {
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
