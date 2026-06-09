/**
 * 会话管理器
 *
 * 管理会话生命周期、记忆整合、跨书籍模式。
 */

import { Notice } from 'obsidian';
import { GENERAL_MODE_INDEX_ID } from '../../agent/config/agent-constants.js';
import { MemoryConsolidator } from '../../agent/memory/consolidator.js';
import { MemoryStore } from '../../agent/memory/store.js';
import { DEFAULT_CONSOLIDATOR_CONFIG } from '../../agent/memory/types.js';
import { SessionStore } from '../../agent/session/index.js';
import type { DeepReaderPluginInterface } from '../../agent/tools/context/vault.js';
import type { ChatMessage } from '../../agent/types.js';
import type { MessageRole } from '../../components/message/message.js';
import type { BooklistItemInfo, Booklist } from '../../types/index.js';
import { uiLog as log, warn, error as logError } from '../../utils/logger.js';

export interface SessionManagerHost {
	get app(): import('obsidian').App;
	get plugin(): DeepReaderPluginInterface;
	get messageList(): import('../../components/message-list/message-list.js').MessageList | null;
	get readingTopbar(): import('../../components/reading-topbar/index.js').ReadingTopbar | null;
	get contextManager(): import('../../services/context-manager.js').ContextManager | null;
	get frontendAgent(): import('../../agent/index.js').FrontendAgent | null;
	get currentIndexId(): string | null;
	get currentPdfName(): string | null;
	get currentBookCoverUrl(): string | null;
	get currentBookAuthor(): string | null;
	get agentChatHistory(): ChatMessage[];
	setAgentChatHistory(history: ChatMessage[]): void;
	get isProcessing(): boolean;
	get isAiStreaming(): boolean;
	cancelActiveStream(): void;
	initializeFrontendAgent(): Promise<void>;
	get currentBooklistItems(): BooklistItemInfo[] | null;
	restoreBooklist(booklist: Booklist): void;
}

export class SessionManager {
	private host: SessionManagerHost;
	private _sessionId: string | null = null;
	private _sessionStore: SessionStore | null = null;
	private _crossBookMode: boolean = false;
	private _generalChatMode: boolean = false;
	private _searchFilters: { booklists: string[]; tags: string[] } = { booklists: [], tags: [] };
	private _useLLMTreeSearch: boolean = false;

	constructor(host: SessionManagerHost) {
		this.host = host;
	}

	// ── State accessors ──

	get sessionId(): string | null { return this._sessionId; }
	set sessionId(id: string | null) { this._sessionId = id; }

	get sessionStore(): SessionStore | null { return this._sessionStore; }

	get crossBookMode(): boolean { return this._crossBookMode; }
	set crossBookMode(v: boolean) { this._crossBookMode = v; }

	get generalChatMode(): boolean { return this._generalChatMode; }
	set generalChatMode(v: boolean) { this._generalChatMode = v; }

	get searchFilters(): { booklists: string[]; tags: string[] } { return this._searchFilters; }
	set searchFilters(filters: { booklists: string[]; tags: string[] }) { this._searchFilters = filters; }
	get useLLMTreeSearch(): boolean { return this._useLLMTreeSearch; }
	set useLLMTreeSearch(v: boolean) { this._useLLMTreeSearch = v; }

	// ── Session lifecycle ──

	private generateSessionId(): string {
		return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	private async initializeSessionStore(): Promise<void> {
		if (this._sessionStore) return;
		this._sessionStore = new SessionStore(this.host.app, undefined, this.host.plugin.manifest.id);
		log('[DeepPDF] SessionStore 初始化完成');
	}

	async ensureSessionStore(): Promise<void> {
		await this.initializeSessionStore();
	}

	private getNormalizedBookName(): string {
		if (!this.host.currentPdfName) {
			return this.host.currentIndexId || '';
		}
		return this.host.currentPdfName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
	}

	async startNewSession(indexId: string): Promise<void> {
		this.host.cancelActiveStream();

		this._sessionId = this.generateSessionId();

		this.host.setAgentChatHistory([]);

		if (this.host.contextManager) {
			this.host.contextManager.clearAll();
			log('[DeepPDF] ContextManager cleared for new session');
		}

		await this.initializeSessionStore();
		const effectiveIndexId = this._crossBookMode ? '__cross_book__' : indexId;
		await this._sessionStore!.create(this._sessionId, effectiveIndexId, this._crossBookMode);

		if (!this.host.plugin.settings.savedSessions) {
			this.host.plugin.settings.savedSessions = {};
		}
		const sessionKey = this._crossBookMode ? indexId
			: this._generalChatMode ? GENERAL_MODE_INDEX_ID
			: this.getNormalizedBookName();
		this.host.plugin.settings.savedSessions[sessionKey] = this._sessionId;
		if (indexId !== sessionKey) {
			this.host.plugin.settings.savedSessions[indexId] = this._sessionId;
		}
		await this.host.plugin.saveSettings();

		this.showWelcomeMessage();
	}

	showWelcomeMessage(): void {
		if (!this.host.messageList) return;

		const welcomeId = `msg-${Date.now()}`;

		let welcomeContent: string;
		if (this._generalChatMode) {
			welcomeContent = "你好！我是奚童，你的 AI 伴读。\n\n虽然还没有选中书籍，但我们可以聊聊阅读相关的话题——推荐书单、讨论读书方法、或者整理你的读书笔记。";
			this.host.messageList.addMessage({
				id: welcomeId,
				role: "assistant",
				content: welcomeContent,
				timestamp: new Date().toISOString()
			});
			return;
		}

		if (this._crossBookMode && this.host.currentBooklistItems) {
			const items = this.host.currentBooklistItems;

			if (items && items.length > 0) {
				const bookLines = items.map(item => {
					let line = `- **${item.name}**`;
					if (item.author) line += ` — *${item.author}*`;
					return line;
				}).join("\n");

				welcomeContent = `📚 **主题阅读**模式已开启\n\n${bookLines}\n\n试试问我这些书之间有什么关联、观点差异，或者围绕某个主题进行跨书对比。`;
			} else {
				welcomeContent = "📚 **主题阅读**模式已开启，选择书籍后即可开始跨书对话与对比分析。";
			}

			this.host.messageList.addMessage({
				id: welcomeId,
				role: "assistant",
				content: welcomeContent,
				timestamp: new Date().toISOString()
			});
		}
	}

	private buildFilterDescription(): string {
		const parts: string[] = [];
		if (this._searchFilters.booklists.length > 0) {
			parts.push(`书单: ${this._searchFilters.booklists.join(", ")}`);
		}
		if (this._searchFilters.tags.length > 0) {
			parts.push(`标签: ${this._searchFilters.tags.join(", ")}`);
		}
		return parts.join("; ");
	}

	hasSearchFilters(): boolean {
		return this._searchFilters.booklists.length > 0 || this._searchFilters.tags.length > 0;
	}

	async switchToCrossBookMode(options: { clearMessages?: boolean; showWelcome?: boolean } = {}): Promise<void> {
		if (this._crossBookMode) return;

		this._crossBookMode = true;
		this.host.readingTopbar?.setCrossBookMode(true);
		this.host.plugin.settings.lastCrossBookMode = true;
		await this.host.plugin.saveSettings();

		this.host.messageList?.setCurrentPdfName('');

		if (options.clearMessages !== false) {
			this.host.cancelActiveStream();
			this.host.messageList?.clear();
		}
		if (options.showWelcome) {
			this.showWelcomeMessage();
		}
	}

	async switchToGeneralChatMode(options: { clearMessages?: boolean; showWelcome?: boolean } = {}): Promise<void> {
		if (this._generalChatMode) return;

		this._generalChatMode = true;
		this.host.messageList?.setCurrentPdfName('');

		if (options.clearMessages !== false) {
			this.host.cancelActiveStream();
			this.host.messageList?.clear();
		}

		const indexId = GENERAL_MODE_INDEX_ID;
		this._sessionId = this.generateSessionId();
		this.host.setAgentChatHistory([]);

		if (this.host.contextManager) {
			this.host.contextManager.clearAll();
		}

		await this.initializeSessionStore();
		await this._sessionStore!.create(this._sessionId, indexId, false);

		if (!this.host.plugin.settings.savedSessions) {
			this.host.plugin.settings.savedSessions = {};
		}
		this.host.plugin.settings.savedSessions[indexId] = this._sessionId;
		await this.host.plugin.saveSettings();

		if (options.showWelcome) {
			this.showWelcomeMessage();
		}
	}

	async restoreGeneralChatSession(): Promise<void> {
		const savedSessions = this.host.plugin.settings.savedSessions || {};
		const sessionId = savedSessions[GENERAL_MODE_INDEX_ID];

		if (sessionId) {
			this._sessionId = sessionId;
			this._generalChatMode = true;
			const restored = await this.restoreFromSessionStore(sessionId);
			if (restored) return;
		}

		await this.switchToGeneralChatMode({ clearMessages: true });
	}

	handleNewChat(): void {
		this.startNewSession(this.host.currentIndexId || GENERAL_MODE_INDEX_ID);
	}

	async restoreFromSessionStore(sessionId: string): Promise<boolean> {
		if (!this.host.messageList) return false;

		await this.initializeSessionStore();
		const session = await this._sessionStore!.get(sessionId);

		if (!session || session.messages.length === 0) {
			log('[DeepPDF] SessionStore 中没有找到会话或会话为空:', sessionId);
			return false;
		}

		log('[DeepPDF] 从 SessionStore 恢复会话:', sessionId, '消息数:', session.messages.length, 'lastConsolidated:', session.lastConsolidated);

		const allDisplayMessages = session.messages.filter(msg => {
			if (msg.role === 'user') return true;
			if (msg.role === 'assistant') {
				return !msg.tool_calls || msg.tool_calls.length === 0;
			}
			return false;
		});

		const displayMessages: typeof allDisplayMessages = [];
		for (let i = 0; i < allDisplayMessages.length; i++) {
			const msg = allDisplayMessages[i];
			const nextMsg = allDisplayMessages[i + 1];
			if (msg.role === 'assistant' && nextMsg?.role === 'assistant') {
				log(`[DeepPDF] 跳过旧的 AI 回复（有更新的版本）`);
				continue;
			}
			displayMessages.push(msg);
		}

		let lastUserContent = '';

		displayMessages.forEach((msg, index) => {
			try {
				const msgData: any = {
					id: `restored-${Date.now()}-${index}`,
					role: msg.role as MessageRole,
					content: msg.content || '',
					timestamp: msg.timestamp || new Date().toISOString(),
					isAgentMessage: msg.role === 'assistant',
					pdfName: this.host.currentPdfName || undefined,
					conversationId: this._sessionId || undefined,
					bookCoverUrl: this.host.currentBookCoverUrl || undefined,
					bookAuthor: this.host.currentBookAuthor || undefined,
				};
				if (msg.role === 'user') {
					lastUserContent = msg.content || '';
				} else if (msg.role === 'assistant' && lastUserContent) {
					msgData.question = lastUserContent;
				}
				this.host.messageList!.addMessage(msgData);
			} catch (e) {
				warn(`[DeepPDF] Failed to restore message:`, e);
			}
		});

		if (displayMessages.length > 0 && displayMessages[displayMessages.length - 1].role === 'user') {
			this.host.messageList!.addMessage({
				id: `restored-placeholder-${Date.now()}`,
				role: 'assistant' as MessageRole,
				content: '',
				timestamp: new Date().toISOString(),
				isAgentMessage: true
			});
			log('[DeepPDF] 添加空的 AI 占位气泡，方便用户重试');
		}

		if (this.host.frontendAgent) {
			const llmHistory = await this._sessionStore!.getLLMHistory(sessionId);
			const systemPrompt = await this.host.frontendAgent.getSystemPromptAsync();
			this.host.setAgentChatHistory([
				{ role: 'system', content: systemPrompt },
				...llmHistory
			]);
			log('[DeepPDF] 恢复 agentChatHistory (LLM), 未整合消息数:', llmHistory.length, '总历史数:', session.messages.length);
		}

		return true;
	}

	async saveToCache(): Promise<void> {
		log('[DeepPDF] saveToCache called, sessionId:', this._sessionId);
		if (!this._sessionId) {
			log('[DeepPDF] saveToCache early return: no sessionId');
			return;
		}

		await this.initializeSessionStore();

		const effectiveIndexId = this._crossBookMode
			? '__cross_book__'
			: this._generalChatMode
				? GENERAL_MODE_INDEX_ID
				: this.host.currentIndexId;

		if (!effectiveIndexId) {
			log('[DeepPDF] saveToCache early return: no effectiveIndexId');
			return;
		}

		const RUNTIME_CONTEXT_PATTERN = /^\[运行时上下文[^\]]*\]\n[^\n]*(?:\n[^\n]*)*\n\n/;
		const SYSTEM_NOTE_PATTERN = /<system_note>[\s\S]*?<\/system_note>\n\n/g;

		let messagesToSave: any[] = [];
		if (this.host.messageList) {
			const uiMessages = this.host.messageList.getMessagesData();
			messagesToSave = uiMessages
				.filter(m =>
					m.content &&
					!m.content.includes("已切换到书籍") &&
					m.content !== "📖 开始翻阅..." &&
					m.content !== "🔍 正在跨书籍查阅..."
				)
				.map(m => {
					if (m.role === 'user' && m.content) {
						let content = m.content;
						content = content.replace(SYSTEM_NOTE_PATTERN, '');
						content = content.replace(RUNTIME_CONTEXT_PATTERN, '');
						return { ...m, content };
					}
					return m;
				});
		}

		log('[DeepPDF] saveToCache messagesToSave count:', messagesToSave.length);
		if (messagesToSave.length === 0) {
			log('[DeepPDF] saveToCache early return: no messages to save');
			return;
		}

		let session = await this._sessionStore!.get(this._sessionId);
		if (!session) {
			session = await this._sessionStore!.create(
				this._sessionId,
				effectiveIndexId,
				this._crossBookMode
			);
		}

		const existingHashes = new Set(
			session.messages.map(m => `${m.role}:${m.content?.slice(0, 100)}`)
		);

		let savedCount = 0;
		for (const msg of messagesToSave) {
			const msgHash = `${msg.role}:${msg.content?.slice(0, 100)}`;
			if (!existingHashes.has(msgHash)) {
				await this._sessionStore!.appendMessage(this._sessionId, msg);
				existingHashes.add(msgHash);
				savedCount++;
			}
		}

		if (savedCount > 0) {
			log(`[DeepPDF] 保存 ${savedCount} 条新消息到 SessionStore`);
		}

		if (this._crossBookMode) {
			this.host.plugin.settings.lastCrossBookSessionId = this._sessionId!;
			await this.host.plugin.saveSettings();
			log('[DeepPDF] 保存跨书籍会话ID:', this._sessionId);
		}
	}

	async maybeConsolidateMemory(): Promise<void> {
		try {
			if (!this._sessionId || !this._sessionStore) {
				return;
			}

			const session = await this._sessionStore.get(this._sessionId);
			if (!session || session.messages.length === 0) {
				return;
			}

			const unconsolidated = session.messages.slice(session.lastConsolidated);

			const estimateTokens = (msgs: any[]): number => {
				let totalChars = 0;
				for (const msg of msgs) {
					if (typeof msg.content === 'string') {
						totalChars += msg.content.length;
					}
				}
				return Math.round(totalChars / 2);
			};

			const currentTokens = estimateTokens(unconsolidated);

			log(`[DeepPDF] Memory 状态检查: ${currentTokens} tokens (阈值: ${DEFAULT_CONSOLIDATOR_CONFIG.tokenThreshold}), 未整合消息数: ${unconsolidated.length}, lastConsolidated: ${session.lastConsolidated}`);

			if (currentTokens < DEFAULT_CONSOLIDATOR_CONFIG.tokenThreshold) {
				log(`[DeepPDF] Memory 未触发整合: ${currentTokens} < ${DEFAULT_CONSOLIDATOR_CONFIG.tokenThreshold}`);
				return;
			}

			log(`[DeepPDF] ✅ Memory 整合触发: ${currentTokens} tokens >= ${DEFAULT_CONSOLIDATOR_CONFIG.tokenThreshold}`);

			await this._sessionStore.acquireLock(this._sessionId);

			try {
				const store = new MemoryStore(this.host.app);
				const consolidator = new MemoryConsolidator(
					store,
					this.host.frontendAgent?.getLLMClient() as any,
					DEFAULT_CONSOLIDATOR_CONFIG
				);

				const newLastConsolidated = await consolidator.maybeConsolidate(
					session.messages,
					session.lastConsolidated,
					async (newIndex) => {
						await this._sessionStore!.updateLastConsolidated(this._sessionId!, newIndex);
						log(`[DeepPDF] lastConsolidated 更新为 ${newIndex}`);
					}
				);

				if (newLastConsolidated > session.lastConsolidated) {
					log(`[DeepPDF] 记忆整合完成: ${session.lastConsolidated} -> ${newLastConsolidated}`);

					const newLLMHistory = await this._sessionStore!.getLLMHistory(this._sessionId!);
					if (this.host.frontendAgent && newLLMHistory.length >= 0) {
						const systemPrompt = await this.host.frontendAgent.getSystemPromptAsync();
						this.host.setAgentChatHistory([
							{ role: 'system', content: systemPrompt },
							...newLLMHistory
						]);
						log(`[DeepPDF] agentChatHistory 已刷新，当前消息数: ${this.host.agentChatHistory.length}`);
					}
				}
			} finally {
				this._sessionStore.releaseLock(this._sessionId);
			}
		} catch (err) {
			logError('[DeepPDF] 记忆整合失败:', err);
		}
	}

	async restoreCrossBookMode(): Promise<void> {
		const wasCrossBookMode = this.host.plugin.settings.lastCrossBookMode;
		log('[DeepPDF] restoreCrossBookMode: lastCrossBookMode =', wasCrossBookMode);
		if (wasCrossBookMode) {
			log('[DeepPDF] 恢复跨书籍模式');
			this._crossBookMode = true;
			this.host.readingTopbar?.setCrossBookMode(true);

			// 先恢复书单状态（topbar、currentIndex 等），再恢复会话
			const lastBooklistId = this.host.plugin.settings.lastActiveBooklistId;
			if (lastBooklistId) {
				const history = this.host.plugin.settings.booklistHistory || [];
				const saved = history.find((b: Booklist) => b.id === lastBooklistId);
				if (saved) {
					log('[DeepPDF] 恢复书单:', saved.name);
					this.host.restoreBooklist(saved);
				}
			}

			await this.loadCrossBookSession();
		}

		const wasDeepSearchMode = this.host.plugin.settings.lastDeepSearchMode;
		if (wasDeepSearchMode) {
			log('[DeepPDF] 恢复深度思考模式');
			this._useLLMTreeSearch = true;
		}
	}

	async loadCrossBookSession(): Promise<void> {
		// 优先从 savedSessions[booklistId] 查找，回退到 lastCrossBookSessionId
		const lastBooklistId = this.host.plugin.settings.lastActiveBooklistId;
		const savedSessions = this.host.plugin.settings.savedSessions || {};
		const sessionId = (lastBooklistId && savedSessions[lastBooklistId])
			|| this.host.plugin.settings.lastCrossBookSessionId;
		log('[DeepPDF] loadCrossBookSession: sessionId =', sessionId);

		if (sessionId) {
			this._sessionId = sessionId;

			const restored = await this.restoreFromSessionStore(sessionId);
			if (restored) {
				log('[DeepPDF] loadCrossBookSession: 从 SessionStore 恢复成功');
				this.host.plugin.settings.lastCrossBookSessionId = this._sessionId!;
				await this.host.plugin.saveSettings();
				return;
			}
		}

		log('[DeepPDF] loadCrossBookSession: 没有缓存的跨书籍会话，开始新会话');
		this._sessionId = `cross-book-${Date.now()}`;
		this.host.plugin.settings.lastCrossBookSessionId = this._sessionId!;
		await this.host.plugin.saveSettings();

		await this.initializeSessionStore();
		await this._sessionStore!.create(this._sessionId, '__cross_book__', true);

		this.showWelcomeMessage();
	}
}
