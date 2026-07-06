/**
 * DeepPDF 消息组件
 * 实现 ChatGPT 风格的聊天消息界面，支持 Markdown 渲染和流式更新
 */

import { type App, MarkdownRenderer, Component } from 'obsidian';
import type { ExcerptContent, ExcerptMetadata } from '../../types/excerpt';
import type { QuoteMetadata } from '../chat-input/chat-input';
import { uiLog as log, error as logError } from '../../utils/logger.js';

// 从拆分模块 re-export
export type { MessageRole, AgentToolCall, AgentThought, MessageData } from './types.js';
export { parseAgentContent } from './parse-agent-content.js';
export { escapeHtml, formatTimestamp, extractSectionByBlockRef } from './utils.js';
export { resolveWikiLinkPreview, setupInternalLinks } from './internal-links.js';

// 内部引用
import { FullscreenController } from './fullscreen-controller.js';
import { TTSReadingController } from './tts-reading-controller.js';
import { SelectionManager } from './selection-manager.js';
import { StreamingRenderer } from './streaming-renderer.js';
import { MessageActionsRenderer } from './message-actions.js';
import { setupInternalLinks as _setupInternalLinks } from './internal-links.js';
import { parseAgentContent } from './parse-agent-content.js';
import type { MessageData, AgentToolCall } from './types.js';
import { escapeHtml as _escapeHtml, formatTimestamp as _formatTimestamp } from './utils.js';
import { faceSVG } from '../reading-topbar/mascot-face.js';

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
	/**
	 * 直接高亮指定段落索引（无累计误差，更精准）
	 */
	highlightParagraphIndex?(index: number): void;

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
	private onStreamingEndCallback?: (messageId: string, content: string) => void;
		protected onStreamingEnd(): void {
			if (!this.el) return;
			const bubble = this.el.querySelector(".deeppdf-message-bubble");
			if (bubble) {
				this.actionsRenderer.render(bubble as HTMLElement);
			}
			// 通知消息列表流式结束
			this.onStreamingEndCallback?.(this.data.id, this.data.content);
		}

	// 委托控制器
	private readonly ttsReadingCtrl: TTSReadingController;
	private readonly selectionMgr: SelectionManager;
	private readonly streamingRenderer: StreamingRenderer;
	private readonly actionsRenderer: MessageActionsRenderer;
	// 状态显示跟踪
	private lastDisplayedStatus: string | undefined = undefined;
	private statusEl: HTMLElement | null = null;
	private thinkingMascotSvgEl: HTMLElement | null = null;
	private fullscreenCtrl: FullscreenController | null = null;
	private getAllMessages: (() => MessageData[]) | null = null;
	private getCurrentBookInfo: (() => { coverUrl: string | null; author: string | null; bookName: string | null }) | null = null;

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
			onStreamingEnd?: (messageId: string, content: string) => void;
			getAllMessages?: () => MessageData[];
			getCurrentBookInfo?: () => { coverUrl: string | null; author: string | null; bookName: string | null };
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
		this.onStreamingEndCallback = options?.onStreamingEnd;
		this.getAllMessages = options?.getAllMessages || null;
		this.getCurrentBookInfo = options?.getCurrentBookInfo || null;
		// 初始化委托控制器（self 闭包用于 host 接口）
		const self = this;
		this.ttsReadingCtrl = new TTSReadingController({ get el() { return self.el; } });
		this.selectionMgr = new SelectionManager({
			get el() { return self.el; },
			get app() { return self.app; },
			get data() { return self.data; },
			onExcerpt: self.onExcerpt?.bind(self),
			onQuote: self.onQuote?.bind(self),
		});
		this.streamingRenderer = new StreamingRenderer({
			get el() { return self.el; },
			get app() { return self.app; },
			get data() { return self.data; },
			get observers() { return self.observers; },
			escapeHtml: (text: string) => self.escapeHtml(text),
		}, data.content);
		this.actionsRenderer = new MessageActionsRenderer({
			get data() { return self.data; },
			onRegenerate: self.onRegenerate,
			onCopy: self.onCopy,
			onExcerpt: () => self.selectionMgr.handleExcerpt(),
			onDelete: self.onDelete,
			onTTS: self.onTTS,
			openFullscreen: () => self._openFullscreen(),
			scrollToMessageTop: () => self._scrollToMessageTop(),
			ttsReadingCtrl: self.ttsReadingCtrl,
		});

		this.el = this.render();
	}



	render(): HTMLElement {
		const container = this.renderContainer();
		const wrapper = container.createEl('div', { cls: 'deeppdf-message-wrapper' });

		const bubble = wrapper.createEl('div', { cls: ['deeppdf-message-bubble', 'deeppdf-message-bubble-ai'] });

		// Agent 消息标识
		const headerRow = bubble.createEl('div', { cls: 'deeppdf-message-header-row' });
		if (this.data.isAgentMessage) {
			if (this.data.isProactiveGuidance) {
				const tag = headerRow.createEl("span", { cls: "deeppdf-message-proactive-tag" });
				tag.textContent = "阅读引导";
			}
		}

		// 思考条 — AI 处理中时显示（mascot + 状态文字）
		if (this.data.isAgentMessage) {
			const thinkingBar = bubble.createEl('div', { cls: 'deeppdf-mascot-thinking-bar' });
			
			// 静态渲染奚童思考表情，防内存和计时器泄漏
			const mascotEl = thinkingBar.createEl('div', { cls: 'deeppdf-mascot-face' });
			const mascotSvgEl = mascotEl.createEl('div', { cls: 'deeppdf-mascot-face-svg' });
			mascotSvgEl.innerHTML = faceSVG('thinking');
			this.thinkingMascotSvgEl = mascotSvgEl;

			this.statusEl = thinkingBar.createEl('div', { cls: 'deeppdf-message-status-text' });
			// 图表占位气泡也算"加载态"，需要显示状态文字
			const isLoadingState = this.data.isStreaming || this.data.isDiagramPlaceholder;
			if (this.data.currentStatus && isLoadingState) {
				this.statusEl.textContent = this.data.currentStatus;
				this.statusEl.addClass('visible');
				this.lastDisplayedStatus = this.data.currentStatus;
			}

			const ttsWave = thinkingBar.createEl('div', { cls: 'deeppdf-tts-wave' });
			for (let i = 0; i < 4; i++) {
				ttsWave.createEl('span');
			}
			this.ttsReadingCtrl.setTtsWaveEl(ttsWave);
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
		}

		// 消息内容
		{
			const content = bubble.createEl('div', { cls: 'deeppdf-message-content' });

			// 流式输出空内容 / 图表占位气泡 → 显示加载动画
			const isLoadingPlaceholder = this.data.isDiagramPlaceholder
				|| (this.data.isStreaming && (!this.data.content || this.data.content.trim().length === 0));
			if (isLoadingPlaceholder) {
				content.addClass('deeppdf-message-loading');
				content.innerHTML = `<div class="deeppdf-loading-dots"><span></span><span></span><span></span></div>`;
			} else {
				// 使用 Markdown 渲染（先清理 <thought> 标签）
				if (this.app) {
					const { cleanedContent } = parseAgentContent(this.data.content);
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

		// 渲染操作按钮
		this.actionsRenderer.render(bubble);

		// 如果正在流式传输，添加光标效果 (由 CSS 处理 .deeppdf-message-streaming)
		// 图表占位气泡虽无文本流，但需要 thinking-bar（状态文字 + mascot 动画）可见，
		// 因此也加上 streaming 类，否则 CSS 会隐藏整个 thinking-bar
		if (this.data.isStreaming || this.data.isDiagramPlaceholder) {
		 container.addClass('deeppdf-message-streaming');
        } else {
            container.removeClass('deeppdf-message-streaming');
        }

		// 设置文字选中监听（仅对非流式消息 + 非图表占位气泡）
		if (!this.data.isStreaming && !this.data.isDiagramPlaceholder) {
			const contentEl = container.querySelector('.deeppdf-message-content') as HTMLElement;
				if (contentEl) this.selectionMgr.setupSelectionListener(contentEl);
		}

		return container;
	}

	update(data: Partial<MessageData>): void {
		const oldContent = this.data.content;
		const oldAgentToolCalls = this.data.agentToolCalls;
		const wasStreaming = this.data.isStreaming;
		const wasDiagramPlaceholder = this.data.isDiagramPlaceholder === true;

		Object.assign(this.data, data);

		const agentToolCallsChanged = data.agentToolCalls !== undefined && (
			data.agentToolCalls !== oldAgentToolCalls &&
			(data.agentToolCalls?.length !== oldAgentToolCalls?.length || data.agentToolCalls?.[0]?.name !== oldAgentToolCalls?.[0]?.name)
		);
		const streamingEnded = wasStreaming && data.isStreaming === false;
		// 图表占位气泡拿到 embed 时（isDiagramPlaceholder 从 true 变 false + 有 content），
		// 需要完整重渲染以移除 loading 动画并渲染 markdown
		const diagramPlaceholderEnded = wasDiagramPlaceholder && data.isDiagramPlaceholder === false;

		// 比较上次实际显示的状态（非 data 旧值），因 currentStatus 被持久化存储
		const newStatus = data.currentStatus !== undefined ? data.currentStatus : (this.data as any).currentStatus;
		if (this.el && this.statusEl) {
			if (newStatus) {
				this.statusEl.textContent = newStatus;
				this.statusEl.addClass('visible');
				this.lastDisplayedStatus = newStatus;
				// 根据状态文字切换 thinkingBar 内奚童表情
				this.updateThinkingMascotExpression(newStatus);
			} else if (!newStatus && this.lastDisplayedStatus) {
				this.statusEl.textContent = '';
				this.statusEl.removeClass('visible');
				this.lastDisplayedStatus = undefined;
			}
		}


		if (this.el && this.data.isStreaming && !streamingEnded) {
			// 重试场景：从非流式 -> 流式过渡时，全量重绘以恢复 streaming CSS 类、隐藏按钮等
			if (!wasStreaming) {
				const newRender = this.render();
				if (this.el) {
					this.el.replaceWith(newRender);
				}
				this.el = newRender;
				return;
			}
			if (data.content !== undefined && data.content !== oldContent) {
				this.updateContent(data.content);
			}
			if (agentToolCallsChanged && data.agentToolCalls) {
				this.updateToolCalls(data.agentToolCalls);
			}
			return;
		}

		// 仅内容变化、无其他状态转变 → 走轻量更新路径
		const shouldUpdateContentOnly =
			data.content !== undefined &&
			data.content !== oldContent &&
			!agentToolCallsChanged &&
			!streamingEnded &&
			!diagramPlaceholderEnded;
		if (this.el && shouldUpdateContentOnly && data.content !== undefined) {
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

	/**
	 * 根据状态文字切换 thinkingBar 内奚童表情（带 fade 过渡）
	 */
	private updateThinkingMascotExpression(statusText: string): void {
		if (!this.thinkingMascotSvgEl) return;
		const lower = statusText.toLowerCase();
		let expr: 'idle' | 'thinking' | 'happy' | 'curious' | 'reading' | 'sleeping' = 'thinking';

		if (lower.includes('阅读') || lower.includes('search') || lower.includes('read') || lower.includes('检视')) {
			expr = 'reading';
		} else if (lower.includes('回忆') || lower.includes('memory') || lower.includes('skill')) {
			expr = 'curious';
		} else if (lower.includes('整理') || lower.includes('写作') || lower.includes('generat') || lower.includes('writing') || lower.includes('总结')) {
			expr = 'happy';
		} else if (lower.includes('思考') || lower.includes('think') || lower.includes('reason')) {
			expr = 'thinking';
		}

		const el = this.thinkingMascotSvgEl;
		// 相同表情不切换
		if (el.dataset.currentExpr === expr) return;
		el.dataset.currentExpr = expr;

		// fade-out → 换脸 → fade-in
		el.classList.add('deeppdf-mascot-face-fade-out');
		setTimeout(() => {
			el.innerHTML = faceSVG(expr);
			el.classList.remove('deeppdf-mascot-face-fade-out');
			el.classList.add('deeppdf-mascot-face-fade-in');
			setTimeout(() => el.classList.remove('deeppdf-mascot-face-fade-in'), 200);
		}, 150);
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
			// 流式结束接管渲染前，先取消 streamingUpdate 可能尚未执行的 RAF 回调。
			// 该回调会用 innerHTML 覆盖 contentEl，导致此处刚绑定的 hover preview 丢失（根因）。
			this.streamingRenderer.cancelPendingFrame();
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
			this.selectionMgr.setupSelectionListener(contentEl as HTMLElement);
		}

		if (bubble) {
			this.actionsRenderer.render(bubble as HTMLElement);
		}
	}

	protected updateContent(content: string): void {
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
			this.streamingRenderer.streamingUpdate(contentEl as HTMLElement, content);
		} else {
			this.streamingRenderer.fullUpdate(contentEl as HTMLElement, content);
		}
	}

	/**
	 * 增量更新工具调用（流式期间避免全量重绘）
	 */
	protected updateToolCalls(toolCalls: AgentToolCall[]): void {
		this.streamingRenderer.updateToolCalls(toolCalls);
	}




	/** 请求重新渲染 */
	private requestRerender(): void {
		if (this.el) {
			const newRender = this.render();
			this.el.replaceWith(newRender);
			this.el = newRender;
		}
	}

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


	public destroy(): void {
		this.streamingRenderer.destroy();
		this.observers.forEach(observer => observer.disconnect());
		this.observers = [];
		this.selectionMgr.destroy();
		this.ttsReadingCtrl.destroy();
		this.actionsRenderer.destroy();
		this.fullscreenCtrl?.destroy();
	}

	setTTSState(state: 'idle' | 'summarizing' | 'tts_loading' | 'playing' | 'paused'): void {
		this.ttsReadingCtrl.setState(state);
	}

	highlightTTSProgress(progress: number): void {
		this.ttsReadingCtrl.highlightProgress(progress);
	}

	highlightParagraphIndex(index: number): void {
		// TTSReadingController doesn't have this method yet, no-op for now
	}

	private _openFullscreen(): void {
		if (!this.fullscreenCtrl) {
			const self = this;
			this.fullscreenCtrl = new FullscreenController({
				get el() { return self.el; },
				get data() { return self.data; },
				get app() { return self.app; },
			}, self.observers, self.getAllMessages, self.getCurrentBookInfo);
		}
		this.fullscreenCtrl.openFullscreen();
	}

	private _scrollToMessageTop(): void {
		if (!this.el) return;
		const messagesContainer = this.el.closest('.deeppdf-messages-container');
		if (messagesContainer) {
			const containerRect = messagesContainer.getBoundingClientRect();
			const messageRect = this.el.getBoundingClientRect();
			const offset = messageRect.top - containerRect.top + messagesContainer.scrollTop;
			messagesContainer.scrollTo({ top: offset - 10, behavior: 'smooth' });
		}
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
		onStreamingEnd?: (messageId: string, content: string) => void;
		getCurrentBookInfo?: () => { coverUrl: string | null; author: string | null; bookName: string | null };
		app?: App;
	}
): Message {
	if (data.role === 'user') {
		return new UserMessage(data, options?.app);
	} else {
		return new AIMessage(data, options);
	}
}
