/**
 * SidebarHost — SidebarView 与子 controller 之间的窄接口
 *
 * SidebarView 实现此接口，controller 通过 host 访问所需状态，
 * 不直接依赖 SidebarView 类。
 */

import type { App } from 'obsidian';
import type { MessageList } from '../../components/message-list/message-list.js';
import type { ChatInput } from '../../components/chat-input/chat-input.js';
import type { ReadingTopbar } from '../../components/reading-topbar/index.js';
import type { IndexListItem, SearchFilters, ContextDoc } from '../../types/index.js';
import type { SessionStore } from '../../agent/session/index.js';
import type { ContextManager } from '../../services/context-manager.js';
import type { FrontendAgent } from '../../agent/index.js';
import type { ProactiveEngine } from '../../agent/proactive/engine.js';
import type { MilestoneRecorder } from '../../agent/memory/milestones.js';
import type { ReadingProgress } from '../../pageindex/reading-progress.js';
import type { ChatMessage } from '../../agent/types.js';

export interface SidebarHost {
	// ── Obsidian ──
	get app(): App;
	get containerEl(): HTMLElement;

	// ── 插件 ──
	get plugin(): any;

	// ── UI 组件（只读） ──
	get messageList(): MessageList | null;
	get chatInput(): ChatInput | null;
	get readingTopbar(): ReadingTopbar | null;

	// ── 书籍状态 ──
	get currentIndexId(): string | null;
	get currentPdfName(): string | null;
	get currentBookCoverUrl(): string | null;
	get currentBookAuthor(): string | null;
	get currentDocDescription(): string | null;
	get currentMarkdownFiles(): Record<string, string>;
	get indexes(): IndexListItem[];
	get currentChapterId(): string | null;

	// ── 会话状态 ──
	get sessionId(): string | null;
	get sessionStore(): SessionStore | null;
	get agentChatHistory(): ChatMessage[];
	get crossBookMode(): boolean;
	get searchFilters(): SearchFilters;

	// ── 处理状态 ──
	get isProcessing(): boolean;
	get isAiStreaming(): boolean;
	get streamController(): AbortController | null;
	get proactiveAbortController(): AbortController | null;
	get useLLMTreeSearch(): boolean;

	// ── 服务/引擎 ──
	get contextManager(): ContextManager | null;
	get frontendAgent(): FrontendAgent | null;
	get proactiveEngine(): ProactiveEngine | null;
	get milestoneRecorder(): MilestoneRecorder | null;
	get ttsService(): import('../../services/tts/tts-service.js').TTSService | null;
	get streamingVoicePlayers(): Map<string, import('../../services/tts/streaming-voice-player.js').StreamingVoicePlayer>;
	get readingProgress(): ReadingProgress | null;

	// ── 状态变更 ──
	setProcessing(v: boolean): void;
	setAiStreaming(v: boolean): void;
	setSessionId(id: string | null): void;
	setStreamController(ctrl: AbortController | null): void;
	setProactiveAbortController(ctrl: AbortController | null): void;
	setCrossBookMode(v: boolean): void;
	setSearchFilters(filters: SearchFilters): void;
	setUseLLMTreeSearch(v: boolean): void;
	setCurrentIndexId(id: string | null): void;
	setCurrentPdfName(name: string | null): void;
	setCurrentBookCoverUrl(url: string | null): void;
	setCurrentBookAuthor(author: string | null): void;
	setCurrentDocDescription(desc: string | null): void;
	setCurrentMarkdownFiles(files: Record<string, string>): void;
	setCurrentChapterId(id: string | null): void;
	setAgentChatHistory(history: ChatMessage[]): void;
	setSessionStore(store: SessionStore | null): void;
	setFrontendAgent(agent: FrontendAgent | null): void;
	setProactiveEngine(engine: ProactiveEngine | null): void;
	setMilestoneRecorder(recorder: MilestoneRecorder | null): void;
	setTtsService(service: import('../../services/tts/tts-service.js').TTSService | null): void;
	setReadingProgress(progress: ReadingProgress | null): void;
	setReadingTopbar(topbar: ReadingTopbar | null): void;
	setMessageList(list: MessageList | null): void;
	setChatInput(input: ChatInput | null): void;
	setIndexes(indexes: IndexListItem[]): void;
	setQuotesContainer(el: HTMLElement | null): void;

	// ── 便捷方法（委托给其他 controller 或 SidebarView） ──
	getQuotesContainer(): HTMLElement | null;
	updateMessageListPadding(hasContextTags: boolean): void;
}
