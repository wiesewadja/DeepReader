/**
 * ChatPresenter
 *
 * Maps domain events to imperative updates on MessageList, ChatInput, and
 * ReadingTopbar. It is the only layer that knows how to turn domain events
 * into UI changes.
 */

import { Notice } from "obsidian";
import type { ChatInput } from "../../../components/chat-input/chat-input.js";
import type { MessageList } from "../../../components/message-list/message-list.js";
import type { ReadingTopbar } from "../../../components/reading-topbar/index.js";
import { EventBus } from "../event-bus.js";
import type { SidebarEventMap, TTSPlayState } from "../events.js";

export interface ChatPresenterOptions {
	eventBus: EventBus<SidebarEventMap>;
	get messageList(): MessageList | null;
	get chatInput(): ChatInput | null;
	get readingTopbar(): ReadingTopbar | null;
}

export class ChatPresenter {
	private eventBus: EventBus<SidebarEventMap>;
	private getMessageList: () => MessageList | null;
	private getChatInput: () => ChatInput | null;
	private getReadingTopbar: () => ReadingTopbar | null;
	private unsubscribe: (() => void)[] = [];

	constructor(options: ChatPresenterOptions) {
		this.eventBus = options.eventBus;
		this.getMessageList = () => options.messageList;
		this.getChatInput = () => options.chatInput;
		this.getReadingTopbar = () => options.readingTopbar;
		this.subscribe();
	}

	private subscribe(): void {
		this.unsubscribe.push(
			this.eventBus.on("tts:state-changed", (event) => {
				this.handleTTSStateChanged(event.source, event.state, event.messageId);
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("tts:progress-changed", (event) => {
				const messageList = this.getMessageList();
				const msg = messageList?.getMessage(event.messageId);
				if (msg?.highlightTTSProgress) {
					msg.highlightTTSProgress(event.progress);
				}
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("tts:paragraph-changed", (event) => {
				if (event.source === "message" && event.messageId) {
					const messageList = this.getMessageList();
					const msg = messageList?.getMessage(event.messageId);
					if (msg?.highlightParagraphIndex) {
						msg.highlightParagraphIndex(event.paragraphIndex);
					}
				}
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("chat:user-message-added", (event) => {
				const messageList = this.getMessageList();
				messageList?.addMessage({
					id: event.messageId,
					role: "user",
					content: event.content,
					timestamp: new Date().toISOString(),
				});
				this.getChatInput()?.clear();
				this.getChatInput()?.setDisabled(true);
				this.getChatInput()?.setStreaming(true);
				this.getReadingTopbar()?.setMascotExpression("curious");
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("chat:assistant-message-started", (event) => {
				const messageList = this.getMessageList();
				messageList?.addMessage({
					id: event.messageId,
					role: "assistant",
					content: "",
					timestamp: new Date().toISOString(),
					isStreaming: true,
					isAgentMessage: true,
					isDiagramPlaceholder: event.isDiagramPlaceholder || false,
					currentStatus: event.status,
				});
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("chat:assistant-text-chunk", (event) => {
				const messageList = this.getMessageList();
				messageList?.updateMessage(event.messageId, {
					content: event.content,
					isStreaming: true,
				});
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("chat:assistant-status-changed", (event) => {
				const messageList = this.getMessageList();
				messageList?.updateMessage(event.messageId, {
					currentStatus: event.status,
					isStreaming: true,
				});
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("chat:assistant-message-completed", (event) => {
				const messageList = this.getMessageList();
				messageList?.updateMessage(event.messageId, {
					content: event.content,
					isStreaming: false,
					currentStatus: undefined,
					timestamp: new Date().toISOString(),
				});
				this.getReadingTopbar()?.setMascotExpression("happy");
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("chat:diagram-ready", (event) => {
				const messageList = this.getMessageList();
				messageList?.updateMessage(event.messageId, {
					content: event.embed,
					isDiagramPlaceholder: false,
					currentStatus: undefined,
					timestamp: new Date().toISOString(),
				});
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("chat:diagram-failed", (event) => {
				const messageList = this.getMessageList();
				messageList?.updateMessage(event.messageId, {
					content: `*图表生成失败：${event.reason}*`,
					isDiagramPlaceholder: false,
					currentStatus: undefined,
					timestamp: new Date().toISOString(),
				});
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("chat:error", (event) => {
				const messageList = this.getMessageList();
				messageList?.updateMessage(event.messageId, {
					content: `*错误：${event.message}*`,
					isStreaming: false,
					currentStatus: undefined,
					timestamp: new Date().toISOString(),
				});
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("chat:history-restored", (event) => {
				const messageList = this.getMessageList();
				messageList?.clear();
				for (const msg of event.messages) {
					messageList?.addMessage({
						id: msg.id,
						role: msg.role,
						content: msg.content,
						timestamp: msg.timestamp || new Date().toISOString(),
						isAgentMessage: msg.isAgentMessage,
					});
				}
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("chat:documents-loaded", (event) => {
				if (event.names.length > 0) {
					new Notice(`已自动关联文档: ${event.names.join(", ")}`);
				}
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("chat:stream-stopped", () => {
				this.getChatInput()?.setStreaming(false);
				this.getChatInput()?.setDisabled(false);
				this.getReadingTopbar()?.setMascotExpression("idle");
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("book:changed", (event) => {
				const messageList = this.getMessageList();
				const readingTopbar = this.getReadingTopbar();

				if (event.currentBooklist) {
					readingTopbar?.setCurrentBooklist(event.currentBooklist);
					if (event.booklistCovers) {
						readingTopbar?.updateBooklistCovers(event.booklistCovers);
					}
					messageList?.setCurrentPdfName(event.currentBooklist.name);
				} else if (event.pdfName) {
					readingTopbar?.setCurrentBook(event.pdfName, event.bookAuthor ?? undefined);
					if (event.bookCoverUrl) {
						readingTopbar?.setBookCover(event.bookCoverUrl);
					} else {
						readingTopbar?.setBookCover(null);
					}
					messageList?.setCurrentPdfName(event.pdfName);
				} else {
					readingTopbar?.setCurrentBook(null);
					readingTopbar?.setBookCover(null);
					readingTopbar?.clearBooklistMode();
				}

				if (event.clearChat) {
					messageList?.clear();
				}
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("book:index-deleted", (event) => {
				new Notice(`索引已删除: ${event.pdfName}`);
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("book:index-delete-failed", (event) => {
				new Notice(`删除失败: ${event.pdfName} (${event.error})`);
			}),
		);
	}

	private handleTTSStateChanged(
		source: "message" | "reading",
		state: TTSPlayState,
		messageId?: string,
	): void {
		if (source === "reading") {
			const readingState = this.toReadingTTSState(state);
			this.getReadingTopbar()?.setReadingTTSState(readingState);
			return;
		}

		if (messageId) {
			const messageList = this.getMessageList();
			messageList?.updateTTSState(messageId, state);

			if (state === "idle") {
				const msg = messageList?.getMessage(messageId);
				if (msg?.highlightParagraphIndex) {
					msg.highlightParagraphIndex(-1);
				} else if (msg?.highlightTTSProgress) {
					msg.highlightTTSProgress(-1);
				}
			}
		}
	}

	private toReadingTTSState(state: TTSPlayState): import("../../../components/reading-topbar/reading-topbar.js").ReadingTTSState {
		switch (state) {
			case "idle":
				return "idle";
			case "playing":
				return "playing";
			case "tts_loading":
			case "summarizing":
				return "loading";
			case "paused":
				return "idle";
			default:
				return "idle";
		}
	}

	dispose(): void {
		for (const fn of this.unsubscribe) {
			fn();
		}
		this.unsubscribe = [];
	}
}
