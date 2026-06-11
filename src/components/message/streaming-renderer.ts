import { type App, MarkdownRenderer, Component } from "obsidian";
import type { MessageData, AgentToolCall } from "./types.js";
import { parseAgentContent } from "./parse-agent-content.js";
import { setupInternalLinks } from "./internal-links.js";
import { sanitizeHumanizedHtml } from "./utils.js";

/**
 * 流式渲染器
 * 管理流式消息的增量渲染、Markdown 更新和工具调用显示
 */

export interface StreamingRendererHost {
	get el(): HTMLElement | null;
	get app(): App | undefined;
	get data(): MessageData;
	get observers(): MutationObserver[];
	escapeHtml(text: string): string;
}

export class StreamingRenderer {
	private host: StreamingRendererHost;

	// 节流渲染跟踪
	private lastRenderedContent: string = "";
	private lastRenderTime: number = 0;
	private lastRenderedLength: number = 0;
	private streamingAnimationFrame: number | null = null;
	/** ARIA live region 是否已在当前流式周期初始化（防止重复 setAttribute） */
	private streamingAriaInitialized: boolean = false;

	constructor(host: StreamingRendererHost, initialContent: string) {
		this.host = host;
		this.lastRenderedContent = initialContent;
		this.lastRenderedLength = initialContent.length;
		this.lastRenderTime = Date.now();
	}

	/** 增量更新工具调用（流式期间避免全量重绘） */
	updateToolCalls(toolCalls: AgentToolCall[]): void {
		if (!this.host.el) return;

		const toolCallsEl = this.host.el.querySelector(".deeppdf-agent-tool-calls");
		if (!toolCallsEl) {
			const thoughtsEl = this.host.el.querySelector(".deeppdf-agent-thoughts");
			if (thoughtsEl && thoughtsEl.parentElement) {
				thoughtsEl.parentElement.createEl("div", {
					cls: "deeppdf-agent-tool-calls",
				});
			}
			return;
		}

		toolCallsEl.empty();
		for (const call of toolCalls) {
			const callEl = toolCallsEl.createEl("div", {
				cls: "deeppdf-agent-tool-call",
			});
			callEl.createEl("div", {
				cls: "deeppdf-agent-tool-name",
				text: call.name,
			});
			callEl.createEl("div", {
				cls: "deeppdf-agent-tool-status",
				text: call.status,
			});
		}
	}

	/** 流式更新 - 实时渲染 Markdown，节流优化 */
	streamingUpdate(contentEl: HTMLElement, newContent: string): void {
		// 屏幕阅读器可访问性：首次进入流式时挂 ARIA live region + busy 状态
		// 之后重复调用不重复 setAttribute（幂等）
		if (!this.streamingAriaInitialized) {
			contentEl.setAttribute("aria-live", "polite");
			contentEl.setAttribute("aria-atomic", "false");
			contentEl.setAttribute("aria-busy", "true");
			this.streamingAriaInitialized = true;
		}

		if (this.streamingAnimationFrame !== null) {
			cancelAnimationFrame(this.streamingAnimationFrame);
		}

		this.streamingAnimationFrame = requestAnimationFrame(() => {
			const now = Date.now();
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

			const shouldRender =
				contentChanged &&
				(contentGrowth > 50 || timePassed > throttleThreshold);

			if (shouldRender && this.host.app) {
				if (contentEl.hasClass("deeppdf-message-loading")) {
					contentEl.removeClass("deeppdf-message-loading");
				}

				const isHumanizedUI = newContent.includes("deepreader-agent-humanized");

				if (isHumanizedUI) {
					contentEl.innerHTML = sanitizeHumanizedHtml(cleanedContent);
					this.lastRenderedContent = cleanedContent;
					this.lastRenderTime = Date.now();
					this.lastRenderedLength = contentLen;
				} else {
					const tempContainer = document.createElement("div");
					const sourcePath = this.host.data.pdfName || "";

					MarkdownRenderer.render(
						this.host.app,
						cleanedContent,
						tempContainer,
						sourcePath,
						new Component(),
					).then(() => {
						if (!this.host.el) return;

						contentEl.innerHTML = tempContainer.innerHTML;

						const links = contentEl.querySelectorAll("a");
						links.forEach((link) => {
							const href = link.getAttribute("href");
							if (href && (href.includes("#^page-") || href.startsWith("#"))) {
								(link as HTMLElement).style.pointerEvents = "none";
								(link as HTMLElement).style.cursor = "text";
								(link as HTMLElement).style.textDecoration = "none";
							}
						});

						this.lastRenderedContent = cleanedContent;
						this.lastRenderTime = Date.now();
						this.lastRenderedLength = contentLen;
					});
				}
			}

			this.streamingAnimationFrame = null;
		});
	}

	/** 完全更新内容（非流式，异步渲染 Markdown） */
	async fullUpdate(contentEl: HTMLElement, content: string): Promise<void> {
		// 屏幕阅读器可访问性：流式结束，告知辅助技术“忙”状态解除
		// aria-live / aria-atomic 保留以供后续重聚焦 / 重渲染时仍可感知
		contentEl.setAttribute("aria-busy", "false");

		this.host.observers.forEach((obs) => obs.disconnect());
		this.host.observers.length = 0;

		contentEl.empty();

		const { cleanedContent } = parseAgentContent(content);
		const isHumanizedUI = content.includes("deepreader-agent-humanized");

		if (isHumanizedUI) {
			contentEl.innerHTML = sanitizeHumanizedHtml(cleanedContent);
		} else if (this.host.app) {
			const sourcePath = this.host.data.pdfName || "";
			await MarkdownRenderer.render(
				this.host.app,
				cleanedContent,
				contentEl,
				sourcePath,
				new Component(),
			);
			setupInternalLinks(contentEl, this.host.app, false, this.host.observers);
		} else {
			contentEl.innerHTML = this.host.escapeHtml(cleanedContent);
		}
	}

	/** 取消待处理的动画帧 */
	cancelPendingFrame(): void {
		if (this.streamingAnimationFrame !== null) {
			cancelAnimationFrame(this.streamingAnimationFrame);
			this.streamingAnimationFrame = null;
		}
	}

	destroy(): void {
		this.cancelPendingFrame();
		// 重置 ARIA 初始化标志，允许同一 renderer 实例在 reuse 场景下重新设置 ARIA
		this.streamingAriaInitialized = false;
	}
}
