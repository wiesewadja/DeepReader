/**
 * ChatPresenter
 *
 * Maps domain events to imperative updates on MessageList, ChatInput, and
 * ReadingTopbar. It is the only layer that knows how to turn domain events
 * into UI changes.
 */

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
			this.eventBus.on("chat:user-message-added", () => {
				this.getChatInput()?.clear();
				this.getChatInput()?.setDisabled(true);
				this.getChatInput()?.setStreaming(true);
				this.getReadingTopbar()?.setMascotExpression("curious");
			}),
		);

		this.unsubscribe.push(
			this.eventBus.on("chat:stream-stopped", () => {
				this.getChatInput()?.setStreaming(false);
				this.getChatInput()?.setDisabled(false);
				this.getReadingTopbar()?.setMascotExpression("idle");
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
