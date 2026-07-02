/**
 * SessionDomain
 *
 * Owns chat session lifecycle and orchestration. During this incremental
 * refactor it delegates the legacy streaming implementation to
 * AgentChatController and SessionManager while exposing a unified domain
 * interface and publishing chat lifecycle events.
 */

import type { ChatMessage } from "../../../agent/types.js";
import type { SessionStore } from "../../../agent/session/index.js";
import { EventBus } from "../event-bus.js";
import type { SidebarEventMap } from "../events.js";
import type { AgentChatController } from "../agent-chat-controller.js";
import type { SessionManager } from "../session-manager.js";
import { error as logError } from "../../../utils/logger.js";

export interface QuoteItem {
	text: string;
	source?: string;
	heading?: string;
	headingPath?: string[];
	id: string;
	type?: string;
}

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
	sessionManager: SessionManager;
	agentChatController: AgentChatController;
	eventBus: EventBus<SidebarEventMap>;
}

export class SessionDomain {
	private sessionManager: SessionManager;
	private agentChatController: AgentChatController;
	private eventBus: EventBus<SidebarEventMap>;

	constructor(options: SessionDomainOptions) {
		this.sessionManager = options.sessionManager;
		this.agentChatController = options.agentChatController;
		this.eventBus = options.eventBus;
	}

	// ── State accessors (proxy to legacy managers) ──

	get sessionId(): string | null {
		return this.sessionManager.sessionId;
	}

	set sessionId(id: string | null) {
		this.sessionManager.sessionId = id;
	}

	get sessionStore(): SessionStore | null {
		return this.sessionManager.sessionStore;
	}

	get crossBookMode(): boolean {
		return this.sessionManager.crossBookMode;
	}

	set crossBookMode(v: boolean) {
		this.sessionManager.crossBookMode = v;
	}

	get generalChatMode(): boolean {
		return this.sessionManager.generalChatMode;
	}

	set generalChatMode(v: boolean) {
		this.sessionManager.generalChatMode = v;
	}

	get useLLMTreeSearch(): boolean {
		return this.sessionManager.useLLMTreeSearch;
	}

	set useLLMTreeSearch(v: boolean) {
		this.sessionManager.useLLMTreeSearch = v;
	}

	get agentChatHistory(): ChatMessage[] {
		return this.agentChatController.agentChatHistory;
	}

	set agentChatHistory(history: ChatMessage[]) {
		this.agentChatController.agentChatHistory = history;
	}

	get currentMarkdownFiles(): Record<string, string> {
		return this.agentChatController.currentMarkdownFiles;
	}

	set currentMarkdownFiles(files: Record<string, string>) {
		this.agentChatController.currentMarkdownFiles = files;
	}

	get isProcessing(): boolean {
		return this.agentChatController.processing;
	}

	get isAiStreaming(): boolean {
		return this.agentChatController.aiStreaming;
	}

	get currentStreamController(): AbortController | null {
		return this.agentChatController.currentStreamController;
	}

	// ── Stream control ──

	cancelStream(): void {
		this.agentChatController.cancelActiveStream();
		this.emitStreamStopped("cancelled");
	}

	stopGeneration(): void {
		this.agentChatController.stopGeneration();
		this.emitStreamStopped("cancelled");
	}

	// ── Message sending ──

	async sendUserMessage(message: string, quotes?: QuoteItem[]): Promise<void> {
		const messageId = `user-${Date.now()}`;
		this.eventBus.emit("chat:user-message-added", {
			messageId,
			content: message,
			role: "user",
		});
		try {
			await this.agentChatController.sendMessage(message, quotes);
		} catch (error) {
			logError("[SessionDomain] Failed to send user message:", error);
			this.emitStreamStopped("error");
			throw error;
		}
	}

	async sendUserMessageWithInput(message: string): Promise<void> {
		await this.sendUserMessage(message, undefined);
	}

	// ── Session lifecycle (proxy to SessionManager) ──

	async startNewSession(indexId: string): Promise<void> {
		await this.sessionManager.startNewSession(indexId);
	}

	async restoreSession(sessionId: string): Promise<boolean> {
		return this.sessionManager.restoreFromSessionStore(sessionId);
	}

	async ensureSessionStore(): Promise<void> {
		await this.sessionManager.ensureSessionStore();
	}

	async saveToCache(): Promise<void> {
		await this.sessionManager.saveToCache();
	}

	async maybeConsolidateMemory(): Promise<void> {
		await this.sessionManager.maybeConsolidateMemory();
	}

	async restoreCrossBookMode(): Promise<void> {
		await this.sessionManager.restoreCrossBookMode();
	}

	async restoreGeneralChatSession(): Promise<void> {
		await this.sessionManager.restoreGeneralChatSession();
	}

	// ── Agent message operations (proxy to AgentChatController) ──

	handleRegenerate(messageId: string): void {
		this.agentChatController.handleRegenerate(messageId);
	}

	handleCopy(messageId: string): void {
		this.agentChatController.handleCopy(messageId);
	}

	handleQuestionClick(question: string): void {
		this.agentChatController.handleQuestionClick(question);
	}

	handleGenerateOutline(): void {
		this.agentChatController.handleGenerateOutline();
	}

	handleGuidanceClick(type: GuidanceType): void {
		this.agentChatController.handleGuidanceClick(type);
	}

	handleExcerpt(
		messageId: string,
		content: import("../../../types/excerpt.js").ExcerptContent,
		metadata: import("../../../types/excerpt.js").ExcerptMetadata,
	): void {
		this.agentChatController.handleExcerpt(messageId, content, metadata);
	}

	handleDeleteMessagePair(messageId: string): void {
		this.agentChatController.handleDeleteMessagePair(messageId);
	}

	// ── Event helpers ──

	private emitStreamStopped(reason: "cancelled" | "completed" | "error"): void {
		this.eventBus.emit("chat:stream-stopped", {
			messageId: this.sessionManager.sessionId || "unknown",
			reason,
		});
	}
}
