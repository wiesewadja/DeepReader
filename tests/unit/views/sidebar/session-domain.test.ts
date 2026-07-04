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

	it("treats successive onContent calls as full-content snapshots, not increments (formatter全量语义)", async () => {
		// main 上 stream-processor 的 onContent 发的是 formatter 的全量 formattedOutput（覆盖式）。
		// session-domain 不能按增量累积，否则每次全量都会被累加 → 内容指数级重复。
		plugin.getFrontendAgent = vi.fn(async () => ({
			chat: vi.fn(async () => {}),
			continueChat: vi.fn(async (_history: any, _msg: any, _ctx: any, callbacks: any) => {
				callbacks.onContent("收到");
				callbacks.onContent("收到，连接正常。");
				callbacks.onContent("收到，连接正常。你之前在读《AI极简经济学》。");
				callbacks.onComplete();
			}),
			getSystemPromptAsync: vi.fn(async () => "system prompt"),
			getLLMClient: vi.fn(() => ({})),
		}));

		const domain = createDomain();
		const chunkHandler = vi.fn();
		const completedHandler = vi.fn();
		eventBus.on("chat:assistant-text-chunk", chunkHandler);
		eventBus.on("chat:assistant-message-completed", completedHandler);

		await domain.sendUserMessage("测试");

		// 最后一次 chunk 应为最后一次的全量，而非三次累积
		const lastChunk = chunkHandler.mock.calls.at(-1)?.[0];
		expect(lastChunk.content).toBe("收到，连接正常。你之前在读《AI极简经济学》。");
		expect(completedHandler).toHaveBeenCalledWith(
			expect.objectContaining({ content: "收到，连接正常。你之前在读《AI极简经济学》。" }),
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

	it("生成的 messageId 等于 agentChatHistory 条目的 timestamp（保证 regenerate/delete 可定位）", async () => {
		// 防回归：messageId 若改回 `assistant-${Date.now()}` 等格式，会与 history 的
		// ISO timestamp 不一致，导致 handleRegenerate / handleDeleteMessagePair 静默失败。
		const domain = createDomain();
		const startedHandler = vi.fn();
		eventBus.on("chat:assistant-message-started", startedHandler);

		await domain.sendUserMessage("hello");

		const aiMessageId = startedHandler.mock.calls[0]?.[0]?.messageId;
		expect(aiMessageId).toBeTruthy();
		expect(
			domain.agentChatHistory.some((m) => m.timestamp === aiMessageId),
		).toBe(true);
	});

	it("handleRegenerate truncates history to the preceding user message and restarts the assistant stream", async () => {
		const domain = createDomain();
		domain.agentChatHistory = [
			{ role: "user", content: "question 1", timestamp: "ts-user-1" },
			{ role: "assistant", content: "answer 1", timestamp: "ts-assistant-1" },
			{ role: "user", content: "question 2", timestamp: "ts-user-2" },
			{ role: "assistant", content: "answer 2", timestamp: "ts-assistant-2" },
		];

		const streamSpy = vi.spyOn(domain as any, "streamAssistantResponse");

		domain.handleRegenerate("ts-assistant-2");

		expect(domain.agentChatHistory).toHaveLength(3);
		expect(domain.agentChatHistory[2]).toEqual(
			expect.objectContaining({ role: "user", content: "question 2" }),
		);
		expect(streamSpy).toHaveBeenCalledWith("question 2");
	});

	it("handleRegenerate 只移除 AI 气泡，不移除用户提问（即使 timestamp 相同）", async () => {
		// 防回归：历史恢复后 user/assistant 可能共享 timestamp 前缀，
		// registry 按 timestamp 查找会误把 user 的 UI id 当成 assistant 的，导致用户气泡被删。
		const domain = createDomain();
		const userMsg = { role: "user", content: "question", timestamp: "same-ts" } as const;
		const assistantMsg = { role: "assistant", content: "answer", timestamp: "same-ts" } as const;
		domain.agentChatHistory = [userMsg, assistantMsg];

		// 模拟历史恢复后的 registry：两个消息 timestamp 相同，UI id 不同
		const userId = "same-ts-0";
		const assistantId = "same-ts-1";
		(domain as any).messageRegistry.set(userId, userMsg);
		(domain as any).messageRegistry.set(assistantId, assistantMsg);

		const removedIds = await domain.handleRegenerate(assistantId);

		expect(removedIds).toContain(assistantId);
		expect(removedIds).not.toContain(userId);
		expect(domain.agentChatHistory).toEqual([userMsg]);
	});

	it("diagram-start 立即显示占位气泡，complete 解锁输入，ready 后替换占位", async () => {
		// 防回归：占位气泡必须在 diagram-start 时立即创建（而非延迟到 finalize），
		// 否则用户在文字完成到图就绪之间看不到"让我画张图给你看..."提示，
		// 且输入框被锁到图完成。
		plugin.getFrontendAgent = vi.fn(async () => ({
			chat: vi.fn(async () => {}),
			continueChat: vi.fn(async (_h: any, _m: any, _c: any, callbacks: any) => {
				callbacks.onContent("我画张图给你看");
				callbacks.onDiagramStart();
				callbacks.onComplete();
				// 图在 complete 之后异步就绪（visualizer 后台生成）
				callbacks.onDiagramReady("![[diagram.excalidraw.md]]");
			}),
			getSystemPromptAsync: vi.fn(async () => "system prompt"),
			getLLMClient: vi.fn(() => ({})),
		}));

		const domain = createDomain();
		const startedHandler = vi.fn();
		const diagramReadyHandler = vi.fn();
		const stoppedHandler = vi.fn();
		const completedHandler = vi.fn();
		eventBus.on("chat:assistant-message-started", startedHandler);
		eventBus.on("chat:diagram-ready", diagramReadyHandler);
		eventBus.on("chat:stream-stopped", stoppedHandler);
		eventBus.on("chat:assistant-message-completed", completedHandler);

		await domain.sendUserMessage("画张图");

		// diagram-start 时立即创建了占位气泡
		const placeholderCall = startedHandler.mock.calls
			.map((c) => c[0])
			.find((e: any) => e?.isDiagramPlaceholder);
		expect(placeholderCall).toBeTruthy();
		expect(placeholderCall.status).toBe("让我画张图给你看...");

		// complete 阶段已定稿文字气泡并解锁输入（不等图）
		expect(completedHandler).toHaveBeenCalled();
		expect(stoppedHandler).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "completed" }),
		);

		// 图就绪后用占位 messageId 替换占位（不能重新生成 id，否则找不到目标）
		expect(diagramReadyHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				messageId: placeholderCall.messageId,
				embed: "![[diagram.excalidraw.md]]",
			}),
		);
	});

	it("图表 embed 持久化到 agentChatHistory，且不会进入 LLM history", async () => {
		// 防回归：图片消息重启后必须从 session store 恢复并渲染。
		plugin.getFrontendAgent = vi.fn(async () => ({
			chat: vi.fn(async () => {}),
			continueChat: vi.fn(async (_h: any, _m: any, _c: any, callbacks: any) => {
				callbacks.onContent("我画张图给你看");
				callbacks.onDiagramStart();
				callbacks.onComplete();
				callbacks.onDiagramReady("![[diagram.excalidraw.md]]");
			}),
			getSystemPromptAsync: vi.fn(async () => "system prompt"),
			getLLMClient: vi.fn(() => ({})),
		}));

		const domain = createDomain();
		await domain.sendUserMessage("画张图");

		const diagramMsg = domain.agentChatHistory.find(
			(m) => m.embed === "![[diagram.excalidraw.md]]",
		);
		expect(diagramMsg).toBeTruthy();
		expect(diagramMsg?.content).toBe("![[diagram.excalidraw.md]]");
		expect(diagramMsg?.role).toBe("assistant");

		// embed 消息不应进入 LLM 上下文
		(domain as any).abortController = new AbortController();
		const request = await (domain as any).buildAgentRequest("继续聊");
		expect(request.history.some((m: any) => m.embed)).toBe(false);
	});

	it("绘图后台期间允许继续对话，图就绪后渲染到占位（绘图与对话解耦）", async () => {
		// 防回归：绘图必须与主对话流解耦——用户在绘图期间能正常发消息继续对话，
		// 不能弹 Notice 拒绝；图在后台就绪后用占位 messageId 渲染到预留气泡。
		let firstChatCallbacks: any = null;
		let chatCallCount = 0;
		plugin.getFrontendAgent = vi.fn(async () => ({
			chat: vi.fn(async () => {}),
			continueChat: vi.fn(async (_h: any, _m: any, _c: any, callbacks: any) => {
				chatCallCount++;
				if (chatCallCount === 1) {
					firstChatCallbacks = callbacks;
					callbacks.onContent("第一张图来了");
					callbacks.onDiagramStart();
					callbacks.onComplete();
					// chat 返回，不等图（visualizer 后台生成，异步回调 onDiagramReady）
					return;
				}
				// 第二次对话：正常文字回复
				callbacks.onContent("好的继续聊");
				callbacks.onComplete();
			}),
			getSystemPromptAsync: vi.fn(async () => "system prompt"),
			getLLMClient: vi.fn(() => ({})),
		}));

		const domain = createDomain();
		const userAddedHandler = vi.fn();
		const startedHandler = vi.fn();
		const completedHandler = vi.fn();
		const diagramReadyHandler = vi.fn();
		eventBus.on("chat:user-message-added", userAddedHandler);
		eventBus.on("chat:assistant-message-started", startedHandler);
		eventBus.on("chat:assistant-message-completed", completedHandler);
		eventBus.on("chat:diagram-ready", diagramReadyHandler);

		// 第一次：触发绘图，文字完成后图在后台
		await domain.sendUserMessage("画图");

		const placeholderCall = startedHandler.mock.calls
			.map((c) => c[0])
			.find((e: any) => e?.isDiagramPlaceholder);
		expect(placeholderCall).toBeTruthy();

		// 绘图期间用户正常发第二条消息（不被拒绝，正常对话）
		await domain.sendUserMessage("继续聊");
		expect(userAddedHandler).toHaveBeenCalledTimes(2);
		expect(completedHandler).toHaveBeenCalledTimes(2);

		// 图就绪（后台异步触发回调）：渲染到第一次的占位气泡
		firstChatCallbacks.onDiagramReady("![[diagram.excalidraw.md]]");
		await vi.waitFor(() => expect(diagramReadyHandler).toHaveBeenCalled());
		expect(diagramReadyHandler).toHaveBeenCalledWith(
			expect.objectContaining({
				messageId: placeholderCall.messageId,
				embed: "![[diagram.excalidraw.md]]",
			}),
		);
	});

	it("error 事件后释放流程锁，允许继续对话", async () => {
		// 防回归：LLM 通过 onError 上报错误且未补发 complete 时，stream 必须正常结束
		// 并释放 _isProcessing，否则 AI 气泡的「重新生成」会因 handleRegenerate 早退而无响应。
		plugin.getFrontendAgent = vi.fn(async () => ({
			chat: vi.fn(async () => {}),
			continueChat: vi.fn(async (_h: any, _m: any, _c: any, callbacks: any) => {
				callbacks.onError("something went wrong");
				// 没有 onComplete：模拟错误后正常结束、未抛异常的场景
			}),
			getSystemPromptAsync: vi.fn(async () => "system prompt"),
			getLLMClient: vi.fn(() => ({})),
		}));

		const domain = createDomain();
		const errorHandler = vi.fn();
		const stoppedHandler = vi.fn();
		eventBus.on("chat:error", errorHandler);
		eventBus.on("chat:stream-stopped", stoppedHandler);

		await domain.sendUserMessage("hello");

		expect(errorHandler).toHaveBeenCalledWith(
			expect.objectContaining({ message: "something went wrong" }),
		);
		expect(stoppedHandler).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "error" }),
		);

		// 关键断言：流程锁已释放
		expect((domain as any)._isProcessing).toBe(false);

		// 可以发送下一条消息（sendUserMessage 内部检查 _isProcessing）
		await domain.sendUserMessage("continue");
		expect((domain as any)._isProcessing).toBe(false);
	});
});
