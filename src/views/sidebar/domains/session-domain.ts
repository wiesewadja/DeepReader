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
import { StreamingThinkParser } from "../../../utils/streaming-think.js";
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

		const userMessageId = `user-${Date.now()}`;
		const userMsgObj: ChatMessage = {
			role: "user",
			content: message,
			timestamp: new Date().toISOString(),
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

		const aiMessageId = `assistant-${Date.now()}`;
		this.eventBus.emit("chat:assistant-message-started", {
			messageId: aiMessageId,
			status: this._crossBookMode ? STATUS_CROSS_BOOK : STATUS_READING,
		});

		this.resetDiagramState();

		const thinkParser = new StreamingThinkParser();
		let reasoningContent = "";
		let currentStatus = "";

		try {
			const request = this.buildAgentRequest(userMessage, quotes);

			for await (const event of this.agentDomain.stream(request)) {
				switch (event.type) {
					case "text": {
						const { reasoning, cleanedContent } = thinkParser.append(event.content);
						this.eventBus.emit("chat:assistant-text-chunk", {
							messageId: aiMessageId,
							content: cleanedContent,
							isIncremental: false,
						});
						const displayStatus = reasoning.trim()
							? `${STATUS_THINKING_PREFIX} ${reasoning.split("\n")[0].slice(0, 50)}...`
							: currentStatus;
						if (displayStatus) {
							this.eventBus.emit("chat:assistant-status-changed", {
								messageId: aiMessageId,
								status: displayStatus,
							});
						}
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

			const { cleanedContent } = thinkParser.finalize();
			const correctedContent = await this.correctWikiLinks(cleanedContent);

			this.finalizeAssistantMessage(aiMessageId, correctedContent);

			await this.saveToCache();
			await this.maybeConsolidateMemory();

			if (this.plugin.settings.autoTTS) {
				this.ttsDomain.speak(aiMessageId, correctedContent);
			}
		} catch (error) {
			logError("[SessionDomain] Failed during stream processing:", error);
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

		let restoredIndex = 0;
		this.eventBus.emit("chat:history-restored", {
			messages: displayMessages.map((m) => ({
				id: m.timestamp
					? `${m.timestamp}-${restoredIndex++}`
					: `restored-${Date.now()}-${restoredIndex++}`,
				role: m.role as "user" | "assistant",
				content: m.content || "",
				timestamp: m.timestamp,
				isAgentMessage: m.role === "assistant",
			})),
		});

		const llmHistory = await this._sessionStore!.getLLMHistory(sessionId);
		const frontendAgent = await this.plugin.getFrontendAgent();
		const systemPrompt = await frontendAgent.getSystemPromptAsync();
		this._agentChatHistory = [
			{ role: "system", content: systemPrompt },
			...llmHistory,
		];

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
		const index = this._agentChatHistory.findIndex(
			(m) => m.timestamp === messageId || m.content === messageId,
		);
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
		this._agentChatHistory = this._agentChatHistory.filter(
			(m) => m.timestamp !== messageId && m.content !== messageId,
		);
		if (this._agentChatHistory.length < initialLength) {
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
		const timestamp = Date.now();
		this.activeDiagramMessageId = `msg-${timestamp}-diagram`;
		if (this.diagramCompleted) {
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
		const timestamp = Date.now();
		this.activeDiagramMessageId = `msg-${timestamp}-diagram`;
		if (this.diagramCompleted) {
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
			timestamp: new Date().toISOString(),
		};
		this._agentChatHistory.push(aiMsgObj);

		this.diagramCompleted = true;
		if (this.diagramPending) {
			const timestamp = Date.now();
			this.activeDiagramMessageId = `msg-${timestamp}-diagram`;
			if (this.diagramEmbedReady) {
				this.eventBus.emit("chat:diagram-ready", {
					messageId: this.activeDiagramMessageId,
					embed: this.diagramEmbedReady,
				});
				this.resetDiagramState();
			} else if (this.diagramFailReason) {
				this.eventBus.emit("chat:diagram-failed", {
					messageId: this.activeDiagramMessageId,
					reason: this.diagramFailReason,
				});
				this.resetDiagramState();
			} else {
				this.eventBus.emit("chat:assistant-message-started", {
					messageId: this.activeDiagramMessageId,
					status: STATUS_DIAGRAM,
					isDiagramPlaceholder: true,
				});
			}
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
		this.eventBus.emit("chat:stream-stopped", {
			messageId: this._sessionId || "unknown",
			reason,
		});
	}
}
