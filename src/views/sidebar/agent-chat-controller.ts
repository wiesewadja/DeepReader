/**
 * AI 对话 + Agent 查询控制器
 *
 * 管理消息发送、Agent 查询、流式控制、HITL 审查、消息操作。
 */

import { Notice } from 'obsidian';
import { uiLog as log, warn, error as logError } from '../../utils/logger.js';
import { MessageData, MessageRole, AIMessage } from '../../components/message/message.js';
import type { ToolContext } from '../../agent/tools/types.js';
import type { HumanizedProgress } from '../../agent/ui/humanized-types.js';
import {
	validateWikiLinks,
} from '../../agent/utils/wiki-link-hook.js';
import { getVaultPath } from '../../utils/mobile-fs.js';
import { MemoryStore } from '../../agent/memory/store.js';
import { resolveRoleConfig } from '../../config/providers.js';
import { ExcerptModal } from '../../components/excerpt/excerpt-modal.js';
import type { ExcerptContent, ExcerptMetadata } from '../../types/excerpt.js';
import { ConfirmModal } from '../../components/confirm-modal.js';
import { GUIDANCE_BUTTONS, ADVISOR_BUTTONS, GuidanceType } from '../../components/message-list/message-list.js';
import { GENERAL_MODE_INDEX_ID } from '../../agent/config/agent-constants.js';
import { StreamingVoicePlayer } from '../../services/tts/streaming-voice-player.js';
import type { StreamingVoiceState } from '../../services/tts/streaming-voice-player.js';
import type { ChatMessage } from '../../agent/types.js';
import type { MascotExpression } from '../../components/reading-topbar/mascot-face.js';
import type { DeepReaderPluginInterface } from '../../agent/tools/context/vault.js';

export interface AgentChatControllerHost {
	get app(): import('obsidian').App;
	get plugin(): DeepReaderPluginInterface;
	get messageList(): import('../../components/message-list/message-list.js').MessageList | null;
	get chatInput(): import('../../components/chat-input/chat-input.js').ChatInput | null;
	get frontendAgent(): import('../../agent/index.js').FrontendAgent | null;
	get proactiveEngine(): import('../../agent/proactive/engine.js').ProactiveEngine | null;
	get currentIndexId(): string | null;
	get currentPdfName(): string | null;
	get currentDocDescription(): string | null;
	get currentBookCoverUrl(): string | null;
	get currentBookAuthor(): string | null;
	get currentMarkdownFiles(): Record<string, string>;
	get useLLMTreeSearch(): boolean;
	get sessionId(): string | null;
	get sessionStore(): import('../../agent/session/index.js').SessionStore | null;
	get crossBookMode(): boolean;
	get currentBooklistBookIds(): string[] | null;
	get indexes(): import('../../types/index.js').IndexListItem[];
	get ttsService(): import('../../services/tts/tts-service.js').TTSService | null;
	get contextManager(): import('../../services/context-manager.js').ContextManager | null;
	get isProcessing(): boolean;
	get isAiStreaming(): boolean;

	get readingTopbar(): import("../../components/reading-topbar/index.js").ReadingTopbar | null;

	saveToCache(): Promise<void>;
	maybeConsolidateMemory(): Promise<void>;
	clearQuotes(): void;
	getDisplayName(name: string): string;
	initializeFrontendAgent(): Promise<void>;
	parseAndLoadReferences(message: string): Promise<void>;
	copyToClipboard(text: string): void;
	getBookshelfSummary(): string | undefined;
}

export class AgentChatController {
	private host: AgentChatControllerHost;
	private streamController: AbortController | null = null;
	private isProcessing: boolean = false;
	private isAiStreaming: boolean = false;
	private proactiveAbortController: AbortController | null = null;
	private streamingVoicePlayers: Map<string, StreamingVoicePlayer> = new Map();
	private detachedMascotEl: HTMLElement | null = null;
	private _agentChatHistory: ChatMessage[] = [];
	private _currentMarkdownFiles: Record<string, string> = {};

	/**
	 * 压缩超长引用文档内容（通过 LLM 摘要）
	 * 超过 HARD_LIMIT 直接截断，超过 maxChars 但在 HARD_LIMIT 内则调用 LLM 压缩
	 */
	private async compressReferencedDoc(name: string, content: string, maxChars: number): Promise<string> {
		const HARD_LIMIT = 50000;
		const truncated = () => content.slice(0, maxChars) + '\n... (内容过长已截断)';

		// 超大文档不走 LLM 压缩，直接截断
		if (content.length > HARD_LIMIT) {
			return truncated();
		}

		const llmClient = this.host.frontendAgent?.getLLMClient();
		if (!llmClient) {
			return truncated();
		}

		try {
			const response = await llmClient.chat([
				{ role: 'system', content: '你是文档摘要助手。将文档压缩到指定字数以内，保留关键信息和结构。直接输出压缩后的 Markdown 内容，不要解释。' },
				{ role: 'user', content: `请将以下文档压缩到 ${maxChars} 字符以内（当前 ${content.length} 字符），保留核心观点和结构：\n\n---\n${content}` },
			], []);
			if (response.content && response.content.length > 0) {
				// LLM 可能不严格遵守字数限制，超长则截断
				return response.content.length > maxChars * 1.2
					? response.content.slice(0, maxChars) + '\n... (压缩后仍过长，已截断)'
					: response.content;
			}
		} catch (err) {
			log('[AgentChatController] 文档压缩失败:', err);
		}

		return truncated();
	}

	private reattachMascot(): void {
		if (this.detachedMascotEl) {
			this.host.readingTopbar?.reattachMascot(this.detachedMascotEl);
			this.detachedMascotEl = null;
		}
	}

	/** 统一重置处理中状态 + UI 恢复 */
	private resetProcessingState(): void {
		this.isProcessing = false;
		this.isAiStreaming = false;
		this.host.chatInput?.setStreaming(false);
		this.host.chatInput?.setDisabled(false);
		this.reattachMascot();
		this.host.readingTopbar?.setMascotExpression('idle');
	}

	constructor(host: AgentChatControllerHost) {
		this.host = host;
	}

	// ── State accessors ──

	get processing(): boolean { return this.isProcessing; }
	get aiStreaming(): boolean { return this.isAiStreaming; }
	get currentStreamController(): AbortController | null { return this.streamController; }
	get agentChatHistory(): ChatMessage[] { return this._agentChatHistory; }
	set agentChatHistory(history: ChatMessage[]) { this._agentChatHistory = history; }
	get currentMarkdownFiles(): Record<string, string> { return this._currentMarkdownFiles; }
	set currentMarkdownFiles(files: Record<string, string>) { this._currentMarkdownFiles = files; }

	getStreamingVoicePlayers(): Map<string, StreamingVoicePlayer> {
		return this.streamingVoicePlayers;
	}

	// ── Stream control ──

	cancelActiveStream(): void {
		if (this.streamController) {
			try {
				this.streamController.abort();
				log('[DeepPDF] 已静默取消流式请求');
			} catch (e) {
				warn('[DeepPDF] 取消流式请求时出错:', e);
			}
			this.streamController = null;
		}
		this.resetProcessingState();
	}

	stopGeneration(): void {
		if (!this.isAiStreaming || !this.streamController) {
			return;
		}

		log('[DeepPDF] 用户中断 AI 生成');
		this.streamController.abort();
		this.streamController = null;
		this.resetProcessingState();

		const messages = this.host.messageList?.getMessages() || [];
		const lastAiMessage = [...messages].reverse().find(m => {
			const data = m.getData();
			return data.role === 'assistant' && data.isStreaming;
		});
		if (lastAiMessage) {
			const data = lastAiMessage.getData();
			this.host.messageList?.updateMessage(data.id, {
				content: data.content + '\n\n*用户已中断*',
				isStreaming: false,
				timestamp: new Date().toISOString()
			});
		}

		this.host.saveToCache();
	}

	// ── Message sending ──

	async sendMessageWithInput(message: string): Promise<void> {
		log('[DeepPDF] sendMessageWithInput called:', message);
		await this.sendMessage(message);
	}

	async sendMessage(message: string, quotes?: import('../../components/chat-input/chat-input.js').QuoteItem[], regenerateMessageId?: string): Promise<void> {
		if (this.proactiveAbortController) {
			this.proactiveAbortController.abort();
			this.proactiveAbortController = null;
		}
		if ((!message.trim() && (!quotes || quotes.length === 0)) || this.isProcessing) {
			return;
		}

		await this.host.parseAndLoadReferences(message);

		this.isProcessing = true;
		this.isAiStreaming = true;
		this.host.chatInput?.setDisabled(true);
		this.host.chatInput?.setStreaming(true);
		this.host.readingTopbar?.setMascotExpression("curious");

		try {
			let aiMessageId: string;

			if (regenerateMessageId) {
				aiMessageId = regenerateMessageId;
				// 保留原消息的 citedQuoteIds / citedQuotePreviews（重新生成不应丢失引用关联）
				// 注意：仅在 existingMsg 存在且有值时设置，
				// 避免 updateMessage 里的 Object.assign 用 undefined 覆盖原值
				const existingMsg = this.host.messageList?.getMessagesData()
					.find(m => m.id === aiMessageId);
				const updates: Partial<MessageData> = {
					content: this.host.crossBookMode ? "🔍 正在跨书籍查阅..." : "📖 正在翻阅...",
					isStreaming: true,
					currentStatus: '开始阅读...',
					agentToolCalls: [],
				};
				if (existingMsg?.citedQuoteIds?.length) {
					updates.citedQuoteIds = existingMsg.citedQuoteIds;
				}
				if (existingMsg?.citedQuotePreviews?.length) {
					updates.citedQuotePreviews = existingMsg.citedQuotePreviews;
				}
				this.host.messageList?.updateMessage(aiMessageId, updates);

				const history = this._agentChatHistory;
				const lastUserIndex = history.findLastIndex(m => m.role === 'user');
				if (lastUserIndex >= 0) {
					const beforeRegenerate = history.length;
					this._agentChatHistory = history.slice(0, lastUserIndex + 1);
					log(`[DeepPDF] 重试模式：清理了 ${beforeRegenerate - this._agentChatHistory.length} 条旧消息`);
				}
			} else {
				const timestamp = Date.now();
				const userMessageId = `msg-${timestamp}-user`;
				aiMessageId = `msg-${timestamp}-ai`;

				log(`[DeepPDF] sendMessage - currentPdfName: ${this.host.currentPdfName}`);

				const userMessageData: MessageData = {
					id: userMessageId,
					role: "user" as MessageRole,
					content: message,
					timestamp: new Date().toISOString(),
					pdfName: this.host.currentPdfName || undefined,
					quotes: quotes && quotes.length > 0 ? quotes : undefined
				};
				this.host.messageList?.addMessage(userMessageData);
				// 发送后立即清空输入区的引用卡片
				// （AI 开始回复时不再需要“边发边看”卡片，已在 user message 里持久化）
				this.host.clearQuotes();

				const aiMessageData: MessageData = {
					id: aiMessageId,
					role: "assistant" as MessageRole,
					content: "",
					timestamp: new Date().toISOString(),
					isStreaming: true,
					isAgentMessage: true,
					currentStatus: '开始阅读...',
					pdfName: this.host.currentPdfName || undefined,
					question: message,
					conversationId: this.host.sessionId || undefined,
					bookCoverUrl: this.host.currentBookCoverUrl || undefined,
					bookAuthor: this.host.currentBookAuthor || undefined,
					enableVoiceReply: !!(this.host.plugin.settings.enableVoiceReply && resolveRoleConfig('tts', this.host.plugin.settings)),
					voiceState: !!(this.host.plugin.settings.enableVoiceReply && resolveRoleConfig('tts', this.host.plugin.settings)) ? 'loading' as const : undefined,
					// 回应引用关联：AI 消息 → 哪几条 user quote 触发的（用于 "📌 回应引用" 徽标）
					citedQuoteIds: quotes && quotes.length > 0 ? quotes.map(q => q.id) : undefined,
					// 引用预览（供徽标显示 “正在回应「……」”）
					citedQuotePreviews: quotes && quotes.length > 0
						? quotes.map(q => q.text.length > 12 ? q.text.substring(0, 12) + '…' : q.text)
						: undefined,
				};
				this.host.messageList?.addMessage(aiMessageData);
			}

			// Detach mascot from topbar → insert into AI message bubble
			const mascotEl = this.host.readingTopbar?.detachMascot() ?? null;
			if (mascotEl) {
				this.detachedMascotEl = mascotEl;
				const aiMsgEl = this.host.messageList?.getMessage(aiMessageId)?.getElement();
				const thinkingBar = aiMsgEl?.querySelector('.deeppdf-mascot-thinking-bar');
				thinkingBar?.insertBefore(mascotEl, thinkingBar.firstChild);
			}

			this.handleAgentQuery(message, this.host.currentIndexId || GENERAL_MODE_INDEX_ID, aiMessageId, quotes)
				.catch(err => {
					logError('[DeepPDF] handleAgentQuery unhandled:', err);
					this.host.messageList?.updateMessage(aiMessageId, {
						content: `查询失败: ${err instanceof Error ? err.message : String(err)}`,
						isStreaming: false,
						timestamp: new Date().toISOString()
					});
					this.resetProcessingState();
				});

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`查询失败: ${errorMessage}`);

			const errorId = `msg-${Date.now()}-error`;
			this.host.messageList?.addMessage({
				id: errorId,
				role: "assistant" as MessageRole,
				content: `查询失败: ${errorMessage}`,
				timestamp: new Date().toISOString()
			});

			this.resetProcessingState();
			this.host.chatInput?.focus();
		}
	}

	// ── Agent query ──

	private async handleAgentQuery(
		query: string,
		indexId: string,
		aiMessageId: string,
		quotes?: import('../../components/chat-input/chat-input.js').QuoteItem[]
	): Promise<void> {
		try {
			await this.host.initializeFrontendAgent();

			if (!this.host.frontendAgent) {
				throw new Error("FrontendAgent 初始化失败");
			}

			if (this.streamController) {
				this.streamController.abort();
				log('[DeepPDF] 取消旧的流式请求');
			}

			this.streamController = new AbortController();

			let fullContent = '';
			let currentStatus = '';

			const activeFile = this.host.app.workspace.getActiveFile();
			let currentNodeId: string | undefined;
			if (activeFile) {
				const cache = this.host.app.metadataCache.getFileCache(activeFile);
				const rawNodeId = cache?.frontmatter?.node_id;
				if (rawNodeId) currentNodeId = String(rawNodeId);
			}

			const context: ToolContext = {
				vault: {
					app: this.host.app,
					plugin: this.host.plugin,
				},
				book: {
					indexId: indexId,
						pdfName: this.host.currentPdfName || '',
					markdownFiles: this._currentMarkdownFiles,
					currentNodeId,
					documentMetadata: {
						title: this.host.currentPdfName || '',
					},
					docDescription: this.host.currentDocDescription || undefined,
				},
				crossBook: (() => {
					const ids = this.host.currentBooklistBookIds;
					const isGeneral = indexId === GENERAL_MODE_INDEX_ID;
					if (!ids && !isGeneral) return undefined;
					return {
						booklistBookIds: ids ?? undefined,
						crossBookMode: !!ids,
						bookshelfSummary: isGeneral ? this.host.getBookshelfSummary() : undefined,
						indexedBooks: this.host.indexes?.length
							? this.host.indexes.filter(i => i.status === 'ready').map(i => ({ id: i.id, name: i.pdf_name }))
						: undefined,
					};
				})(),
				visual: undefined, // 图表生成已迁移到 Hermes
				useLLMTreeSearch: this.host.useLLMTreeSearch,
				quotes: quotes,
				mode: this.host.proactiveEngine?.shouldEnableSocratic(indexId) ? 'socratic' as const : undefined,
				ttsConfig: this.host.plugin.settings.enableVoiceReply ? (() => {
					const cfg = resolveRoleConfig('tts', this.host.plugin.settings);
					return cfg ? { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model, provider: cfg.provider } : undefined;
				})() : undefined,
				llmConfig: this.host.plugin.settings.enableVoiceReply ? (() => {
					const cfg = resolveRoleConfig('router', this.host.plugin.settings);
					return cfg ? { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model } : undefined;
				})() : undefined,
			};

			let userMessage = query;

			if (quotes && quotes.length > 0) {
				// 1. 用户可见部分：markdown 引用块（保持原有 UX）
				const quotesText = quotes.map(q => {
					const location = q.headingPath?.join(' > ') || q.heading || q.source || '引用';
					return `> ${q.text}\n> — ${location}`;
				}).join('\n\n');
				userMessage = `${userMessage}\n\n---\n**用户引用了以下内容，请重点关注并基于引用内容回答：**\n${quotesText}`;

				// 2. LLM 可读部分：结构化 <user_cited_quotes> 块（含 blockId/nodeId）
				//    让 LLM 知道这是用户主动引用的强信号 + wiki 回链的精确位置
				//    bookNameForLink：LLM 构造 wiki 链接时**直接使用**这个书名（避免用错章节名/路径）
				const bookNameForLink = this.host.currentPdfName || '当前书籍';
				const citedLines = quotes.map((q, i) => {
					const parts: string[] = [`[${i + 1}] ${q.text}`];
					// wiki 链接用书名（必填）—— LLM 复制即可
					parts.push(`书名(wiki用): ${bookNameForLink}`);
					if (q.headingPath?.length) parts.push(`位置: ${q.headingPath.join(' > ')}`);
					else if (q.heading) parts.push(`位置: ${q.heading}`);
					if (q.nodeId) parts.push(`node_id: ${q.nodeId}`);
					if (q.blockId) parts.push(`block_id: ^${q.blockId}`);
					if (q.sourcePath) parts.push(`来源文件: ${q.sourcePath}`);
					return parts.join(' | ');
				}).join('\n');
				userMessage = `${userMessage}\n\n<user_cited_quotes>\n${citedLines}\n</user_cited_quotes>\n\n⚠️ 你正在回应用户主动引用的内容。回复中**必须**插入 wiki 链接回引每条引用（格式 \`[[书名(wiki用)#^blockId|2-6 字短别名]]\`，书名照抄上面 "书名(wiki用)" 字段，不要猜），链接应嵌入句中作主语/宾语/修饰语，不要堆砌在句末。`;
			}

			// 注入 @ 引用的文档内容到用户消息（超长文档通过 LLM 压缩）
			const contextManager = this.host.contextManager;
			if (contextManager) {
				const MAX_DOC_CHARS = 10000;
				const referencedDocs = contextManager.getLoadedDocumentsArray()
					.filter(d => d.source === 'wikilink' || d.source === 'mention');
				if (referencedDocs.length > 0) {
					const docsText = await Promise.all(referencedDocs.map(async d => {
						let content = d.content;
						if (content.length > MAX_DOC_CHARS) {
							content = await this.compressReferencedDoc(d.name, content, MAX_DOC_CHARS);
						}
						return `### ${d.name}\n\`\`\`markdown\n${content}\n\`\`\``;
					})).then(results => results.join('\n\n'));
					userMessage = `${userMessage}\n\n---\n**用户通过 @ 引用了以下文档，请基于文档内容回答：**\n\n${docsText}`;
				}
			}

			const isNewConversation = this._agentChatHistory.length <= 1;

			let agentState: 'thinking' | 'answering' = 'thinking';
			let hadToolCalls = false;
			let reasoningContent = '';

			const queryStartTime = Date.now();
			let firstContentLogged = false;
			let ttsPreloadTriggered = false;

			const self = this;

			const callbacks = {
				onContent: (text: string) => {
					fullContent = text;

					// 实时提取 <think> 推理内容送入状态栏，从气泡内容中剥离
					const thinkResult = extractStreamingThink(fullContent);
					if (thinkResult.reasoning) {
						fullContent = thinkResult.cleanedContent;
						const firstLine = thinkResult.reasoning.split('\n')[0].slice(0, 50);
						const displayReasoning = firstLine.length < thinkResult.reasoning.split('\n')[0].length
							? firstLine + '...'
							: firstLine;
						if (displayReasoning.trim()) {
							currentStatus = `💭 ${displayReasoning}`;
						}
					}

					if (!firstContentLogged && fullContent.trim().length > 0) {
						firstContentLogged = true;
						const ttfc = Date.now() - queryStartTime;
						log(`[DeepPDF] ⚡ 首字节响应时间 (TTCF): ${ttfc}ms (${(ttfc / 1000).toFixed(1)}s)`);
					}

				// TTS 预加载：内容到 250 字符时异步生成前段音频，用户点击即可播
				if (!ttsPreloadTriggered && fullContent.length >= 250) {
					ttsPreloadTriggered = true;
					self.host.ttsService?.preloadPreview(aiMessageId, fullContent, {
						bookId: self.host.currentIndexId || undefined,
						bookTitle: self.host.getDisplayName(self.host.currentPdfName || '') || undefined,
						bookAuthor: self.host.currentBookAuthor || undefined,
					});
				}

					if (agentState === 'thinking' && fullContent.trim().length > 0) {
						agentState = 'answering';
						if (!hadToolCalls) {
							self.host.readingTopbar?.setMascotExpression('thinking');
						}
					}

					if (agentState === 'thinking' && !hadToolCalls) {
						const updates: any = {
							content: fullContent,
							isStreaming: true,
							isAgentMessage: true,
						};
						if (currentStatus) {
							updates.currentStatus = currentStatus;
						}
						self.host.messageList?.updateMessage(aiMessageId, updates);
						return;
					}

					if (agentState === 'thinking') {
						const updates: any = {
							isStreaming: true,
							isAgentMessage: true,
						};
						if (currentStatus) {
							updates.currentStatus = currentStatus;
						}
						self.host.messageList?.updateMessage(aiMessageId, updates);
						return;
					}

					const updates: any = {
						content: fullContent,
						isStreaming: true,
						isAgentMessage: true,
					};

					if (currentStatus) {
						updates.currentStatus = currentStatus;
					}

					self.host.messageList?.updateMessage(aiMessageId, updates);
				},
				onContentComplete: async (content: string): Promise<string> => {
					// 剥离 <think> 标签，避免全量残留
					const { cleanedContent: cleanedForValidation } = extractStreamingThink(content);

					if (!self.host.currentPdfName || !context.vault.app) {
						return cleanedForValidation;
					}

					try {
						const wikiLinkResult = await validateWikiLinks(
							cleanedForValidation,
							{
								app: context.vault.app,
								bookName: self.host.currentPdfName,
								vaultPath: getVaultPath(self.host.app),
								toolResults: [],
							}
						);
						const correctedContent = wikiLinkResult.correctedContent;

						if (correctedContent !== cleanedForValidation) {
							log('[DeepPDF] 链接已纠正，更新消息');
							self.host.messageList?.updateMessage(aiMessageId, {
								content: correctedContent,
							});
							fullContent = correctedContent;
						}

						return correctedContent;
					} catch (err) {
						logError('[DeepPDF] 链接校验失败:', err);
						return content;
					}
				},
				onProgress: (status: string) => {
					log('[DeepPDF] Agent 进度:', status);
					currentStatus = status;

					self.host.messageList?.updateMessage(aiMessageId, {
						currentStatus: status,
						isStreaming: true,
						isAgentMessage: true,
					});
				},
				onReasoning: (text: string) => {
					log('[DeepPDF] onReasoning 回调被调用, text:', text.slice(0, 50));
					reasoningContent += text;

					const firstLine = reasoningContent.split('\n')[0].slice(0, 50);
					const displayReasoning = firstLine.length < reasoningContent.split('\n')[0].length
						? firstLine + '...'
						: firstLine;

					log('[DeepPDF] onReasoning 更新状态:', displayReasoning);
					self.host.messageList?.updateMessage(aiMessageId, {
						currentStatus: displayReasoning ? `💭 ${displayReasoning}` : undefined,
						isStreaming: true,
						isAgentMessage: true,
					});
					self.host.readingTopbar?.setMascotExpression('thinking');
				},
				onComplete: async () => {
					// 先恢复 mascot 到 topbar（在 updateMessage 之前，避免 DOM 重绘丢失）
					self.reattachMascot();
					self.host.readingTopbar?.setMascotExpression('happy');

					self.host.messageList?.updateMessage(aiMessageId, {
						isStreaming: false,
						timestamp: new Date().toISOString()
					});

					if (self.host.plugin.settings.enableVoiceReply) {
						const msg = self.host.messageList?.getMessage(aiMessageId);
						if (msg && msg instanceof AIMessage) {
							msg.updateLetterState('sealed');
						}
					}

					self.host.saveToCache();
					self.host.saveToCache().then(() => {
						self.host.maybeConsolidateMemory();
					});

					self.isProcessing = false;
					self.isAiStreaming = false;
					self.host.chatInput?.setStreaming(false);
					self.host.chatInput?.setDisabled(false);

					self.host.clearQuotes();

					self.host.chatInput?.focus();
					self.streamController = null;

					if (self.host.plugin.settings.autoTTS && !self.host.plugin.settings.enableVoiceReply) {
						if (self.host.ttsService && self.host.ttsService.getCurrentMessageId() !== aiMessageId) {
							const question = self.findUserQuestion(aiMessageId);
							const memoryContent = await new MemoryStore(self.host.app).readLongTermMemory() || undefined;
							self.host.ttsService.play(aiMessageId, fullContent, question, {
								bookTitle: self.host.getDisplayName(self.host.currentPdfName || '') || undefined,
								bookAuthor: self.host.currentBookAuthor || undefined,
								memoryContent,
							});
						}
					}
				},
				onError: (error: string) => {
					logError('[DeepPDF] Agent 错误:', error);
					// 先恢复 mascot（在 updateMessage 之前）
					self.reattachMascot();
					self.host.readingTopbar?.setMascotExpression('idle');

					self.host.messageList?.updateMessage(aiMessageId, {
						content: `查询失败: ${error}`,
						isStreaming: false,
						timestamp: new Date().toISOString()
					});

					self.isProcessing = false;
					self.isAiStreaming = false;
					self.host.chatInput?.setStreaming(false);
					self.host.chatInput?.setDisabled(false);

					self.host.clearQuotes();

					self.host.chatInput?.focus();
					self.streamController = null;
				},
				onHumanizedProgress: ((() => {
					let lastUpdateTime = 0;
					const THROTTLE_MS = 200;

					return (progress: HumanizedProgress) => {
						const now = Date.now();
						if (now - lastUpdateTime < THROTTLE_MS) {
							return;
						}
						lastUpdateTime = now;

						hadToolCalls = true;
						if (agentState !== 'thinking') {
							return;
						}

						self.host.messageList?.updateMessage(aiMessageId, {
							currentStatus: progress.mainAction.detail,
							readingLevel: progress.currentReadingLevel,
							isStreaming: true,
							isAgentMessage: true,
						});
					const mascotExpr = mapActionToExpression(progress.mainAction.type, progress.mainAction.detail);
					self.host.readingTopbar?.setMascotExpression(mascotExpr);
					};
				})()),
				abortSignal: this.streamController.signal,
				onVoiceReady: (data: { audioBuffer: ArrayBuffer; duration: number }) => {
					const msg = self.host.messageList?.getMessage(aiMessageId);
					if (msg && msg instanceof AIMessage) {
						msg.updateVoiceData(data);
					}
					const lastAiMsg = self._agentChatHistory[self._agentChatHistory.length - 1];
					if (lastAiMsg && lastAiMsg.role === 'assistant') {
						(lastAiMsg as any).voiceAudio = data.audioBuffer;
						(lastAiMsg as any).voiceDuration = data.duration;
						(lastAiMsg as any).voiceState = 'ready';
					}
					if (self.host.sessionStore && self.host.sessionId) {
						self.host.sessionStore.saveVoiceToPlaceholder(
							self.host.sessionId,
							aiMessageId,
							data.audioBuffer,
						);
					}
				},
				onVoiceChunk: (data: { audioChunk: ArrayBuffer; isComplete: boolean }) => {
					const msg = self.host.messageList?.getMessage(aiMessageId);
					if (msg && msg instanceof AIMessage) {
						if (data.isComplete) {
							const player = self.streamingVoicePlayers.get(aiMessageId);
							if (player) {
								player.seal();
							}
						} else {
							let player = self.streamingVoicePlayers.get(aiMessageId);
							if (!player) {
								player = new StreamingVoicePlayer({
									sampleRate: 24000,
									onStateChange: (state: StreamingVoiceState) => {
										if (state === 'playing') {
											msg.updateVoiceState('playing');
										} else if (state === 'paused') {
											msg.updateVoiceState('paused');
										} else if (state === 'ended') {
											msg.updateVoiceState('ended');
										}
									},
								});
								self.streamingVoicePlayers.set(aiMessageId, player);

								msg.updateVoiceState('ready');
							}
							player.enqueueChunk(data.audioChunk);
						}
					}
				},
			};

			const result = await this.host.frontendAgent.continueChat(
				this._agentChatHistory,
				userMessage,
				context,
				callbacks,
			);

			if (result.length > 0) {
				this._agentChatHistory = [...this._agentChatHistory, { role: 'user', content: userMessage }, ...result];
			}
			await this.host.saveToCache();

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logError('[DeepPDF] handleAgentQuery 错误:', error);
			this.reattachMascot();
			this.host.readingTopbar?.setMascotExpression('idle');
			this.host.messageList?.updateMessage(aiMessageId, {
				content: `Agent 查询失败: ${errorMessage}`,
				isStreaming: false,
				timestamp: new Date().toISOString()
			});
			this.resetProcessingState();
		}
	}

	// ── Proactive guidance ──

	async executeProactiveGuidance(params: import('../../agent/proactive/types.js').ProactiveParams): Promise<void> {
		if (!this.host.frontendAgent || !this.host.messageList) return;
		if (this.isProcessing || this.isAiStreaming) return;
		this.host.proactiveEngine?.setProcessing(true);
		this.isProcessing = true;
		this.host.readingTopbar?.setMascotExpression('thinking');
		const aiMessageId = `proactive-${Date.now()}`;
		this.proactiveAbortController = new AbortController();
		try {
			const aiMessageData: MessageData = {
				id: aiMessageId,
				role: "assistant" as MessageRole,
				content: "",
				timestamp: new Date().toISOString(),
				isStreaming: true,
				isAgentMessage: true,
				currentStatus: '思考中...',
				pdfName: this.host.currentPdfName || undefined,
				conversationId: this.host.sessionId || undefined,
				bookCoverUrl: this.host.currentBookCoverUrl || undefined,
				bookAuthor: this.host.currentBookAuthor || undefined,
				isProactiveGuidance: true,
			};
			this.host.messageList.addMessage(aiMessageData);

			const activeFile = this.host.app.workspace.getActiveFile();
			let currentNodeId: string | undefined;
			if (activeFile) {
				const cache = this.host.app.metadataCache.getFileCache(activeFile);
				const rawNodeId = cache?.frontmatter?.node_id;
				if (rawNodeId) currentNodeId = String(rawNodeId);
			}

			const context: ToolContext = {
				vault: {
					app: this.host.app,
					plugin: this.host.plugin,
				},
				book: {
					indexId: this.host.currentIndexId || '',
					pdfName: this.host.currentPdfName || '',
					markdownFiles: this._currentMarkdownFiles,
					currentNodeId,
					documentMetadata: { title: this.host.currentPdfName || '未知文档' },
					docDescription: this.host.currentDocDescription || undefined,
				},
				crossBook: this.host.currentBooklistBookIds ? {
					booklistBookIds: this.host.currentBooklistBookIds,
					crossBookMode: true,
				} : undefined,
				mode: 'proactive' as const,
			};
			const self = this;
			const callbacks = {
				onContent: (content: string) => {
					self.host.messageList?.updateMessage(aiMessageId, { content });
				},
				onProgress: (msg: string) => {
					self.host.messageList?.updateMessage(aiMessageId, { currentStatus: msg });
				},
				onComplete: () => {
					self.host.readingTopbar?.setMascotExpression('happy');
				},
				onError: (msg: string) => {
					self.host.readingTopbar?.setMascotExpression('idle');
					self.host.messageList?.updateMessage(aiMessageId, {
						isStreaming: false,
						content: `引导生成失败: ${msg}`,
					});
				},
				onContentComplete: async (content: string) => content,
				onReasoning: () => {},
				onHumanizedProgress: (progress: HumanizedProgress) => {
					const expr = mapActionToExpression(progress.mainAction.type, progress.mainAction.detail);
					self.host.readingTopbar?.setMascotExpression(expr);
				},
				abortSignal: self.proactiveAbortController?.signal,
				onVoiceReady: () => {},
				onVoiceChunk: () => {},
			};

			const syntheticMessage = (params as any).syntheticMessage || (params as any).question || '';
			const result = await this.host.frontendAgent.runGraphEngine(
				syntheticMessage,
				context,
				callbacks,
				this._agentChatHistory,
			);

			if (this.proactiveAbortController?.signal.aborted) {
				this.host.messageList?.updateMessage(aiMessageId, {
					isStreaming: false,
					content: '引导生成被中断',
				});
				return;
			}

			const assistantContent = result.messages[0]?.content || '';
			this._agentChatHistory = [
				...this._agentChatHistory,
				{ role: 'user', content: syntheticMessage },
				{ role: 'assistant', content: assistantContent },
			];
			this.host.messageList?.updateMessage(aiMessageId, {
				isStreaming: false,
				content: assistantContent,
			});
			await this.host.saveToCache();
		} catch (err) {
			logError('[DeepPDF] 主动引导生成失败:', err);
			this.host.messageList?.updateMessage(aiMessageId, {
				isStreaming: false,
				content: "引导生成失败: " + (err instanceof Error ? err.message : String(err)),
			});
		} finally {
			this.host.proactiveEngine?.setProcessing(false);
			this.isProcessing = false;
			this.proactiveAbortController = null;
		}
	}

	// ── HITL ──

	private showHumanReviewPrompt(
		nodeId: string,
		content: string,
		context: import('../../agent/tools/types.js').ToolContext,
		callbacks: import('../../agent/types.js').AgentLoopOptions
	): void {
		const nodeLabel = nodeId === 'analytical' ? 'S2 分析' : nodeId === 'formatter' ? 'S4 格式化' : nodeId;

		const messages = this.host.messageList?.getMessagesData() || [];
		const lastMsgId = messages.length > 0 ? messages[messages.length - 1].id : '';
		if (lastMsgId) {
			const reviewContent = `${content}\n\n---\n**[${nodeLabel} 审查中]** 请确认结果是否满意。`;
			this.host.messageList?.updateMessage(lastMsgId, {
				content: reviewContent,
				isStreaming: false,
				isAgentMessage: true,
			});
		}

		new Notice(`[${nodeLabel}] 审查中 — 自动确认继续`);
		log(`[DeepPDF] HITL 审查: ${nodeLabel}, 自动确认`);
		this.host.readingTopbar?.setMascotExpression('curious');

		this.handleHumanReviewResponse(true, '', context, callbacks);
	}

	private async handleHumanReviewResponse(
		approved: boolean,
		feedback: string,
		context: import('../../agent/tools/types.js').ToolContext,
		callbacks: import('../../agent/types.js').AgentLoopOptions
	): Promise<void> {
		try {
			const result = await this.host.frontendAgent!.resumeGraphExecution(
				approved,
				feedback,
				context,
				callbacks
			);

			if (result.interrupted) {
				this.showHumanReviewPrompt(result.interrupted.nodeId, result.interrupted.content, context, callbacks);
				return;
			}
			if (result.messages.length > 0) {
				const lastAiMsg = result.messages[result.messages.length - 1];
				const history = [...this._agentChatHistory, lastAiMsg];
				this._agentChatHistory = history;
			}
			await this.host.saveToCache();

			this.isProcessing = false;
			this.isAiStreaming = false;
			this.host.chatInput?.setStreaming(false);
			this.host.chatInput?.setDisabled(false);
			this.reattachMascot();
			this.host.readingTopbar?.setMascotExpression('happy');
		} catch (error) {
			logError('[DeepPDF] HITL 恢复错误:', error);
			this.isProcessing = false;
			this.isAiStreaming = false;
			this.host.chatInput?.setStreaming(false);
			this.host.chatInput?.setDisabled(false);
			this.reattachMascot();
			this.host.readingTopbar?.setMascotExpression('idle');
		}
	}

	// ── Message actions ──

	handleRegenerate(messageId: string): void {
		const message = this.host.messageList?.getMessage(messageId);
		if (!message) return;

		const data = message.getData();
		if (data.role !== "assistant") return;

		const messages = this.host.messageList?.getMessagesData() || [];
		const userMessageIndex = messages.findIndex(m => m.id === messageId) - 1;

		if (userMessageIndex >= 0 && messages[userMessageIndex].role === "user") {
			this.sendMessage(messages[userMessageIndex].content, [], messageId);
		}
	}

	handleCopy(messageId: string): void {
		const message = this.host.messageList?.getMessage(messageId);
		if (!message) return;

		const content = message.getData().content;
		this.host.copyToClipboard(content);
	}

	handleDeleteMessagePair(aiMessageId: string): void {
		const modal = new ConfirmModal(
			this.host.app,
			"删除对话",
			"此操作不可撤销",
			async () => {
				await this.doDeleteMessagePair(aiMessageId);
			},
			{
				confirmLabel: "删除",
				cancelLabel: "取消",
				isDestructive: true
			}
		);
		modal.open();
	}

	private async doDeleteMessagePair(aiMessageId: string): Promise<void> {
		const sessionId = this.host.sessionId;
		const sessionStore = this.host.sessionStore;
		if (!sessionId || !sessionStore) {
			new Notice("无法删除：会话不存在");
			return;
		}

		try {
			const session = await sessionStore.get(sessionId);
			if (!session) {
				new Notice("无法删除：会话数据不存在");
				return;
			}

			const uiMessages = this.host.messageList?.getMessagesData() || [];
			const uiAiIndex = uiMessages.findIndex(m => m.id === aiMessageId);
			if (uiAiIndex === -1) {
				new Notice("无法删除：消息未找到");
				return;
			}

			let uiUserIndex = uiAiIndex - 1;
			while (uiUserIndex >= 0 && uiMessages[uiUserIndex].role !== 'user') {
				uiUserIndex--;
			}
			if (uiUserIndex < 0) {
				new Notice("无法删除：未找到对应的用户问题");
				return;
			}

			const uiIdsToDelete: string[] = [];
			for (let i = uiUserIndex; i < uiMessages.length; i++) {
				if (i > uiUserIndex && uiMessages[i].role === 'user') {
					break;
				}
				uiIdsToDelete.push(uiMessages[i].id);
			}

			const userContent = uiMessages[uiUserIndex].content;
			const storeIndicesToDelete: number[] = [];

			let storeUserIndex = -1;
			for (let i = 0; i < session.messages.length; i++) {
				if (session.messages[i].role === 'user' &&
					session.messages[i].content === userContent) {
					storeUserIndex = i;
					break;
				}
			}

			if (storeUserIndex === -1) {
				new Notice("无法删除：存储中未找到对应消息");
				return;
			}

			for (let i = storeUserIndex; i < session.messages.length; i++) {
				if (i > storeUserIndex && session.messages[i].role === 'user') {
					break;
				}
				storeIndicesToDelete.push(i);
			}

			await sessionStore.deleteMessages(sessionId, storeIndicesToDelete);

			if (this.host.frontendAgent && sessionStore) {
				const llmHistory = await sessionStore.getLLMHistory(sessionId);
				const systemPrompt = await this.host.frontendAgent.getSystemPromptAsync();
				this._agentChatHistory = [
					{ role: 'system', content: systemPrompt },
					...llmHistory
				];
			}

			this.host.messageList?.removeMessages(uiIdsToDelete);

			new Notice("对话已删除");
			log('[DeepPDF] 删除了消息对:', uiIdsToDelete);

		} catch (error) {
			logError('[DeepPDF] 删除消息对失败:', error);
			new Notice("删除失败，请重试");
		}
	}

	handleExcerpt(messageId: string, content: ExcerptContent, metadata: ExcerptMetadata): void {
		const message = this.host.messageList?.getMessage(messageId);
		if (!message) return;

		const data = message.getData();

		if (data.pdfName) {
			metadata.sourcePdf = data.pdfName;
		}

		metadata.sourceType = 'chat';
		delete metadata.chapterPath;
		delete metadata.chapterName;

		const modal = new ExcerptModal({
			content,
			metadata,
			app: this.host.app,
			onSave: (path: string) => {
				new Notice(`摘录已保存到 ${path}`);
			}
		});
		modal.open();
	}

	handleQuestionClick(question: string): void {
		log('[DeepPDF] 追问问题点击:', question);
		this.sendMessage(question);
	}

	handleGenerateOutline(): void {
		log('[DeepPDF] 生成阅读大纲');
		const prompt = "针对本书的目录，帮我整理一个完整的阅读大纲，指出重点和阅读方案";
		this.sendMessage(prompt);
	}

	handleGuidanceClick(type: GuidanceType): void {
		log('[DeepPDF] 引导按钮点击:', type);

		const button = GUIDANCE_BUTTONS.find(b => b.type === type)
			|| ADVISOR_BUTTONS.find(b => b.type === type);
		if (!button) {
			warn('[DeepPDF] 未找到引导按钮配置:', type);
			return;
		}

		this.sendMessage(button.prompt);
	}

	private findUserQuestion(aiMessageId: string): string | undefined {
		const messages = this.host.messageList?.getMessagesData();
		if (!messages) return undefined;
		const idx = messages.findIndex(m => m.id === aiMessageId);
		if (idx <= 0) return undefined;
		const prev = messages[idx - 1];
		return prev?.role === 'user' ? prev.content : undefined;
	}


	destroy(): void {
		this.cancelActiveStream();
		for (const player of this.streamingVoicePlayers.values()) {
			try { player.destroy(); } catch { /* ignore */ }
		}
		this.streamingVoicePlayers.clear();
	}
}

// 从流式内容中提取 <think> 推理文本并剥离标签
function extractStreamingThink(text: string): { reasoning: string; cleanedContent: string } {
	const closedTag = text.match(/<think>([\s\S]*?)<\/think>/);
	if (closedTag) {
		return {
			reasoning: closedTag[1],
			cleanedContent: text.replace(/<think>[\s\S]*?<\/think>/g, '').trim(),
		};
	}
	const openTag = text.match(/<think>([\s\S]*)$/);
	if (openTag) {
		return {
			reasoning: openTag[1],
			cleanedContent: text.replace(/<think>[\s\S]*$/, '').trim(),
		};
	}
	return { reasoning: '', cleanedContent: text.trim() };
}

function mapActionToExpression(type: string, detail: string): MascotExpression {
	if (type === 'thinking' || type === 'writing') return 'thinking';
	if (type === 'reading') {
		// 搜索/浏览/子代理 → curious；深度阅读/分析 → reading
		if (detail.startsWith('🔍') || detail.startsWith('📋') ||
			detail.startsWith('📚') || detail.startsWith('🤖') ||
			detail.startsWith('⏳')) {
			return 'curious';
		}
		return 'reading';
	}
	if (type === 'searching' || type === 'waiting') return 'curious';
	return 'thinking';
}
