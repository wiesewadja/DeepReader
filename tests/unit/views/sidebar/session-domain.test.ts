import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionDomain } from "@/views/sidebar/domains/session-domain";
import { EventBus } from "@/views/sidebar/event-bus";
import type { SidebarEventMap } from "@/views/sidebar/events";

function createMockSessionManager(overrides: Record<string, any> = {}) {
	return {
		sessionId: "session-1",
		sessionStore: null,
		crossBookMode: false,
		generalChatMode: false,
		useLLMTreeSearch: false,
		startNewSession: vi.fn(async () => {}),
		restoreFromSessionStore: vi.fn(async () => true),
		ensureSessionStore: vi.fn(async () => {}),
		saveToCache: vi.fn(async () => {}),
		maybeConsolidateMemory: vi.fn(async () => {}),
		restoreCrossBookMode: vi.fn(async () => {}),
		restoreGeneralChatSession: vi.fn(async () => {}),
		...overrides,
	};
}

function createMockAgentChatController(overrides: Record<string, any> = {}) {
	return {
		processing: false,
		aiStreaming: false,
		agentChatHistory: [],
		currentMarkdownFiles: {},
		currentStreamController: null,
		sendMessage: vi.fn(async () => {}),
		cancelActiveStream: vi.fn(() => {}),
		stopGeneration: vi.fn(() => {}),
		handleRegenerate: vi.fn(() => {}),
		handleCopy: vi.fn(() => {}),
		handleQuestionClick: vi.fn(() => {}),
		handleGenerateOutline: vi.fn(() => {}),
		handleGuidanceClick: vi.fn(() => {}),
		handleExcerpt: vi.fn(() => {}),
		handleDeleteMessagePair: vi.fn(() => {}),
		...overrides,
	};
}

describe("SessionDomain", () => {
	let eventBus: EventBus<SidebarEventMap>;
	let sessionManager: ReturnType<typeof createMockSessionManager>;
	let agentChatController: ReturnType<typeof createMockAgentChatController>;

	beforeEach(() => {
		eventBus = new EventBus<SidebarEventMap>();
		sessionManager = createMockSessionManager();
		agentChatController = createMockAgentChatController();
	});

	function createDomain(): SessionDomain {
		return new SessionDomain({
			sessionManager: sessionManager as any,
			agentChatController: agentChatController as any,
			eventBus,
		});
	}

	it("proxies state accessors", () => {
		const domain = createDomain();
		expect(domain.sessionId).toBe("session-1");
		expect(domain.crossBookMode).toBe(false);
		expect(domain.isProcessing).toBe(false);
	});

	it("emits chat:user-message-added when sending a user message", async () => {
		const domain = createDomain();
		const handler = vi.fn();
		eventBus.on("chat:user-message-added", handler);

		await domain.sendUserMessage("hello");

		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({ content: "hello", role: "user" }),
		);
		expect(agentChatController.sendMessage).toHaveBeenCalledWith("hello", undefined);
	});

	it("delegates cancelStream to AgentChatController and emits stream-stopped", () => {
		const domain = createDomain();
		const handler = vi.fn();
		eventBus.on("chat:stream-stopped", handler);

		domain.cancelStream();

		expect(agentChatController.cancelActiveStream).toHaveBeenCalled();
		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "cancelled" }),
		);
	});

	it("delegates session lifecycle to SessionManager", async () => {
		const domain = createDomain();
		await domain.startNewSession("book-1");
		await domain.restoreSession("session-2");
		await domain.saveToCache();

		expect(sessionManager.startNewSession).toHaveBeenCalledWith("book-1");
		expect(sessionManager.restoreFromSessionStore).toHaveBeenCalledWith("session-2");
		expect(sessionManager.saveToCache).toHaveBeenCalled();
	});

	it("delegates message operations to AgentChatController", () => {
		const domain = createDomain();
		domain.handleRegenerate("msg-1");
		domain.handleCopy("msg-1");
		domain.handleQuestionClick("question");
		domain.handleGenerateOutline();
		domain.handleDeleteMessagePair("msg-1");

		expect(agentChatController.handleRegenerate).toHaveBeenCalledWith("msg-1");
		expect(agentChatController.handleCopy).toHaveBeenCalledWith("msg-1");
		expect(agentChatController.handleQuestionClick).toHaveBeenCalledWith("question");
		expect(agentChatController.handleGenerateOutline).toHaveBeenCalled();
		expect(agentChatController.handleDeleteMessagePair).toHaveBeenCalledWith("msg-1");
	});

	it("emits chat:stream-stopped with reason 'error' and re-throws when sendMessage fails", async () => {
		const domain = createDomain();
		const handler = vi.fn();
		eventBus.on("chat:stream-stopped", handler);

		const testError = new Error("Send failed");
		agentChatController.sendMessage.mockRejectedValue(testError);

		await expect(domain.sendUserMessage("hello")).rejects.toThrow("Send failed");

		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "error" }),
		);
	});
});
