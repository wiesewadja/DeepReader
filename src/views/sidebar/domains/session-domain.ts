/**
 * SessionDomain
 *
 * Owns chat session lifecycle and orchestration. Emits semantic chat lifecycle events.
 */

import { App } from "obsidian";
import type { ChatMessage } from "../../../agent/types.js";
import { SessionStore } from "../../../agent/session/index.js";
import { EventBus } from "../event-bus.js";
import type { SidebarEventMap } from "../events.js";
import { AgentDomain, type QuoteItem } from "./agent-domain.js";
import type { ChatDocumentService } from "../services/chat-document-service.js";
import type { BookDomain } from "./book-domain.js";
import type { TTSDomain } from "./tts-domain.js";
import type { DeepReaderPluginInterface } from "../../../agent/tools/context/vault.js";
import type { ToolContext } from "../../../agent/tools/types.js";
import { validateWikiLinks } from "../../../agent/utils/wiki-link-hook.js";
import { uiLog as log, warn, error as logError } from "../../../utils/logger.js";

// Memory & Mode constants/stores
import { GENERAL_MODE_INDEX_ID } from "../../../agent/config/agent-constants.js";
import { MemoryConsolidator } from "../../../agent/memory/consolidator.js";
import { MemoryStore } from "../../../agent/memory/store.js";
import { DEFAULT_CONSOLIDATOR_CONFIG } from "../../../agent/memory/types.js";

const STATUS_THINKING_PREFIX = "💭";
const STATUS_READING = "📖 正在翻阅...";
const STATUS_CROSS_BOOK = "🔍 正在跨书籍查阅...";
const STATUS_DIAGRAM = "让我画张图给你看...";

const WELCOME_MESSAGE = "你好！我是奚童，你的 AI 伴读。";
const WELCOME_MESSAGE_GENERAL =
	"你好！我是奚童，你的 AI 伴读。\n\n虽然还没有选中书籍，但我们可以聊聊阅读相关的话题——推荐书单、讨论读书方法、或者整理你的读书笔记。";

export type GuidanceType =
	| "overview"
	| "core-views"
	| "mindmap"
	| "key-concepts"
	| "reading-guide"
	| "relevance"
	| "recommend"
	| "organize"
	| "summary"
	| "method";

export interface SessionDomainOptions {
	app: App;
	plugin: DeepReaderPluginInterface;
	eventBus: EventBus<SidebarEventMap>;
	chatDocumentService: ChatDocumentService;
	bookDomain: BookDomain;
	ttsDomain: TTSDomain;
}

export class SessionDomain {
	private app: App;
	private plugin: DeepReaderPluginInterface;
	private eventBus: EventBus<SidebarEventMap>;
	private chatDocumentService: ChatDocumentService;
	private bookDomain: BookDomain;
	private ttsDomain: TTSDomain;
	private agentDomain: AgentDomain;

	private _sessionId: string | null = null;
	private _sessionStore: SessionStore | null = null;
	private _crossBookMode = false;
	private _generalChatMode = false;
	private _useLLMTreeSearch = false;

	private _agentChatHistory: ChatMessage[] = [];
	private _currentMarkdownFiles: Record<string, string> = {};
	private _isProcessing = false;
	private _isAiStreaming = false;
	private abortController: AbortController | null = null;

	// Diagram generation state
	private activeDiagramMessageId: string | null = null;
	// display messageId ↔ _agentChatHistory 条目引用映射（仅历史恢复消息）。
	// 历史消息 id 形如 `${timestamp}-${index}`，同秒消息共享 timestamp 前缀，
	// 用引用精确定位避免 regenerate/delete 命中同秒的其他条目。
	private messageRegistry = new Map<string, ChatMessage>();
	private diagramPending = false;
	private diagramEmbedReady: string | null = null;
	private diagramFailReason: string | null = null;
	private diagramCompleted = false;

	constructor(options: SessionDomainOptions) {
		this.app = options.app;
		this.plugin = options.plugin;
		this.eventBus = options.eventBus;
		this.chatDocumentService = options.chatDocumentService;
		this.bookDomain = options.bookDomain;
		this.ttsDomain = options.ttsDomain;
		this.agentDomain = new AgentDomain({ plugin: options.plugin });
	}

	// ── State accessors ──

	get sessionId(): string | null {
		return this._sessionId;
	}

	set sessionId(id: string | null) {
		this._sessionId = id;
	}

	get sessionStore(): SessionStore | null {
		return this._sessionStore;
	}

	get crossBookMode(): boolean {
		return this._crossBookMode;
	}

	set crossBookMode(v: boolean) {
		this._crossBookMode = v;
	}

	get generalChatMode(): boolean {
		return this._generalChatMode;
	}

	set generalChatMode(v: boolean) {
		this._generalChatMode = v;
	}

	get useLLMTreeSearch(): boolean {
		return this._useLLMTreeSearch;
	}

	set useLLMTreeSearch(v: boolean) {
		this._useLLMTreeSearch = v;
	}

	get agentChatHistory(): ChatMessage[] {
		return this._agentChatHistory;
	}

	set agentChatHistory(history: ChatMessage[]) {
		this._agentChatHistory = history;
	}

	get currentMarkdownFiles(): Record<string, string> {
		return this._currentMarkdownFiles;
	}

	set currentMarkdownFiles(files: Record<string, string>) {
		this._currentMarkdownFiles = files;
	}

	get isProcessing(): boolean {
		return this._isProcessing;
	}

	get isAiStreaming(): boolean {
		return this._isAiStreaming;
	}

	get currentStreamController(): AbortController | null {
		return this.abortController;
	}

	// ── Stream control ──

	cancelStream(): void {
		if (this.abortController) {
			try {
				this.abortController.abort();
				log("[SessionDomain] Silent cancel stream requested");
			} catch (e) {
				warn("[SessionDomain] Error cancelling stream:", e);
			}
			this.abortController = null;
		}
		this._isProcessing = false;
		this._isAiStreaming = false;
		this.emitStreamStopped("cancelled");
	}

	stopGeneration(): void {
		if (!this._isAiStreaming || !this.abortController) {
			return;
		}

		log("[SessionDomain] User stopped AI generation");
		this.abortController.abort();
		this.abortController = null;
		this._isProcessing = false;
		this._isAiStreaming = false;

		if (this.activeDiagramMessageId) {
			const placeholderId = this.activeDiagramMessageId;
			this.activeDiagramMessageId = null;
			this.eventBus.emit("chat:diagram-failed", {
				messageId: placeholderId,
				reason: "已取消图表生成",
			});
		}
		this.diagramPending = false;
		this.diagramEmbedReady = null;
		this.diagramFailReason = null;
		this.diagramCompleted = false;

		this.emitStreamStopped("cancelled");
		this.saveToCache();
	}

	// ── Message sending ──

	async sendUserMessage(message: string, quotes?: QuoteItem[]): Promise<void> {
		if ((!message.trim() && (!quotes || quotes.length === 0)) || this._isProcessing) {
			return;
		}

		this._isProcessing = true;
		this._isAiStreaming = true;

		if (this.plugin.readingModeService) {
			this.plugin.readingModeService.notifyChatStarted();
		}

		await this.parseAndLoadReferences(message);

		// messageId 直接用 timestamp，保证 MessageList 消息 id 与 _agentChatHistory
		// 条目的 timestamp 一致，handleRegenerate / handleDeleteMessagePair 才能匹配。
		const userTimestamp = new Date().toISOString();
		const userMessageId = userTimestamp;
		const userMsgObj: ChatMessage = {
			role: "user",
			content: message,
			timestamp: userTimestamp,
		};
		this._agentChatHistory.push(userMsgObj);

		this.eventBus.emit("chat:user-message-added", {
			messageId: userMessageId,
			content: message,
			role: "user",
		});

		await this.streamAssistantResponse(message, quotes);
	}

	async sendUserMessageWithInput(message: string): Promise<void> {
		await this.sendUserMessage(message, undefined);
	}

	private async streamAssistantResponse(
		userMessage: string,
		quotes?: QuoteItem[],
	): Promise<void> {
		this._isProcessing = true;
		this._isAiStreaming = true;
		this.abortController = new AbortController();

		const aiTimestamp = new Date().toISOString();
		const aiMessageId = aiTimestamp;
		this.eventBus.emit("chat:assistant-message-started", {
			messageId: aiMessageId,
			status: this._crossBookMode ? STATUS_CROSS_BOOK : STATUS_READING,
		});

		this.resetDiagramState();

		let latestContent = "";
		let reasoningContent = "";
		let currentStatus = "";

		try {
			const request = this.buildAgentRequest(userMessage, quotes);

			for await (const event of this.agentDomain.stream(request)) {
				switch (event.type) {
					case "text": {
						// main 上 stream-processor 的 onContent 发送的是 formatter 的全量
						// formattedOutput（覆盖式赋值），text event 必须按全量处理，不能累积。
						latestContent = event.content;
						this.eventBus.emit("chat:assistant-text-chunk", {
							messageId: aiMessageId,
							content: latestContent,
							isIncremental: false,
						});
						break;
					}
					case "reasoning": {
						reasoningContent += event.content;
						const displayReasoning = reasoningContent.split("\n")[0].slice(0, 50);
						this.eventBus.emit("chat:assistant-status-changed", {
							messageId: aiMessageId,
							status: displayReasoning
								? `${STATUS_THINKING_PREFIX} ${displayReasoning}...`
								: "思考中...",
						});
						break;
					}
					case "progress": {
						currentStatus = event.status;
						this.eventBus.emit("chat:assistant-status-changed", {
							messageId: aiMessageId,
							status: event.status,
						});
						break;
					}
					case "diagram-start": {
						this.diagramPending = true;
						break;
					}
					case "diagram-ready": {
						await this.handleDiagramReady(event.embed);
						break;
					}
					case "diagram-failed": {
						await this.handleDiagramFailed(event.reason);
						break;
					}
					case "error": {
						this.eventBus.emit("chat:error", {
							messageId: aiMessageId,
							message: event.message,
						});
						break;
					}
				}
			}

			const correctedContent = await this.correctWikiLinks(latestContent);

			this.finalizeAssistantMessage(aiMessageId, correctedContent);

			await this.saveToCache();
			await this.maybeConsolidateMemory();

			if (this.plugin.settings.autoTTS) {
				this.ttsDomain.speak(aiMessageId, correctedContent);
			}
		} catch (error) {
			logError("[SessionDomain] Failed during stream processing:", error);
			this.abortController = null;
			this._isProcessing = false;
			this._isAiStreaming = false;
			this.emitStreamStopped("error");
			throw error;
		}
	}

	// ── Session lifecycle ──

	async ensureSessionStore(): Promise<void> {
		if (!this._sessionStore) {
			this._sessionStore = new SessionStore(this.app, undefined, this.plugin.manifest.id);
			log("[SessionDomain] SessionStore initialized");
		}
	}

	async startNewSession(indexId: string): Promise<void> {
		this.cancelStream();

		this._sessionId = "chat-" + Date.now();
		this._agentChatHistory = [];

		await this.ensureSessionStore();
		const effectiveIndexId = this._crossBookMode ? "__cross_book__" : indexId;
		await this._sessionStore!.create(this._sessionId, effectiveIndexId, this._crossBookMode);

		if (!this.plugin.settings.savedSessions) {
			this.plugin.settings.savedSessions = {};
		}
		const sessionKey = this._crossBookMode
			? indexId
			: this._generalChatMode
				? GENERAL_MODE_INDEX_ID
				: this.getNormalizedBookName();
		this.plugin.settings.savedSessions[sessionKey] = this._sessionId;
		if (indexId !== sessionKey) {
			this.plugin.settings.savedSessions[indexId] = this._sessionId;
		}
		await this.plugin.saveSettings();

		// Welcome message
		const welcomeId = `welcome-${Date.now()}`;
		const welcomeContent = this._generalChatMode ? WELCOME_MESSAGE_GENERAL : WELCOME_MESSAGE;
		const welcomeMsg: ChatMessage = {
			role: "assistant",
			content: welcomeContent,
			timestamp: new Date().toISOString(),
		};
		await this._sessionStore!.appendMessage(this._sessionId, welcomeMsg);

		// Publish restored history event containing just the welcome message
		this.eventBus.emit("chat:history-restored", {
			messages: [{
				id: welcomeId,
				role: "assistant",
				content: welcomeContent,
				timestamp: welcomeMsg.timestamp,
				isAgentMessage: true,
			}],
		});
	}

	async restoreSession(sessionId: string): Promise<boolean> {
		await this.ensureSessionStore();
		const session = await this._sessionStore!.get(sessionId);

		if (!session || session.messages.length === 0) {
			return false;
		}

		this._sessionId = sessionId;

		const displayMessages = session.messages.filter((msg) => {
			if (msg.role === "user") return true;
			if (msg.role === "assistant") {
				return !msg.tool_calls || msg.tool_calls.length === 0;
			}
			return false;
		});

		const llmHistory = await this._sessionStore!.getLLMHistory(sessionId);
		const frontendAgent = await this.plugin.getFrontendAgent();
		const systemPrompt = await frontendAgent.getSystemPromptAsync();
		this._agentChatHistory = [
			{ role: "system", content: systemPrompt },
			...llmHistory,
		];

		// 建立 display id ↔ history 引用映射：history 重建后按 timestamp+content 对齐，
		// 使 handleRegenerate/handleDeleteMessagePair 能精确定位（不受同秒 timestamp 冲突影响）。
		this.messageRegistry.clear();
		let restoredIndex = 0;
		this.eventBus.emit("chat:history-restored", {
			messages: displayMessages.map((m) => {
				const id = m.timestamp
					? `${m.timestamp}-${restoredIndex++}`
					: `restored-${Date.now()}-${restoredIndex++}`;
				const ref = this._agentChatHistory.find(
					(h) => h.timestamp === m.timestamp && h.content === m.content,
				);
				if (ref) this.messageRegistry.set(id, ref);
				return {
					id,
					role: m.role as "user" | "assistant",
					content: m.content || "",
					timestamp: m.timestamp,
					isAgentMessage: m.role === "assistant",
				};
			}),
		});

		return true;
	}

	async saveToCache(): Promise<void> {
		if (!this._sessionId) return;
		await this.ensureSessionStore();

		const effectiveIndexId = this._crossBookMode
			? "__cross_book__"
			: this._generalChatMode
				? GENERAL_MODE_INDEX_ID
				: this.bookDomain.currentIndexId;

		if (!effectiveIndexId) return;

		let session = await this._sessionStore!.get(this._sessionId);
		if (!session) {
			session = await this._sessionStore!.create(
				this._sessionId,
				effectiveIndexId,
				this._crossBookMode
			);
		}

		const existingHashes = new Set(
			session.messages.map((m) => `${m.role}:${m.content?.slice(0, 100)}`)
		);

		let savedCount = 0;
		for (const msg of this._agentChatHistory) {
			if (msg.role === "system") continue;
			const msgHash = `${msg.role}:${msg.content?.slice(0, 100)}`;
			if (!existingHashes.has(msgHash)) {
				await this._sessionStore!.appendMessage(this._sessionId, msg);
				existingHashes.add(msgHash);
				savedCount++;
			}
		}

		if (savedCount > 0) {
			log(`[SessionDomain] Saved ${savedCount} new messages to SessionStore`);
		}
	}

	async maybeConsolidateMemory(): Promise<void> {
		try {
			if (!this._sessionId || !this._sessionStore) return;
			const session = await this._sessionStore.get(this._sessionId);
			if (!session || session.messages.length === 0) return;

			const unconsolidated = session.messages.slice(session.lastConsolidated);
			const estimateTokens = (msgs: any[]): number => {
				let totalChars = 0;
				for (const msg of msgs) {
					if (typeof msg.content === "string") {
						totalChars += msg.content.length;
					}
				}
				return Math.round(totalChars / 2);
			};

			const currentTokens = estimateTokens(unconsolidated);
			if (currentTokens < DEFAULT_CONSOLIDATOR_CONFIG.tokenThreshold) {
				return;
			}

			await this._sessionStore.acquireLock(this._sessionId);
			try {
				const store = new MemoryStore(this.app);
				const frontendAgent = await this.plugin.getFrontendAgent();
				const consolidator = new MemoryConsolidator(
					store,
					frontendAgent.getLLMClient() as any,
					DEFAULT_CONSOLIDATOR_CONFIG
				);

				const newLastConsolidated = await consolidator.maybeConsolidate(
					session.messages,
					session.lastConsolidated,
					async (newIndex) => {
						await this._sessionStore!.updateLastConsolidated(this._sessionId!, newIndex);
					}
				);

				if (newLastConsolidated > session.lastConsolidated) {
					const newLLMHistory = await this._sessionStore!.getLLMHistory(this._sessionId!);
					const systemPrompt = await frontendAgent.getSystemPromptAsync();
					this._agentChatHistory = [
						{ role: "system", content: systemPrompt },
						...newLLMHistory,
					];
				}
			} finally {
				this._sessionStore.releaseLock(this._sessionId);
			}
		} catch (err) {
			logError("[SessionDomain] Memory consolidation failed:", err);
		}
	}

	async restoreCrossBookMode(): Promise<void> {
		const savedSessions = this.plugin.settings.savedSessions || {};
		const sessionId = savedSessions["__cross_book__"];
		if (sessionId) {
			this._sessionId = sessionId;
			this._crossBookMode = true;
			await this.restoreSession(sessionId);
		}
	}

	async restoreGeneralChatSession(): Promise<void> {
		const savedSessions = this.plugin.settings.savedSessions || {};
		const sessionId = savedSessions["general_chat_index"];
		if (sessionId) {
			this._sessionId = sessionId;
			this._generalChatMode = true;
			await this.restoreSession(sessionId);
		}
	}

	// ── Agent operations ──

	handleRegenerate(messageId: string): void {
		// 流式期间禁止重新生成：streamAssistantResponse 会无条件 new 新的
		// abortController，覆盖正在使用的引用，导致旧 stream 失去取消句柄、
		// _isProcessing / _isAiStreaming 状态错乱。
		if (this._isProcessing) return;

		// 优先用 messageRegistry 精确定位（历史消息，避免同秒 timestamp 冲突）；
		// fallback 用 timestamp === 定位新消息（id=ISO timestamp，毫秒精度唯一）。
		const ref = this.messageRegistry.get(messageId);
		let index = ref ? this._agentChatHistory.indexOf(ref) : -1;
		if (index === -1) {
			index = this._agentChatHistory.findIndex((m) => m.timestamp === messageId);
		}
		if (index === -1) return;

		let userMsgIndex = index - 1;
		while (userMsgIndex >= 0 && this._agentChatHistory[userMsgIndex].role !== "user") {
			userMsgIndex--;
		}
		if (userMsgIndex < 0) return;

		// Drop the assistant message being regenerated and everything after it,
		// then re-stream a response for the preceding user message.
		this._agentChatHistory = this._agentChatHistory.slice(0, userMsgIndex + 1);
		const userMsg = this._agentChatHistory[userMsgIndex];
		this.streamAssistantResponse(userMsg.content);
	}

	handleQuestionClick(question: string): void {
		this.sendUserMessage(question);
	}

	handleGenerateOutline(): void {
		this.sendUserMessage("给我一个全书大纲");
	}

	handleGuidanceClick(type: GuidanceType): void {
		const promptMap: Record<GuidanceType, string> = {
			overview: "这本书讲了什么？",
			"core-views": "核心观点是什么？",
			mindmap: "全书导图是什么？",
			"key-concepts": "有哪些关键概念？",
			"reading-guide": "我该从哪里开始读？",
			relevance: "这本书跟我有什么关系？",
			recommend: "你能给我推荐一本相关的书吗？",
			organize: "帮我整理下读书笔记",
			summary: "我想看我的阅读总结",
			method: "我们来聊聊阅读方法",
		};
		const prompt = promptMap[type];
		if (prompt) {
			this.sendUserMessage(prompt);
		}
	}

	handleDeleteMessagePair(messageId: string): void {
		const initialLength = this._agentChatHistory.length;
		// 用 messageRegistry 精确定位要删除的条目（避免同秒 timestamp 误删其他条目）；
		// fallback timestamp === 兜底新消息。
		const ref = this.messageRegistry.get(messageId);
		this._agentChatHistory = this._agentChatHistory.filter(
			(m) => m !== ref && m.timestamp !== messageId,
		);
		if (this._agentChatHistory.length < initialLength) {
			this.messageRegistry.delete(messageId);
			this.saveToCache().catch((err) =>
				logError("[SessionDomain] Failed to save after delete:", err),
			);
		}
	}

	// ── Helper methods ──

	private resetDiagramState(): void {
		this.diagramPending = false;
		this.diagramEmbedReady = null;
		this.diagramFailReason = null;
		this.diagramCompleted = false;
		this.activeDiagramMessageId = null;
	}

	private buildAgentRequest(message: string, quotes?: QuoteItem[]) {
		const activeFile = this.app.workspace.getActiveFile();
		let currentNodeId: string | undefined;
		if (activeFile) {
			const cache = this.app.metadataCache.getFileCache(activeFile);
			const rawNodeId = cache?.frontmatter?.node_id;
			if (rawNodeId) currentNodeId = String(rawNodeId);
		}

		const context: ToolContext = {
			vault: {
				app: this.app,
				plugin: this.plugin,
			},
			book: {
				indexId: this.bookDomain.currentIndexId || "",
				pdfName: this.bookDomain.currentPdfName || "",
				markdownFiles: this._currentMarkdownFiles,
				currentNodeId,
				documentMetadata: {
					title: this.bookDomain.currentPdfName || "",
				},
				docDescription: this.bookDomain.currentDocDescription || undefined,
			},
			crossBook: (() => {
				const ids = this.bookDomain.currentBooklistBookIds;
				const isGeneral =
					this.bookDomain.currentIndexId === GENERAL_MODE_INDEX_ID ||
					this._generalChatMode;
				if (!ids && !isGeneral) return undefined;
				return {
					booklistBookIds: ids ?? undefined,
					crossBookMode: !!ids,
					bookshelfSummary: isGeneral
						? this.bookDomain.getBookshelfSummary()
						: undefined,
					indexedBooks: this.bookDomain.indexes?.length
						? this.bookDomain.indexes
								.filter((i) => i.status === "ready")
								.map((i) => ({ id: i.id, name: i.pdf_name }))
						: undefined,
				};
			})(),
			visual: undefined,
			useLLMTreeSearch: this._useLLMTreeSearch,
		};

		const referencedDocs = this.chatDocumentService
			.getLoadedDocumentsArray()
			.map((doc) => ({ name: doc.name, content: doc.content }));

		return {
			userMessage: message,
			context,
			history: this._agentChatHistory.filter((m) => m.role !== "system"),
			quotes,
			referencedDocs,
			abortSignal: this.abortController!.signal,
		};
	}

	private async handleDiagramReady(embed: string): Promise<void> {
		if (this.diagramCompleted) {
			// 占位已在 finalize 创建，复用其 id 替换为图表（不可重新生成 id，否则 updateMessage 找不到目标）
			if (!this.activeDiagramMessageId) {
				log("[SessionDomain] onDiagramReady 到达但占位已清理，忽略");
				return;
			}
			log(`[SessionDomain] 图表就绪，替换占位: ${this.activeDiagramMessageId}`);
			this.eventBus.emit("chat:diagram-ready", {
				messageId: this.activeDiagramMessageId,
				embed,
			});
			this.activeDiagramMessageId = null;
			this.diagramPending = false;
			await this.saveToCache();
		} else {
			this.diagramEmbedReady = embed;
		}
	}

	private async handleDiagramFailed(reason: string): Promise<void> {
		if (this.diagramCompleted) {
			// 复用占位 id，让 ChatPresenter 移除占位气泡（不显示绘图信息）
			if (!this.activeDiagramMessageId) {
				log("[SessionDomain] onDiagramFailed 到达但占位已清理，忽略");
				return;
			}
			log(`[SessionDomain] 图表失败，移除占位: ${this.activeDiagramMessageId}`);
			this.eventBus.emit("chat:diagram-failed", {
				messageId: this.activeDiagramMessageId,
				reason,
			});
			this.activeDiagramMessageId = null;
			this.diagramPending = false;
			await this.saveToCache();
		} else {
			this.diagramFailReason = reason;
		}
	}

	private async correctWikiLinks(content: string): Promise<string> {
		if (!this.bookDomain.currentPdfName) return content;
		try {
			const wikiLinkResult = await validateWikiLinks(content, {
				app: this.app,
				bookName: this.bookDomain.currentPdfName,
				vaultPath: this.getVaultPath(),
				toolResults: [],
			});
			return wikiLinkResult.correctedContent;
		} catch (err) {
			logError("[SessionDomain] WikiLink validation failed:", err);
			return content;
		}
	}

	private finalizeAssistantMessage(aiMessageId: string, correctedContent: string): void {
		this.eventBus.emit("chat:assistant-message-completed", {
			messageId: aiMessageId,
			content: correctedContent,
		});

		const aiMsgObj: ChatMessage = {
			role: "assistant",
			content: correctedContent,
			// aiMessageId 已是 ISO timestamp，复用保证与 MessageList id 一致
			timestamp: aiMessageId,
		};
		this._agentChatHistory.push(aiMsgObj);

		this.diagramCompleted = true;
		if (this.diagramPending) {
			// 所有 diagram 消息都基于占位气泡：先创建占位（保证 messageId 存在于
			// messageList），再用 ready/failed 替换或移除。避免 updateMessage 找不到目标。
			const timestamp = Date.now();
			this.activeDiagramMessageId = `msg-${timestamp}-diagram`;
			this.eventBus.emit("chat:assistant-message-started", {
				messageId: this.activeDiagramMessageId,
				status: STATUS_DIAGRAM,
				isDiagramPlaceholder: true,
			});

			if (this.diagramEmbedReady) {
				// 图先于 finalize 完成 → 立即把占位替换为图表
				this.eventBus.emit("chat:diagram-ready", {
					messageId: this.activeDiagramMessageId,
					embed: this.diagramEmbedReady,
				});
				this.resetDiagramState();
			} else if (this.diagramFailReason) {
				// 图先于 finalize 失败 → 移除占位（不显示任何绘图信息）
				this.eventBus.emit("chat:diagram-failed", {
					messageId: this.activeDiagramMessageId,
					reason: this.diagramFailReason,
				});
				this.resetDiagramState();
			}
			// 否则保留占位，等 onDiagramReady/Failed 到达后替换/移除
		}

		this._isProcessing = false;
		this._isAiStreaming = false;
		this.emitStreamStopped("completed");
	}

	private async parseAndLoadReferences(message: string): Promise<void> {
		const wikilinkRegex = /\[\[([^\]]+)\]\]/g;
		let match;
		const loadedNames: string[] = [];
		while ((match = wikilinkRegex.exec(message)) !== null) {
			const linkText = match[1];
			const file = this.app.metadataCache.getFirstLinkpathDest(linkText, "");
			if (file) {
				const doc = await this.chatDocumentService.loadByPath(file.path, "wikilink");
				if (doc) {
					loadedNames.push(doc.name);
				}
			}
		}
		if (loadedNames.length > 0) {
			this.eventBus.emit("chat:documents-loaded", { names: loadedNames });
		}
	}

	private getNormalizedBookName(): string {
		if (!this.bookDomain.currentPdfName) {
			return this.bookDomain.currentIndexId || "";
		}
		return this.bookDomain.currentPdfName.replace(/\.pdf$/i, "").replace(/\.epub$/i, "");
	}

	private getVaultPath(): string {
		const adapter = this.app.vault.adapter;
		if ("getBasePath" in adapter) {
			return (adapter as any).getBasePath();
		}
		return "";
	}

	private emitStreamStopped(reason: "cancelled" | "completed" | "error"): void {
		// 注意：messageId 这里传 sessionId 仅作占位（cancel/完成时无法定位具体
		// aiMessageId）。当前 ChatPresenter 的 stream-stopped 订阅不读该字段，
		// 仅为满足 StreamStoppedEvent 类型契约。
		this.eventBus.emit("chat:stream-stopped", {
			messageId: this._sessionId || "unknown",
			reason,
		});
	}
}
