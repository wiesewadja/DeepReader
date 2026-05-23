/**
 * DeepPDF 消息组件
 * 实现 ChatGPT 风格的聊天消息界面，支持 Markdown 渲染和流式更新
 */

import { App, MarkdownRenderer, Component, HoverParent, HoverPopover, MarkdownView } from 'obsidian';
import type { ExcerptContent, ExcerptMetadata } from '../../types/excerpt';
import type { QuoteMetadata } from '../chat-input/chat-input';
import { SelectionMenu } from '../excerpt/selection-menu';
import { uiLog as log, error as logError } from '../../utils/logger.js';
import { Icons } from '../../utils/icons.js';

// 从拆分模块 re-export
export type { MessageRole, AgentToolCall, AgentThought, MessageData } from './types.js';
export { parseAgentContent } from './parse-agent-content.js';
export { escapeHtml, formatTimestamp, extractSectionByBlockRef } from './utils.js';
export { resolveWikiLinkPreview, setupInternalLinks } from './internal-links.js';

// 内部引用
import type { MessageData, AgentToolCall } from './types.js';
import { parseAgentContent } from './parse-agent-content.js';
import { escapeHtml as _escapeHtml, formatTimestamp as _formatTimestamp, extractSectionByBlockRef as _extractSectionByBlockRef } from './utils.js';
import { setupInternalLinks as _setupInternalLinks } from './internal-links.js';
import { VoiceLetterController } from './voice-letter-controller.js';
import { FullscreenController } from './fullscreen-controller.js';

/**
 * 消息基类
 */
export abstract class Message {
	protected el: HTMLElement | null = null;
	protected data: MessageData;
	protected app?: App;
	// 资源清理跟踪
	protected observers: MutationObserver[] = [];

	setTTSState?(state: 'idle' | 'summarizing' | 'tts_loading' | 'playing' | 'paused'): void;
	/**
	 * 高亮 TTS 播放进度（段落级）
	 * @param progress 0-100 的进度值
	 */
	highlightTTSProgress?(progress: number): void;

	constructor(data: MessageData, app?: App) {
		this.data = data;
		this.app = app;
	}

	public getData(): MessageData {
		return this.data;
	}

	/**
	 * 渲染消息容器
	 */
	protected renderContainer(): HTMLElement {
		const container = document.createElement('div');
		container.addClass('deeppdf-message');
		container.addClass(`deeppdf-message-${this.data.role}`);
		container.setAttribute('data-message-id', this.data.id);
		return container;
	}

	/**
	 * 渲染时间戳
	 */
	protected renderTimestamp(): HTMLElement {
		const timeEl = document.createElement('div');
		timeEl.addClass('deeppdf-message-time');
		timeEl.textContent = _formatTimestamp(this.data.timestamp);
		return timeEl;
	}

	protected escapeHtml(text: string): string {
		return _escapeHtml(text);
	}

	abstract render(): HTMLElement;

	/**
	 * 更新消息内容 (优化版: 避免全量重绘)
	 */
	update(data: Partial<MessageData>): void {
		const oldContent = this.data.content;
		const oldAgentToolCalls = this.data.agentToolCalls;
		const wasStreaming = this.data.isStreaming;

		Object.assign(this.data, data);

		// 检查字段变化
		const agentToolCallsChanged = data.agentToolCalls !== undefined && (
			data.agentToolCalls !== oldAgentToolCalls &&
			(data.agentToolCalls?.length !== oldAgentToolCalls?.length || data.agentToolCalls?.[0]?.name !== oldAgentToolCalls?.[0]?.name)
		);
		const streamingEnded = wasStreaming && data.isStreaming === false;

		if (this.el &&
			data.content !== undefined &&
			data.content !== oldContent &&
			!agentToolCallsChanged &&
			!streamingEnded
		) {
			this.updateContent(data.content);
		} else if (streamingEnded && this.el) {
			// 流式结束，完整渲染
			// 补充渲染操作按钮（流式期间被跳过）
			this.onStreamingEnd();
			const contentEl = this.el.querySelector('.deeppdf-message-content');
			if (contentEl && this.app) {
				// 清理资源
				this.observers.forEach(obs => obs.disconnect());
				this.observers = [];

				// 移除 loading 状态
				if ((contentEl as HTMLElement).hasClass('deeppdf-message-loading')) {
					(contentEl as HTMLElement).removeClass('deeppdf-message-loading');
				}

				// 使用解析后的内容（处理 HTML 标签）
				const { cleanedContent } = parseAgentContent(this.data.content);

				contentEl.empty();
				const sourcePath = this.data.pdfName || '';
				MarkdownRenderer.render(this.app, cleanedContent, contentEl as HTMLElement, sourcePath, new Component()).then(() => {
				});
			}
			this.el.removeClass('deeppdf-message-streaming');
		} else {
			// 全量重绘
			const newRender = this.render();
			if (this.el) {
				this.el.replaceWith(newRender);
			}
			this.el = newRender;
		}
	}


	/**
	 * 局部更新内容
	 */
	protected abstract updateContent(content: string): void;

	/**
	 * 流式结束后的钩子，子类可 override 补充渲染
	 */
	protected onStreamingEnd(): void {}

	getElement(): HTMLElement {
		if (!this.el) {
			throw new Error('Message element not initialized. Call render() first.');
		}
		return this.el;
	}
}

/**
 * 用户消息组件
 */
export class UserMessage extends Message {
	constructor(data: MessageData, app?: App) {
		super(data, app);
		this.el = this.render();
	}

	render(): HTMLElement {
		const container = this.renderContainer();
		const wrapper = container.createEl('div', { cls: 'deeppdf-message-wrapper' });
		const bubble = wrapper.createEl('div', { cls: ['deeppdf-message-bubble', 'deeppdf-message-bubble-user'] });

		const content = bubble.createEl('div', { cls: 'deeppdf-message-content' });

		// 渲染引用内容（浅色 blockquote 样式）
		if (this.data.quotes && this.data.quotes.length > 0) {
			const quotesEl = content.createEl('div', { cls: 'deeppdf-user-quotes' });
			for (const q of this.data.quotes) {
				const quoteBlock = quotesEl.createEl('div', { cls: 'deeppdf-user-quote-item' });
				const location = q.headingPath?.join(' > ') || q.heading || q.source || '';
				quoteBlock.createEl('div', { cls: 'deeppdf-user-quote-text', text: q.text });
				if (location) {
					quoteBlock.createEl('div', { cls: 'deeppdf-user-quote-source', text: location });
				}
			}
			content.createEl('div', { cls: 'deeppdf-user-quote-divider' });
		}

		// 用户消息支持 Markdown 渲染（如果 app 存在）
		if (this.app) {
			const sourcePath = this.data.pdfName || '';
			const textEl = content.createDiv();
			MarkdownRenderer.render(this.app, this.data.content, textEl, sourcePath, new Component());
		} else {
			content.createDiv({ text: this.data.content });
		}

		bubble.appendChild(this.renderTimestamp());
		return container;
	}

	protected updateContent(content: string): void {
		const contentEl = this.el?.querySelector('.deeppdf-message-content');
		if (contentEl) {
			contentEl.empty();
			if (this.app) {
				const sourcePath = this.data.pdfName || '';
				MarkdownRenderer.render(this.app, content, contentEl as HTMLElement, sourcePath, new Component());
			} else {
				contentEl.innerHTML = this.escapeHtml(content);
			}
		}
	}
}

/**
 * AI 消息组件
 */
export class AIMessage extends Message {
	private onRegenerate?: () => void;
	private onCopy?: () => void;
	private onQuestionClick?: (question: string) => void;
	private onExcerpt?: (content: ExcerptContent, metadata: ExcerptMetadata) => void;
	private onQuote?: (metadata: QuoteMetadata) => void;
	private onDelete?: () => void;
	private onTTS?: (messageId: string, content: string) => void;

		protected onStreamingEnd(): void {
			if (!this.el) return;
			const bubble = this.el.querySelector(".deeppdf-message-bubble");
			if (bubble) {
				this.renderActions(bubble as HTMLElement);
			}
		}

	// 节流渲染跟踪变量
	private lastRenderedContent: string = '';
	private lastRenderTime: number = 0;
	private lastRenderedLength: number = 0;
	private streamingAnimationFrame: number | null = null;
	// 状态显示跟踪：记录上次实际显示在 DOM 中的状态（用于判断是否需要更新）
	private lastDisplayedStatus: string | undefined = undefined;
	// 文字选中悬浮菜单
	private selectionMenu: SelectionMenu | null = null;
	// 状态文本元素引用
	private statusEl: HTMLElement | null = null;
	// 语音书信模式控制器
	private voiceCtrl: VoiceLetterController;
	private fullscreenCtrl: FullscreenController | null = null;
	private getAllMessages: (() => MessageData[]) | null = null;
	private getCurrentBookInfo: (() => { coverUrl: string | null; author: string | null; bookName: string | null }) | null = null;
	// 信笺图案
	private patternClass: string = '';
	private getBubbleTheme?: () => string;
	// TTS 按钮引用（由 renderActions 设置，controller 读取）


	constructor(
		data: MessageData,
		options?: {
			onRegenerate?: () => void;
			onCopy?: () => void;
			onQuestionClick?: (question: string) => void;
			onExcerpt?: (content: ExcerptContent, metadata: ExcerptMetadata) => void;
			onQuote?: (metadata: QuoteMetadata) => void;
			onDelete?: () => void;
			onTTS?: (messageId: string, content: string) => void;
			onVoicePlay?: (messageId: string) => void;
			onVoicePause?: (messageId: string) => void;
			getAllMessages?: () => MessageData[];
			getCurrentBookInfo?: () => { coverUrl: string | null; author: string | null; bookName: string | null };
			getBubbleTheme?: () => string;
			app?: App;
		}
	) {
		super(data, options?.app);
		this.onRegenerate = options?.onRegenerate;
		this.onCopy = options?.onCopy;
		this.onQuestionClick = options?.onQuestionClick;
		this.onExcerpt = options?.onExcerpt;
		this.onQuote = options?.onQuote;
		this.onDelete = options?.onDelete;
		this.onTTS = options?.onTTS;
		this.getAllMessages = options?.getAllMessages || null;
		this.getCurrentBookInfo = options?.getCurrentBookInfo || null;
		this.getBubbleTheme = options?.getBubbleTheme;
		// 初始化渲染跟踪变量
		this.lastRenderedContent = data.content;
		this.lastRenderTime = Date.now();
		this.lastRenderedLength = data.content.length;
		// 语音书信模式控制器
		this.voiceCtrl = new VoiceLetterController({
			getEl: () => this.el,
			getData: () => this.data,
			update: (d) => this.update(d),
			renderTimestamp: () => this.renderTimestamp(),
			renderActions: (b) => this.renderActions(b),
			requestRerender: () => this.requestRerender(),
		}, data);
		this.voiceCtrl.onVoicePlay = options?.onVoicePlay;
		this.voiceCtrl.onVoicePause = options?.onVoicePause;
		this.el = this.render();
	}

	/**
	 * 随机选择背景图案类
	 * 每个 AI 消息都是一封独特的信，给用户带来惊喜和新奇感
	 */
	private getPatternClass(): string {
		return `deeppdf-pattern-${this.getBubbleTheme?.() || 'notebook'}`;
	}

	render(): HTMLElement {
		const container = this.renderContainer();
		const wrapper = container.createEl('div', { cls: 'deeppdf-message-wrapper' });

		// 随机选择背景图案（每次 AI 回复都是一封独特的信）
		const patternClass = this.getPatternClass();
		this.patternClass = patternClass;
		const bubble = wrapper.createEl('div', { cls: ['deeppdf-message-bubble', 'deeppdf-message-bubble-ai', patternClass] });

		// Agent 消息标识
		const headerRow = bubble.createEl('div', { cls: 'deeppdf-message-header-row' });
		if (this.data.isAgentMessage) {
			const badge = headerRow.createEl('div', { cls: 'deeppdf-message-agent-badge' });
			badge.textContent = "奚童";

			if (this.data.isProactiveGuidance) {
				const tag = headerRow.createEl("span", { cls: "deeppdf-message-proactive-tag" });
				tag.textContent = "阅读引导";
			}
		}

		// 思考条 — AI 处理中时显示（mascot + 状态文字）
		if (this.data.isAgentMessage) {
			const thinkingBar = bubble.createEl('div', { cls: 'deeppdf-mascot-thinking-bar' });
			this.statusEl = thinkingBar.createEl('div', { cls: 'deeppdf-message-status-text' });
			if (this.data.currentStatus && this.data.isStreaming) {
				this.statusEl.textContent = this.data.currentStatus;
				this.statusEl.addClass('visible');
				this.lastDisplayedStatus = this.data.currentStatus;
			}

			const ttsWave = thinkingBar.createEl('div', { cls: 'deeppdf-tts-wave' });
			for (let i = 0; i < 4; i++) {
				ttsWave.createEl('span');
			}
			this.voiceCtrl.ttsWaveEl = ttsWave;
		}

		// Agent 工具调用
		if (this.data.agentToolCalls && this.data.agentToolCalls.length > 0) {
			const toolsContainer = bubble.createEl('div', { cls: 'deeppdf-agent-tool-calls' });

			this.data.agentToolCalls.forEach(toolCall => {
				const toolItem = toolsContainer.createEl('div', { cls: 'deeppdf-agent-tool-call' });

				// 根据状态添加样式类
				if (toolCall.status === 'success') {
					toolItem.addClass('deeppdf-agent-tool-call-success');
				} else if (toolCall.status === 'error') {
					toolItem.addClass('deeppdf-agent-tool-call-error');
				}

				const toolHeader = toolItem.createEl('div', { cls: 'deeppdf-agent-tool-header' });
				toolHeader.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 1v6m0 6v6"></path><path d="M5.64 5.64l4.24 4.24m6.72 6.72l4.24 4.24"></path></svg>调用 <span class="deeppdf-agent-tool-name">${toolCall.name}</span>`;

				if (toolCall.args) {
					const toolArgs = toolItem.createEl('div', { cls: 'deeppdf-agent-tool-args' });
					toolArgs.textContent = toolCall.args;
				}

				if (toolCall.result) {
					const toolResult = toolItem.createEl('div', { cls: 'deeppdf-agent-tool-result' });
					toolResult.textContent = toolCall.result;
				}
			});
		}

		// 语音书信模式：语音气泡 + 信封/完整内容
		if (this.voiceCtrl.enableVoiceReply) {
			// 渲染语音气泡
			this.voiceCtrl.renderVoiceBubble(bubble);


			if (this.voiceCtrl.letterState !== 'opened') {
				// 信封模式：流式开始就显示，内部有写信动画
				this.voiceCtrl.renderLetterEnvelope(bubble, this.data.content);
			} else {
				const content = bubble.createEl('div', { cls: 'deeppdf-message-content' });
				if (this.app) {
					const { cleanedContent } = parseAgentContent(this.data.content);
					const sourcePath = this.data.pdfName || '';
					MarkdownRenderer.render(this.app, cleanedContent, content, sourcePath, new Component()).then(() => {
					});
				} else {
					const { cleanedContent } = parseAgentContent(this.data.content);
					content.innerHTML = this.escapeHtml(cleanedContent);
				}
				// 收起回信封按钮
				const collapseBtn = bubble.createDiv({ cls: 'deeppdf-letter-collapse-btn' });
				collapseBtn.textContent = '收起 ↩';
				collapseBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.voiceCtrl.letterState = 'sealed';
					this.requestRerender();
				});
			}
		} else {
			// 普通模式：正常消息内容
			const content = bubble.createEl('div', { cls: 'deeppdf-message-content' });

			// 如果正在流式传输且内容为空，显示加载动画
			if (this.data.isStreaming && (!this.data.content || this.data.content.trim().length === 0)) {
				content.addClass('deeppdf-message-loading');
				content.innerHTML = `<div class="deeppdf-loading-dots"><span></span><span></span><span></span></div>`;
			} else {
				// 使用 Markdown 渲染（先清理 <thought> 标签）
				if (this.app) {
					const { cleanedContent } = parseAgentContent(this.data.content);
					// 使用当前 PDF 文件路径作为 sourcePath，以便正确解析 wikilink
					const sourcePath = this.data.pdfName || '';
					MarkdownRenderer.render(this.app, cleanedContent, content, sourcePath, new Component()).then(() => {
						_setupInternalLinks(content, this.app!, this.data.isStreaming, this.observers);
					});
				} else {
					const { cleanedContent } = parseAgentContent(this.data.content);
					content.innerHTML = this.escapeHtml(cleanedContent);
				}
			}
		}

		// 流式输出期间不显示时间戳，等到结束后再显示完成时间
		if (!this.data.isStreaming) {
			bubble.appendChild(this.renderTimestamp());
		}

		// 渲染操作按钮
		this.renderActions(bubble);

		// 如果正在流式传输，添加光标效果 (由 CSS 处理 .deeppdf-message-streaming)
		if (this.data.isStreaming) {
		 container.addClass('deeppdf-message-streaming');
        } else {
            container.removeClass('deeppdf-message-streaming');
        }

		// 设置文字选中监听（仅对非流式消息）
		if (!this.data.isStreaming) {
			const contentEl = container.querySelector('.deeppdf-message-content') as HTMLElement;
				if (contentEl) this.setupSelectionListener(contentEl);
		}

		return container;
	}

	update(data: Partial<MessageData>): void {
		const oldContent = this.data.content;
		const oldAgentToolCalls = this.data.agentToolCalls;
		const wasStreaming = this.data.isStreaming;

		Object.assign(this.data, data);

		const agentToolCallsChanged = data.agentToolCalls !== undefined && (
			data.agentToolCalls !== oldAgentToolCalls &&
			(data.agentToolCalls?.length !== oldAgentToolCalls?.length || data.agentToolCalls?.[0]?.name !== oldAgentToolCalls?.[0]?.name)
		);
		const streamingEnded = wasStreaming && data.isStreaming === false;

		// 比较上次实际显示的状态（非 data 旧值），因 currentStatus 被持久化存储
		const newStatus = data.currentStatus !== undefined ? data.currentStatus : (this.data as any).currentStatus;
		if (this.el && this.statusEl) {
			if (newStatus) {
				this.statusEl.textContent = newStatus;
				this.statusEl.addClass('visible');
				this.lastDisplayedStatus = newStatus;
			} else if (!newStatus && this.lastDisplayedStatus) {
				this.statusEl.textContent = '';
				this.statusEl.removeClass('visible');
				this.lastDisplayedStatus = undefined;
			}
		}

		if (this.voiceCtrl.enableVoiceReply && this.el) {
			this.handleVoiceLetterUpdate(data, oldContent, streamingEnded);
			return;
		}

		if (this.el && this.data.isStreaming && !streamingEnded) {
			if (data.content !== undefined && data.content !== oldContent) {
				this.updateContent(data.content);
			}
			if (agentToolCallsChanged && data.agentToolCalls) {
				this.updateToolCalls(data.agentToolCalls);
			}
			return;
		}

		if (this.el && data.content !== undefined && data.content !== oldContent && !agentToolCallsChanged && !streamingEnded) {
			this.updateContent(data.content);
		} else if (streamingEnded && this.el) {
			this.finalizeStreamingEnd();
		} else {
			const newRender = this.render();
			if (this.el) {
				this.el.replaceWith(newRender);
			}
			this.el = newRender;
		}
	}

	private handleVoiceLetterUpdate(data: Partial<MessageData>, oldContent: string, streamingEnded: boolean | undefined): void {
		if (data.content !== undefined && data.content !== oldContent) {
			this.updateContent(data.content);
		}
		if (data.voiceState) {
			this.voiceCtrl.voiceState = data.voiceState;
			this.voiceCtrl.updateVoiceBubbleUI();
		}
		if (streamingEnded) {
			this.voiceCtrl.updateLetterEnvelopeUI();
			this.hideStreamingState();
			this.voiceCtrl.appendTimestampAndActions();
		}
	}

	private finalizeStreamingEnd(): void {
		const bubble = this.el!.querySelector('.deeppdf-message-bubble');
		const contentEl = this.el!.querySelector('.deeppdf-message-content');

		if (this.statusEl) {
			this.statusEl.innerHTML = '';
			this.statusEl.removeClass('visible');
		}
		this.lastDisplayedStatus = undefined;

		if (contentEl && this.app) {
			this.observers.forEach(obs => obs.disconnect());
			this.observers = [];

			if ((contentEl as HTMLElement).hasClass('deeppdf-message-loading')) {
				(contentEl as HTMLElement).removeClass('deeppdf-message-loading');
			}

			const { cleanedContent } = parseAgentContent(this.data.content);
			contentEl.empty();
			const sourcePath = this.data.pdfName || '';
			const appRef = this.app;
			MarkdownRenderer.render(this.app, cleanedContent, contentEl as HTMLElement, sourcePath, new Component()).then(() => {
				if (appRef) {
					_setupInternalLinks(contentEl as HTMLElement, appRef, false, this.observers);
				}
			});
		}
		this.el!.removeClass('deeppdf-message-streaming');
		if (contentEl) {
			this.setupSelectionListener(contentEl as HTMLElement);
		}

		if (bubble) {
			if (!bubble.querySelector('.deeppdf-message-time')) {
				bubble.appendChild(this.renderTimestamp());
			}
			this.renderActions(bubble as HTMLElement);
		}
	}

	protected updateContent(content: string): void {
		// 语音书信模式：更新信封内容
		if (this.voiceCtrl.enableVoiceReply) {
			const inkEl = this.el?.querySelector('.deeppdf-letter-ink');
			if (inkEl) {
				this.voiceCtrl.updateLetterContent(inkEl as HTMLElement, content);
			}
			return;
		}

		const contentEl = this.el?.querySelector('.deeppdf-message-content');
		if (!contentEl) return;

		// 【关键】流式更新时，如果内容有实际文本（不是空白/只状态行），自动隐藏状态
		// 这样用户一旦看到 AI 回复内容，状态提示就自动消失
		if (this.data.isStreaming && this.el) {
			const { cleanedContent } = parseAgentContent(content);
			// 如果有实质内容（长度 > 20 且不只是空白字符），隐藏状态
			if (cleanedContent.trim().length > 20) {
				const statusEl = this.el.querySelector('.deeppdf-message-status-text');
				if (statusEl && statusEl.textContent !== '') {
					statusEl.textContent = '';
					statusEl.removeClass('visible');
					this.lastDisplayedStatus = undefined;
					log('[DeepPDF] updateContent() - 检测到实际内容，自动隐藏状态');
				}
			}
			this.streamingUpdateContent(contentEl as HTMLElement, content);
		} else {
			// 非流式更新，完全重绘（异步执行，确保链接事件正确绑定）
			this.fullUpdateContent(contentEl as HTMLElement, content);
		}
	}

	/**
	 * 增量更新工具调用（流式期间避免全量重绘）
	 */
	protected updateToolCalls(toolCalls: AgentToolCall[]): void {
		if (!this.el) return;

		// 查找工具调用容器
		const toolCallsEl = this.el.querySelector('.deeppdf-agent-tool-calls');
		if (!toolCallsEl) {
			// 如果容器不存在，需要创建它（但不触发全量重绘）
			const thoughtsEl = this.el.querySelector('.deeppdf-agent-thoughts');
			if (thoughtsEl && thoughtsEl.parentElement) {
				thoughtsEl.parentElement.createEl('div', { cls: 'deeppdf-agent-tool-calls' });
			}
			return;
		}

		// 清空并重新渲染工具调用
		toolCallsEl.empty();
		for (const call of toolCalls) {
			const callEl = toolCallsEl.createEl('div', { cls: 'deeppdf-agent-tool-call' });
			callEl.createEl('div', { cls: 'deeppdf-agent-tool-name', text: call.name });
			callEl.createEl('div', { cls: 'deeppdf-agent-tool-status', text: call.status });
		}
	}

	/**
	 * 流式更新 - 实时渲染 Markdown，但将链接显示为文本样式
	 *
	 * 优化策略：
	 * 1. 【Markdown 渲染】流式时正常渲染 Markdown 格式
	 * 2. 【链接文本化】将生成的链接用 CSS 禁用交互效果
	 * 3. 【节流更新】减少渲染频率，避免频繁的 DOM 操作
	 */
	private streamingUpdateContent(contentEl: HTMLElement, newContent: string): void {
		// 取消之前的动画帧
		if (this.streamingAnimationFrame !== null) {
			cancelAnimationFrame(this.streamingAnimationFrame);
		}

		this.streamingAnimationFrame = requestAnimationFrame(() => {
			const now = Date.now();

				// 解析内容（状态由 LangGraph onProgress 驱动，不从此处提取）
				const { cleanedContent } = parseAgentContent(newContent);

				const contentLen = cleanedContent.length;
				const contentGrowth = contentLen - this.lastRenderedLength;
				const timePassed = now - this.lastRenderTime;

				const normalizedNew = cleanedContent.trim();
				const normalizedOld = this.lastRenderedContent.trim();
				const contentChanged = normalizedNew !== normalizedOld;

				let throttleThreshold = 100;
				if (contentLen > 1500) throttleThreshold = 400;
				else if (contentLen > 500) throttleThreshold = 200;

				const shouldRender = contentChanged && (contentGrowth > 50 || timePassed > throttleThreshold);

			if (shouldRender && this.app) {
				// 移除 loading 状态（首次渲染实际内容时）
				if (contentEl.hasClass('deeppdf-message-loading')) {
					contentEl.removeClass('deeppdf-message-loading');
				}

				// 【拟人化 UI 支持】检测是否是拟人化 UI 的 HTML 内容
				// 拟人化 UI 包含特定的 class 标识，可以直接渲染 HTML
				const isHumanizedUI = newContent.includes('deepreader-agent-humanized');

				if (isHumanizedUI) {
					// 直接渲染 HTML（拟人化 UI）
					contentEl.innerHTML = cleanedContent;
					// 更新跟踪变量
					this.lastRenderedContent = cleanedContent;
					this.lastRenderTime = Date.now();
					this.lastRenderedLength = contentLen;
				} else {
					// 渲染 Markdown（包括 wiki 链接）
					const tempContainer = document.createElement('div');
					const sourcePath = this.data.pdfName || '';

					MarkdownRenderer.render(this.app, cleanedContent, tempContainer, sourcePath, new Component()).then(() => {
						if (!this.el) return;

						// 渲染 Markdown 内容
						contentEl.innerHTML = tempContainer.innerHTML;

						// 【关键优化】流式时禁用内部链接的交互效果，避免闪烁
						// 通过 CSS 让链接看起来像普通文本，但保留视觉样式
						const links = contentEl.querySelectorAll('a');
						links.forEach(link => {
							const href = link.getAttribute('href');
							// 只处理内部链接（wiki 链接）
							if (href && (href.includes('#^page-') || href.startsWith('#'))) {
								(link as HTMLElement).style.pointerEvents = 'none';
								(link as HTMLElement).style.cursor = 'text';
								// 保留颜色但移除下划线，让它在流式时不显得"可点击"
								(link as HTMLElement).style.textDecoration = 'none';
							}
						});

						// 更新跟踪变量
						this.lastRenderedContent = cleanedContent;
						this.lastRenderTime = Date.now();
						this.lastRenderedLength = contentLen;
					});
				}
			}

			this.streamingAnimationFrame = null;
		});
	}

	/**
	 * 完全更新内容
	 */
	private async fullUpdateContent(contentEl: HTMLElement, content: string): Promise<void> {
		// 清理旧的 observers 和 mouseover handler
		this.observers.forEach(obs => obs.disconnect());
		this.observers = [];

		contentEl.empty();

		const { cleanedContent } = parseAgentContent(content);

		// 【拟人化 UI 支持】检测是否是拟人化 UI 的 HTML 内容
		const isHumanizedUI = content.includes('deepreader-agent-humanized');

		if (isHumanizedUI) {
			// 直接渲染 HTML（拟人化 UI）
			contentEl.innerHTML = cleanedContent;
		} else if (this.app) {
			const sourcePath = this.data.pdfName || '';
			// 等待 Markdown 渲染完成后再设置链接事件
			await MarkdownRenderer.render(this.app, cleanedContent, contentEl, sourcePath, new Component());
			_setupInternalLinks(contentEl, this.app, false, this.observers);
		} else {
			contentEl.innerHTML = this.escapeHtml(cleanedContent);
		}
	}

	private renderActions(container: HTMLElement) {
		// 流式传输中不渲染操作按钮（严格检查 true）
		if (this.data.isStreaming === true) {
			return;
		}

		// 先移除已有的操作按钮区域（避免重复）
		const existingActions = container.querySelector('.deeppdf-message-actions');
		if (existingActions) {
			existingActions.remove();
		}

		const hasActions = !!(this.onRegenerate || this.onCopy || this.onExcerpt || this.onDelete);
		// AI 消息始终显示操作按钮区域（包含跳转到顶部按钮）
		const isAssistant = this.data.role === 'assistant';
		if (hasActions || isAssistant) {
			const actions = container.createEl('div', { cls: 'deeppdf-message-actions' });

			// TTS 朗读按钮
			if (isAssistant) {
				const ttsBtn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				ttsBtn.innerHTML = Icons.volume2;
				ttsBtn.title = '朗读';
				ttsBtn.addEventListener('click', () => {
					if (this.onTTS) {
						this.onTTS(this.data.id, this.data.content);
					}
				});
				this.voiceCtrl.ttsBtn = ttsBtn;
			}

			// AI 消息：左下角全屏按钮
			if (isAssistant) {
				const fullscreenBtn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				fullscreenBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
				fullscreenBtn.title = "全屏展示";
				fullscreenBtn.addEventListener('click', () => this.openFullscreen());
			}

			// AI 消息：添加"跳转到顶部"按钮
			if (isAssistant) {
				const scrollToTopBtn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				// Icon: Arrow Up
				scrollToTopBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>`;
				scrollToTopBtn.title = "跳转到回复开头";
				scrollToTopBtn.addEventListener('click', () => this.scrollToMessageTop());
			}

			if (this.onRegenerate) {
				const btn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				// Icon: Refresh CW
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
				btn.title = "Regenerate";
				btn.addEventListener('click', () => this.onRegenerate?.());
			}
			if (this.onCopy) {
				const btn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				// Icon: Clipboard
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
				btn.title = "Copy";
				btn.addEventListener('click', () => this.onCopy?.());
			}
			if (this.onExcerpt) {
				const btn = actions.createEl('button', { cls: 'deeppdf-message-action-btn' });
				// Icon: Bookmark/Save
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
				btn.title = "Save as Excerpt";
				btn.addEventListener('click', () => this.handleExcerpt());
			}
			// 删除按钮（hover 时显示）
			if (this.onDelete) {
				const btn = actions.createEl('button', { cls: 'deeppdf-message-action-btn deeppdf-message-delete-btn' });
				// Icon: Trash
				btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;
				btn.title = "删除此对话";
				btn.addEventListener('click', () => this.onDelete?.());
			}
		}
	}

	/**
	 * 滚动到消息顶部
	 */
	private scrollToMessageTop(): void {
		if (!this.el) return;

		// 找到消息容器（可滚动的父元素）
		const messagesContainer = this.el.closest('.deeppdf-messages-container');
		if (messagesContainer) {
			// 计算消息元素相对于容器的位置
			const containerRect = messagesContainer.getBoundingClientRect();
			const messageRect = this.el.getBoundingClientRect();
			const offset = messageRect.top - containerRect.top + messagesContainer.scrollTop;

			// 平滑滚动到消息顶部
			messagesContainer.scrollTo({
				top: offset - 10, // 留 10px 的边距
				behavior: 'smooth'
			});
		}
	}




		// ─── 语音书信模式（委托给 VoiceLetterController）──────────────

		updateVoiceData(data: { audioBuffer: ArrayBuffer; duration: number }): void {
			this.voiceCtrl.updateVoiceData(data);
		}

		updateLetterState(state: 'sealing' | 'sealed' | 'opened'): void {
			this.voiceCtrl.updateLetterState(state);
		}

		updateVoiceState(state: 'loading' | 'ready' | 'playing' | 'paused' | 'ended'): void {
			this.voiceCtrl.updateVoiceState(state);
		}

		private updateVoiceBubbleUI(): void { this.voiceCtrl.updateVoiceBubbleUI(); }
		private renderVoiceBubble(container: HTMLElement): void { this.voiceCtrl.renderVoiceBubble(container); }
		private renderLetterEnvelope(container: HTMLElement, content: string): void { this.voiceCtrl.renderLetterEnvelope(container, content); }
		private toggleVoicePlayback(): void { this.voiceCtrl.toggleVoicePlayback(); }
		private updateLetterEnvelopeUI(): void { this.voiceCtrl.updateLetterEnvelopeUI(); }
		/** 隐藏流式状态（状态文本 + streaming class） */
		private hideStreamingState(): void {
			if (!this.el) return;
			this.el.removeClass('deeppdf-message-streaming');
			if (this.statusEl) {
				this.statusEl.innerHTML = '';
				this.statusEl.removeClass('visible');
			}
			this.lastDisplayedStatus = undefined;
		}

		/** 请求重新渲染 */
		private requestRerender(): void {
			// 触发全量重绘
			if (this.el) {
				const newRender = this.render();
				this.el.replaceWith(newRender);
				this.el = newRender;
			}
		}

	// ─── 全屏展示（委托给 FullscreenController）────────────────

	private openFullscreen(): void {
		if (!this.fullscreenCtrl) {
			const self = this;
			this.fullscreenCtrl = new FullscreenController({
				get el() { return self.el; },
				get data() { return self.data; },
				get app() { return self.app; },
				get patternClass() { return self.patternClass; },
			}, self.observers, self.getAllMessages, self.getCurrentBookInfo);
		}
		this.fullscreenCtrl.openFullscreen();
	}

	private closeFullscreen(): void {
		this.fullscreenCtrl?.closeFullscreen();
	}
	/**
	 * 处理摘录保存
	 */
	private handleExcerpt(): void {
		if (!this.onExcerpt) return;

		log(`[DeepPDF] handleExcerpt - pdfName: ${this.data.pdfName}`);

		const content: ExcerptContent = {
			text: this.data.content,
			rawMarkdown: this.data.content
		};

		const metadata: ExcerptMetadata = {
			sourcePdf: this.data.pdfName || 'Unknown',
			page: this.data.page,
			question: this.data.question,
			createdAt: new Date().toISOString(),
			conversationId: this.data.conversationId,
			messageId: this.data.id
		};

		this.onExcerpt(content, metadata);
	}

	/**
	 * 设置文字选中监听
	 */
	private setupSelectionListener(contentEl: HTMLElement): void {
		log(`[DeepPDF] setupSelectionListener - pdfName: ${this.data.pdfName}`);
		contentEl.addEventListener('mouseup', (e: MouseEvent) => {
			const selection = window.getSelection();
			if (!selection) return;

			const selectedText = selection.toString().trim();
			if (selectedText.length < 10) {
				// 选中文本太短，不显示菜单
				this.selectionMenu?.hide();
				return;
			}

			// 检查选区是否在当前元素内
			const range = selection.getRangeAt(0);
			if (!contentEl.contains(range.commonAncestorContainer)) {
				this.selectionMenu?.hide();
				return;
			}

			// 阅读模式下不显示摘录菜单（由 SelectionToolbar 处理）
			const isReadingMode = document.body.classList.contains('deeppdf-reading-mode');
			if (isReadingMode) {
				return;
			}

			// 创建或更新选中菜单
			if (!this.selectionMenu) {
				this.selectionMenu = new SelectionMenu({
					selectedText,
					sourcePdf: this.data.pdfName,
					page: this.data.page,
					question: this.data.question,
					conversationId: this.data.conversationId,
					messageId: this.data.id,
					app: this.app!,
					onQuote: (metadata: QuoteMetadata) => {
						if (this.onQuote) {
							this.onQuote(metadata);
						}
					}
				});
			} else {
				// 更新选项
				(this.selectionMenu as any).options = {
					selectedText,
					sourcePdf: this.data.pdfName,
					page: this.data.page,
					question: this.data.question,
					conversationId: this.data.conversationId,
					messageId: this.data.id,
					app: this.app!,
					onQuote: (metadata: QuoteMetadata) => {
						if (this.onQuote) {
							this.onQuote(metadata);
						}
					}
				};
			}

			// 显示菜单（在鼠标位置附近）
			const menuX = e.clientX + 10;
			const menuY = e.clientY + 10;
			this.selectionMenu.show(menuX, menuY);
		});
	}

	public destroy(): void {
		// 取消流式动画帧
		if (this.streamingAnimationFrame !== null) {
			cancelAnimationFrame(this.streamingAnimationFrame);
			this.streamingAnimationFrame = null;
		}

		// 断开所有 MutationObserver
		this.observers.forEach(observer => {
			observer.disconnect();
		});
		this.observers = [];

		// 移除全局 mouseover 监听器

		// 清理选中菜单
		if (this.selectionMenu) {
			this.selectionMenu.hide();
			this.selectionMenu = null;
		}

		// 清理语音播放资源
		this.voiceCtrl.destroy();

		// 清理全屏展示资源
		this.fullscreenCtrl?.destroy();
	}


	setTTSState(state: 'idle' | 'summarizing' | 'tts_loading' | 'playing' | 'paused'): void {
		this.voiceCtrl.setTTSState(state);
	}

	highlightTTSProgress(progress: number): void {
		this.voiceCtrl.highlightTTSProgress(progress);
	}
}

/**
 * 消息工厂函数
 */
export function createMessage(
	data: MessageData,
	options?: {
		onRegenerate?: () => void;
		onCopy?: () => void;
		onQuestionClick?: (question: string) => void;
		onExcerpt?: (content: ExcerptContent, metadata: ExcerptMetadata) => void;
		onQuote?: (metadata: QuoteMetadata) => void;
		onDelete?: () => void;
		getAllMessages?: () => MessageData[];
		onTTS?: (messageId: string, content: string) => void;
		onVoicePlay?: (messageId: string) => void;
		getCurrentBookInfo?: () => { coverUrl: string | null; author: string | null; bookName: string | null };
		getBubbleTheme?: () => string;
		app?: App;
	}
): Message {
	if (data.role === 'user') {
		return new UserMessage(data, options?.app);
	} else {
		return new AIMessage(data, options);
	}
}
