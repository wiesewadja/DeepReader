import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionDomain } from "@/views/sidebar/domains/session-domain";
import { EventBus } from "@/views/sidebar/event-bus";
import type { SidebarEventMap } from "@/views/sidebar/events";

// Mock SessionStore
vi.mock("@/agent/session/index", () => {
	return {
		SessionStore: vi.fn().mockImplementation(() => {
			return {
				create: vi.fn(async () => {}),
				get: vi.fn(async () => ({ messages: [], lastConsolidated: 0 })),
				appendMessage: vi.fn(async () => {}),
				getLLMHistory: vi.fn(async () => []),
				acquireLock: vi.fn(async () => {}),
				releaseLock: vi.fn(() => {}),
				updateLastConsolidated: vi.fn(async () => {}),
			};
		}),
	};
});

describe("SessionDomain", () => {
	let eventBus: EventBus<SidebarEventMap>;
	let app: any;
	let plugin: any;
	let chatDocumentService: any;
	let bookDomain: any;
	let ttsDomain: any;

	beforeEach(() => {
		eventBus = new EventBus<SidebarEventMap>();
		app = {
			workspace: { getActiveFile: vi.fn(() => null) },
			metadataCache: { getFileCache: vi.fn(() => null), getFirstLinkpathDest: vi.fn(() => null) },
			vault: { adapter: { getBasePath: vi.fn(() => "") } },
		};
		plugin = {
			manifest: { id: "deepreader-dev" },
			settings: { savedSessions: {}, autoTTS: false },
			getFrontendAgent: vi.fn(async () => ({
				chat: vi.fn(async (msg, ctx, callbacks) => {
					callbacks.onContent("Hello from agent");
					callbacks.onComplete();
				}),
				continueChat: vi.fn(async (history, msg, ctx, callbacks) => {
					callbacks.onContent("Hello from agent continued");
					callbacks.onComplete();
				}),
				getSystemPromptAsync: vi.fn(async () => "system prompt"),
				getLLMClient: vi.fn(() => ({})),
			})),
		};
		chatDocumentService = {
			getLoadedDocumentsArray: vi.fn(() => []),
			loadByPath: vi.fn(async () => null),
		};
		bookDomain = {
			currentIndexId: "book-1",
			currentPdfName: "test.pdf",
			currentBookCoverUrl: "cover.png",
			currentBookAuthor: "author",
			currentDocDescription: "desc",
			currentBooklistBookIds: [],
			indexes: [],
			getBookshelfSummary: vi.fn(() => "bookshelf summary"),
		};
		ttsDomain = {
			speak: vi.fn(),
		};
	});

	function createDomain(): SessionDomain {
		return new SessionDomain({
			app,
			plugin,
			eventBus,
			chatDocumentService,
			bookDomain,
			ttsDomain,
		});
	}

	it("manages properties and mode switch variables", () => {
		const domain = createDomain();
		expect(domain.crossBookMode).toBe(false);
		domain.crossBookMode = true;
		expect(domain.crossBookMode).toBe(true);

		expect(domain.generalChatMode).toBe(false);
		domain.generalChatMode = true;
		expect(domain.generalChatMode).toBe(true);

		expect(domain.useLLMTreeSearch).toBe(false);
		domain.useLLMTreeSearch = true;
		expect(domain.useLLMTreeSearch).toBe(true);
	});

	it("streams user and assistant messages emitting appropriate events", async () => {
		const domain = createDomain();
		const userAddedHandler = vi.fn();
		const assistantStartedHandler = vi.fn();
		const chunkHandler = vi.fn();
		const completedHandler = vi.fn();
		const stoppedHandler = vi.fn();

		eventBus.on("chat:user-message-added", userAddedHandler);
		eventBus.on("chat:assistant-message-started", assistantStartedHandler);
		eventBus.on("chat:assistant-text-chunk", chunkHandler);
		eventBus.on("chat:assistant-message-completed", completedHandler);
		eventBus.on("chat:stream-stopped", stoppedHandler);

		await domain.sendUserMessage("hello");

		expect(userAddedHandler).toHaveBeenCalledWith(
			expect.objectContaining({ content: "hello", role: "user" }),
		);
		expect(assistantStartedHandler).toHaveBeenCalled();
		expect(chunkHandler).toHaveBeenCalledWith(
			expect.objectContaining({ content: "Hello from agent continued" }),
		);
		expect(completedHandler).toHaveBeenCalledWith(
			expect.objectContaining({ content: "Hello from agent continued" }),
		);
		expect(stoppedHandler).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "completed" }),
		);
	});

	it("stops active streaming on cancelStream and emits chat:stream-stopped", async () => {
		const domain = createDomain();
		const stoppedHandler = vi.fn();
		eventBus.on("chat:stream-stopped", stoppedHandler);

		domain.cancelStream();

		expect(stoppedHandler).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "cancelled" }),
		);
	});
});
