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
import { MascotFace } from "../reading-topbar/mascot-face.js";
// @ts-ignore — esbuild dataurl loader handles .jpg
// const XITONG_IMG = require("../../assets/xitong.jpg") as string;

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
	/** 错误状态下点击重试按钮的回调 */
	onRetry?: () => void;
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
	/** 跟踪所有 setTimeout 以便 destroy 时清理（防内存泄漏 / DOM 引用悬空） */
	private _pendingTimeouts: Set<ReturnType<typeof setTimeout>> = new Set();

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
		// 重新渲染 empty state（书名变化）
		// 避免 updateEmptyState 重新调用 renderQuickActions（那会重建 DOM 抹掉 deeppdf-hidden）
		if (this.messages.size === 0) {
			this.renderQuickActions();
		}
	}

	/**
	 * 设置加载状态：true 时显示 skeleton placeholder，false 时移除
	 * 同时在 messagesContainer 挂 aria-busy 供屏幕阅读器感知
	 */
	setLoading(loading: boolean): void {
		if (!this.messagesContainer) return;

		// 先清掉旧的 loading 节点
		const existingSkeletons = this.messagesContainer.querySelectorAll(
			".deeppdf-skeleton-message",
		);
		existingSkeletons.forEach((el) => el.remove());

		if (loading) {
			this.messagesContainer.setAttribute("aria-busy", "true");
			// 加载态时强制隐藏空状态（避免 skeleton 与空状态同时可见）
			if (this.emptyState) {
				this.emptyState.addClass("deeppdf-hidden");
			}
			// 渲染 3 个 skeleton placeholder
			for (let i = 0; i < 3; i++) {
				this.renderSkeletonMessage();
			}
		} else {
			this.messagesContainer.setAttribute("aria-busy", "false");
			this.updateEmptyState();
		}
	}

	/**
	 * 设置错误状态：显示 role=alert 的错误 banner + retry 按钮
	 */
	setError(message: string): void {
		if (!this.messagesContainer) return;

		this.clearError(); // 先清旧的

		const alert = this.messagesContainer.createDiv({
			cls: "deeppdf-message-list-error",
		});
		alert.setAttribute("role", "alert");

		const text = alert.createDiv({ cls: "deeppdf-message-list-error-text" });
		text.textContent = message;

		const retryBtn = alert.createEl("button", {
			cls: "deeppdf-message-list-retry-btn mod-cta",
			text: "重试",
		});
		retryBtn.addEventListener("click", () => {
			this.callbacks.onRetry?.();
		});
	}

	/**
	 * 清除错误状态
	 */
	clearError(): void {
		if (!this.messagesContainer) return;
		const existing = this.messagesContainer.querySelectorAll(
			".deeppdf-message-list-error",
		);
		existing.forEach((el) => el.remove());
	}

	/**
	 * 渲染单条 skeleton placeholder（loading 状态）
	 */
	private renderSkeletonMessage(): void {
		if (!this.messagesContainer) return;
		const skeleton = this.messagesContainer.createDiv({
			cls: "deeppdf-skeleton-message",
		});
		skeleton.setAttribute("aria-hidden", "true");
		// 模拟消息气泡 + 文本行
		const bubble = skeleton.createDiv({
			cls: "deeppdf-skeleton-bubble",
		});
		bubble.createDiv({ cls: "deeppdf-skeleton-line" });
		bubble.createDiv({ cls: "deeppdf-skeleton-line short" });
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
		if (!this.minimap) return;

		// 消息数 < 3 时不显示 minimap —— 对话刚开始时右侧不出现竖条
		// （仅在需要滚动导航的长对话中才有价值）
		const messageCount = this.messages.size;
		const minShowMessages = 3;
		if (messageCount < minShowMessages) {
			this.minimap.getElement()?.addClass("deeppdf-minimap-hidden");
			return;
		}
		this.minimap.getElement()?.removeClass("deeppdf-minimap-hidden");

		// 延迟更新，等待 DOM 渲染完成
		requestAnimationFrame(() => {
			this.minimap?.updateMessages(this.getMessagesData());
		});
	}

	/**
	 * 更新空状态显示
	 */
	private updateEmptyState(): void {
		if (!this.emptyState || !this.messagesContainer || !this.quickActionsEl) {
			return;
		}

		const hasMessages = this.messages.size > 0;

		// 切换 root 的 .deeppdf-is-empty 状态，CSS 用 :has() 隐藏 topbar
		if (this.el) {
			this.el.toggleClass("deeppdf-is-empty", !hasMessages);
		}

		if (hasMessages) {
			// 在 hidden 之前先检查焦点：避免 aria-hidden 拦截错误
			// （如果 activeElement 在空状态内，需先 blur）
			if (
				this.emptyState.contains(document.activeElement) &&
				document.activeElement instanceof HTMLElement
			) {
				document.activeElement.blur();
			}
			this.emptyState.addClass("deeppdf-hidden");
			// 用 inert 同时实现隐藏 AT + 阻止 focus 进入
			// （aria-hidden 在 descendant 有焦点时会被浏览器拦截）
			this.emptyState.inert = true;
			this.emptyState.setAttribute("aria-hidden", "true");
			this.messagesContainer.removeClass("deeppdf-hidden");
			this.messagesContainer.inert = false;
			this.messagesContainer.setAttribute("aria-hidden", "false");
			// 消息列表非空时显示 minimap
			this.minimap?.getElement()?.removeClass("deeppdf-minimap-hidden");
		} else {
			this.emptyState.removeClass("deeppdf-hidden");
			this.emptyState.inert = false;
			this.emptyState.setAttribute("aria-hidden", "false");
			this.messagesContainer.addClass("deeppdf-hidden");
			this.messagesContainer.inert = true;
			this.messagesContainer.setAttribute("aria-hidden", "true");
			// 空状态时隐藏 minimap（避免右侧出现 20px 视口条）
			this.minimap?.getElement()?.addClass("deeppdf-minimap-hidden");

			// 更新快捷操作按钮
			this.renderQuickActions();
		}
	}

	/**
	 * 渲染快捷操作按钮 / empty state
	 *
	 * 2026-06 重构：去掉 XITONG_IMG 全屏背景图（人物 JPG 作为背景怎么都像 AI 模板），
	 * 改为：顶部小圆形 avatar + 紧凑文字层次 + 按钮网格。
	 */
	private renderQuickActions(): void {
		if (!this.quickActionsEl) return;

		// 清空现有内容
		this.quickActionsEl.empty();

		// 统一渲染结构
		const wrapper = this.quickActionsEl.createEl("div", {
			cls: "deeppdf-empty-state-content",
		});

		// 有封面时，整体包在 hero 容器里，封面作底层背景
		const coverUrl = this.callbacks.getCurrentBookInfo?.()?.coverUrl;
		let contentWrapper = wrapper;
		if (this.currentPdfName && coverUrl) {
			const heroSection = wrapper.createEl("div", {
				cls: "deeppdf-empty-hero",
			});
			heroSection.createEl("img", {
				cls: "deeppdf-empty-hero-cover",
				attr: { src: coverUrl, alt: "" },
			});
			// 内容叠在封面上
			contentWrapper = heroSection.createDiv({
				cls: "deeppdf-empty-hero-content",
			});
		}

		// 奚童头像 —— 打字标题上方
		const avatar = contentWrapper.createDiv({
			cls: "deeppdf-empty-avatar deeppdf-animated",
		});
		avatar.setAttribute("aria-hidden", "true");
		const mascot = new MascotFace();
		avatar.appendChild(mascot.getElement()!);

		// 招呼标题 —— 打字机逐字呈现（多条轮播，含能力介绍）
		const title = contentWrapper.createEl("h2", {
			cls: "deeppdf-empty-title",
		});
		const typewriterMessages = this.currentPdfName
			? [
					"你好，我是奚童",
					"准备好探索这本书了吗",
					"想聊聊这本书吗",
					"一起读这本书吧",
					"有什么想了解的吗",
					"可以问我书中的观点、概念，或者帮你梳理全书脉络",
					"支持章节分析、关键概念提取、思维导图生成",
					"想了解核心观点？还是需要阅读路线建议？",
					"随时可以聊聊你的阅读感受或疑问",
				]
			: [
					"你好，我是奚童",
					"想找本好书聊聊吗",
					"今天想聊点什么",
					"随时为你效劳",
					"推荐书单、讨论读书方法、整理笔记，都可以",
					"可以聊聊你最近在读什么，或者想要什么类型的书",
					"有什么阅读上的问题，随时问我",
				];
		this.startTypewriter(title, typewriterMessages);

		// 书籍信息 —— 书名 + 作者
		if (this.currentPdfName) {
			const bookMeta = this.callbacks.getCurrentBookInfo?.();
			const bookInfo = contentWrapper.createEl("div", {
				cls: "deeppdf-empty-book-info",
			});
			const bookTitleRow = bookInfo.createDiv({
				cls: "deeppdf-empty-book-title-row",
			});
			bookTitleRow.createEl("span", {
				cls: "deeppdf-empty-book-icon",
				text: "📖",
				attr: { "aria-hidden": "true" },
			});
			bookTitleRow.createEl("span", {
				cls: "deeppdf-empty-book-text",
				text: this.currentPdfName,
			});
			if (bookMeta?.author) {
				bookInfo.createEl("p", {
					cls: "deeppdf-empty-book-author",
					text: bookMeta.author,
				});
			}
		}

		// 副标题 —— 固定文案
		contentWrapper.createEl("p", {
			cls: "deeppdf-empty-subtitle",
			text: "你的 AI 伴读",
		});

		// 按钮网格
		const grid = contentWrapper.createEl("div", {
			cls: "deeppdf-empty-grid",
		});

		// 选择要显示的按钮组
		const buttons = this.currentPdfName ? GUIDANCE_BUTTONS : ADVISOR_BUTTONS;
		if (this.callbacks.onGuidanceClick) {
			buttons.forEach((button) => {
				const btn = grid.createEl("button", {
					cls: "deeppdf-empty-btn-minimal",
					text: button.label,
				});
				btn.setAttribute("type", "button");
				btn.addEventListener("click", () => {
					this.callbacks.onGuidanceClick?.(button.type);
				});
			});
		} else {
			// 无回调时的降级占位
			grid.createEl("div", {
				cls: "deeppdf-empty-placeholder",
				text: "选择一本书籍开始阅读",
			});
		}
	}

	/**
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
	 * 打字机逐字呈现 —— 支持多条文字轮播
	 * @param el 标题元素
	 * @param texts 文字数组，随机顺序轮播
	 * @param speedMs 每个字符间隔（默认 100ms）
	 * 尊重 prefers-reduced-motion：用户在系统设置开启"减少动画"时，
	 * 直接显示随机一条文本，不播打字机效果。
	 */
	private startTypewriter(
		el: HTMLElement,
		texts: string[],
		typeSpeedMs: number = 180,
		eraseSpeedMs: number = 80,
		holdMs: number = 1800,
		waitMs: number = 600,
	): void {
		// 检查 prefers-reduced-motion
		const prefersReducedMotion =
			typeof window !== "undefined" &&
			window.matchMedia &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		if (prefersReducedMotion) {
			el.textContent = texts[0];
			return;
		}

		el.addClass("deeppdf-typing-cursor");

		// Fisher-Yates 洗牌，生成随机顺序
		const shuffled = [...texts];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}

		let textIndex = 0;
		let currentText = shuffled[0];

		type Phase = "typing" | "holding" | "erasing" | "waiting";
		let phase: Phase = "typing";
		let charIndex = 0;

		const tick = (): void => {
			switch (phase) {
				case "typing":
					charIndex++;
					el.textContent = currentText.slice(0, charIndex);
					if (charIndex >= currentText.length) {
						phase = "holding";
						this.safeSetTimeout(tick, holdMs);
					} else {
						this.safeSetTimeout(tick, typeSpeedMs);
					}
					break;
				case "holding":
					phase = "erasing";
					this.safeSetTimeout(tick, 200);
					break;
				case "erasing":
					charIndex--;
					el.textContent = currentText.slice(0, charIndex);
					if (charIndex <= 0) {
						phase = "waiting";
						this.safeSetTimeout(tick, waitMs);
					} else {
						this.safeSetTimeout(tick, eraseSpeedMs);
					}
					break;
				case "waiting":
					// 切换到下一条文字
					textIndex = (textIndex + 1) % shuffled.length;
					currentText = shuffled[textIndex];
					phase = "typing";
					this.safeSetTimeout(tick, 300);
					break;
			}
		};

		this.safeSetTimeout(tick, typeSpeedMs);
	}

	/**
	 * 安全 setTimeout：自动注册到 _pendingTimeouts 以便 destroy 时清理
	 */
	private safeSetTimeout(
		handler: () => void,
		ms: number,
	): ReturnType<typeof setTimeout> {
		const id = setTimeout(() => {
			this._pendingTimeouts.delete(id);
			handler();
		}, ms);
		this._pendingTimeouts.add(id);
		return id;
	}

	/**
	 * 销毁组件
	 */
	override destroy(): void {
		// 停止所有未完成的 setTimeout（打字机 / loading 等）
		this._pendingTimeouts.forEach((id) => clearTimeout(id));
		this._pendingTimeouts.clear();

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
