import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatPresenter } from "@/views/sidebar/presenters/chat-presenter";
import { EventBus } from "@/views/sidebar/event-bus";
import type { SidebarEventMap } from "@/views/sidebar/events";

function createMockMessage(msgOverrides: Record<string, any> = {}) {
	return {
		updateTTSState: vi.fn(),
		highlightTTSProgress: vi.fn(),
		highlightParagraphIndex: vi.fn(),
		...msgOverrides,
	};
}

function createMockMessageList(messages: Record<string, ReturnType<typeof createMockMessage>> = {}) {
	return {
		updateTTSState: vi.fn(),
		getMessage: vi.fn((id: string) => messages[id] ?? null),
	};
}

function createMockReadingTopbar() {
	return {
		setReadingTTSState: vi.fn(),
		setMascotExpression: vi.fn(),
	};
}

function createMockChatInput() {
	return {
		clear: vi.fn(),
		setDisabled: vi.fn(),
		setStreaming: vi.fn(),
	};
}

describe("ChatPresenter TTS handling", () => {
	let eventBus: EventBus<SidebarEventMap>;
	let messageList: ReturnType<typeof createMockMessageList>;
	let readingTopbar: ReturnType<typeof createMockReadingTopbar>;

	beforeEach(() => {
		eventBus = new EventBus<SidebarEventMap>();
		messageList = createMockMessageList();
		readingTopbar = createMockReadingTopbar();
	});

	function createPresenter(messages: Record<string, ReturnType<typeof createMockMessage>> = {}): ChatPresenter {
		messageList = createMockMessageList(messages);
		const chatInput = createMockChatInput();
		return new ChatPresenter({
			eventBus,
			get messageList() {
				return messageList as any;
			},
			get chatInput() {
				return chatInput as any;
			},
			get readingTopbar() {
				return readingTopbar as any;
			},
		});
	}

	it("updates reading topbar on tts:state-changed for reading source", () => {
		createPresenter();
		eventBus.emit("tts:state-changed", { source: "reading", state: "playing" });
		expect(readingTopbar.setReadingTTSState).toHaveBeenCalledWith("playing");
	});

	it("maps tts_loading to loading for reading topbar", () => {
		createPresenter();
		eventBus.emit("tts:state-changed", { source: "reading", state: "tts_loading" });
		expect(readingTopbar.setReadingTTSState).toHaveBeenCalledWith("loading");
	});

	it("updates message list on tts:state-changed for message source", () => {
		createPresenter();
		eventBus.emit("tts:state-changed", { source: "message", messageId: "msg-1", state: "playing" });
		expect(messageList.updateTTSState).toHaveBeenCalledWith("msg-1", "playing");
	});

	it("clears paragraph highlight on message idle state", () => {
		const msg = createMockMessage();
		createPresenter({ "msg-1": msg });
		eventBus.emit("tts:state-changed", { source: "message", messageId: "msg-1", state: "idle" });
		expect(msg.highlightParagraphIndex).toHaveBeenCalledWith(-1);
	});

	it("updates message highlight progress on tts:progress-changed", () => {
		const msg = createMockMessage();
		createPresenter({ "msg-1": msg });
		eventBus.emit("tts:progress-changed", { source: "message", messageId: "msg-1", progress: 42 });
		expect(msg.highlightTTSProgress).toHaveBeenCalledWith(42);
	});

	it("updates message paragraph highlight on tts:paragraph-changed", () => {
		const msg = createMockMessage();
		createPresenter({ "msg-1": msg });
		eventBus.emit("tts:paragraph-changed", { source: "message", messageId: "msg-1", paragraphIndex: 3 });
		expect(msg.highlightParagraphIndex).toHaveBeenCalledWith(3);
	});

	it("disposes event subscriptions", () => {
		const presenter = createPresenter();
		presenter.dispose();
		// Create a second presenter to verify the first one's handlers were removed
		const presenter2 = createPresenter();
		readingTopbar.setReadingTTSState.mockClear();
		presenter2.dispose();
		eventBus.emit("tts:state-changed", { source: "reading", state: "playing" });
		expect(readingTopbar.setReadingTTSState).not.toHaveBeenCalled();
	});

	it("resets chat UI on chat:stream-stopped", () => {
		createPresenter();
		eventBus.emit("chat:stream-stopped", { messageId: "msg-1", reason: "cancelled" });
		expect(readingTopbar.setMascotExpression).toHaveBeenCalledWith("idle");
	});
});
