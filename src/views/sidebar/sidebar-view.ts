/**
 * DeepPDF 侧边栏视图
 *
 * 轻量 View Shell：lifecycle + domain wiring + 公有 API 委托。
 * DOM 脚手架与回调装配集中在 sidebar-layout.ts；移动端键盘适配在
 * mobile-keyboard-adapter.ts；TTS/语音/摘录/会话/书域各自独立。
 */

import { ItemView, type WorkspaceLeaf, Notice } from "obsidian";
import type { DeepReaderPluginInterface } from "../../agent/tools/context/vault.js";
import type { ChatInput } from "../../components/chat-input/chat-input.js";
import type { MessageList } from "../../components/message-list/message-list.js";
import type { ReadingTopbar } from "../../components/reading-topbar/index.js";
import { type Booklist, type IndexListItem } from "../../types/index.js";
import { uiLog as log, warn, error as logError } from "../../utils/logger.js";
import { BookDomain } from "./domains/book-domain.js";
import { TTSDomain } from "./domains/tts-domain.js";
import { SessionDomain } from "./domains/session-domain.js";
import { VoiceDomain } from "./domains/voice-domain.js";
import { ChatDocumentService } from "./services/chat-document-service.js";
import { EventBus } from "./event-bus.js";
import type { SidebarEventMap } from "./events.js";
import { ChatPresenter } from "./presenters/chat-presenter.js";
import { ExcerptController } from "./excerpt-controller.js";
import { QuoteManager } from "./quote-manager.js";
import {
	createReadingTopbar,
	createMessageListSection,
	createChatInputSection,
	registerWorkspaceEvents,
	isVoiceEnabled,
	type SidebarLayoutHost,
} from "./sidebar-layout.js";
import { MobileKeyboardAdapter } from "./mobile-keyboard-adapter.js";
import { getLeafParagraphs } from "./utils/message-paragraphs.js";

export const SIDEBAR_VIEW_TYPE = "deeppdf-sidebar-view";

export class SidebarView extends ItemView {
	private plugin: DeepReaderPluginInterface;
	private readingTopbar: ReadingTopbar | null = null;
	private messageList: MessageList | null = null;
	private chatInput: ChatInput | null = null;

	private eventBus: EventBus<SidebarEventMap> = new EventBus<SidebarEventMap>();
	private chatDocumentService: ChatDocumentService | null = null;
	private quotesContainer: HTMLElement | null = null;

	// ── 子系统 controller ──
	private quoteManager: QuoteManager;
	private ttsDomain: TTSDomain;
	private sessionDomain: SessionDomain;
	private bookDomain: BookDomain;
	private voiceDomain: VoiceDomain;
	private excerptController: ExcerptController;
	private chatPresenter: ChatPresenter | null = null;
	private mobileKeyboard = new MobileKeyboardAdapter();

	private chatContainerEl: HTMLElement | null = null;

	/** 停止原文朗读（翻页/切章/关闭阅读模式时调用） */
	stopReadingTTS(resetIndex = true): void {
		this.ttsDomain.stopReadingTTS(resetIndex);
	}

	/** 切换原文朗读（按钮点击 / Hotkey） */
	async toggleReadingTTS(): Promise<void> {
		await this.ttsDomain.toggleReading();
	}

	constructor(leaf: WorkspaceLeaf, plugin: DeepReaderPluginInterface) {
		super(leaf);
		this.plugin = plugin;
		const self = this;
		this.quoteManager = new QuoteManager({
			get chatInput() {
				return self.chatInput;
			},
			updateMessageListPadding(hasContextTags: boolean) {
				self.updateMessageListPadding(hasContextTags);
			},
		});
		this.chatDocumentService = new ChatDocumentService({
			app: this.app,
			eventBus: this.eventBus,
		});
		this.ttsDomain = new TTSDomain({
			app: this.app,
			plugin: this.plugin,
			eventBus: this.eventBus,
			getMessageParagraphs: (messageId: string) => {
				const contentEl = self.messageList
					?.getMessage(messageId)
					?.getElement()
					?.querySelector(".deeppdf-message-content") as HTMLElement | null;
				return getLeafParagraphs(contentEl);
			},
			highlightElement: (el) => self.plugin.readingModeService?.highlightElement(el),
			clearHighlight: () => self.plugin.readingModeService?.clearHighlight(),
			getCurrentPage: () => self.plugin.readingModeService?.getCurrentPage?.() || 1,
			getPageParagraphs: (n?: number) =>
				self.plugin.readingModeService?.getPageParagraphs?.(n) || [],
			isDualPageMode: () => self.plugin.readingModeService?.isDualPageMode?.() || false,
			goToNextPage: () => self.plugin.readingModeService?.nextPage?.() ?? false,
			getReadingTTSState: () => self.readingTopbar?.getReadingTTSState() ?? "idle",
			getSelectionText: () => window.getSelection()?.toString()?.trim() ?? "",
		});
		this.bookDomain = new BookDomain({
			app: this.app,
			plugin: this.plugin,
			eventBus: this.eventBus,
			startNewSession: (indexId) => self.sessionDomain?.startNewSession(indexId) ?? Promise.resolve(),
			restoreFromSessionStore: (sessionId) => self.sessionDomain?.restoreSession(sessionId) ?? Promise.resolve(false),
			getSessionId: () => self.sessionDomain?.sessionId ?? null,
			setSessionId: (id) => { if (self.sessionDomain) self.sessionDomain.sessionId = id; },
			getSessionStore: () => self.sessionDomain?.sessionStore ?? null,
			ensureSessionStore: () => self.sessionDomain?.ensureSessionStore() ?? Promise.resolve(),
			cancelActiveStream: () => self.sessionDomain?.cancelStream(),
		});
		this.sessionDomain = new SessionDomain({
			app: this.app,
			plugin: this.plugin,
			eventBus: this.eventBus,
			chatDocumentService: this.chatDocumentService,
			bookDomain: this.bookDomain,
			ttsDomain: this.ttsDomain,
		});
		this.voiceDomain = new VoiceDomain({
			plugin: this.plugin,
			getChatInput: () => self.chatInput,
			bookDomain: this.bookDomain,
		});
		this.excerptController = new ExcerptController({
			app: this.app,
			getExcerptService: () => this.plugin.getExcerptService?.(),
			getMessageBookName: (messageId: string) =>
				self.messageList?.getMessage(messageId)?.getData().pdfName,
		});
	}

	getViewType() {
		return SIDEBAR_VIEW_TYPE;
	}
	getDisplayText() {
		return "DeepReader";
	}
	getIcon() {
		return "lucide-book-open";
	}

	// ==================== 公有 API（main.ts 契约，薄委托）====================

	async handleDeleteIndex(indexId: string) {
		await this.bookDomain.deleteIndex(indexId);
	}

	async refreshIndexes(): Promise<void> {
		await this.bookDomain.refreshIndexes();
	}

	public async selectIndex(indexId: string): Promise<void> {
		// 选书时退出书单/阅读顾问模式
		this.sessionDomain.crossBookMode = false;
		this.sessionDomain.generalChatMode = false;
		await this.bookDomain.selectIndex(indexId);
	}

	public async selectBookByName(bookName: string): Promise<void> {
		this.sessionDomain.crossBookMode = false;
		await this.bookDomain.selectBookByName(bookName);
	}

	public async selectBooklist(booklist: Booklist): Promise<void> {
		this.sessionDomain.crossBookMode = true;
		await this.bookDomain.selectBooklist(
			this.bookDomain.normalizeBooklistItems(booklist),
		);
	}

	/** 重新进入历史书单：恢复已有会话，无会话则新建 */
	public async reenterBooklist(booklist: Booklist): Promise<void> {
		booklist = this.bookDomain.normalizeBooklistItems(booklist);
		this.sessionDomain.crossBookMode = true;

		const savedSessionId = this.plugin.settings.savedSessions?.[booklist.id];
		warn(
			`[reenterBooklist DIAG] booklist.id=${booklist.id}, bookIds=${JSON.stringify(booklist.bookIds)}, savedSessionId=${savedSessionId}, crossBookMode=${this.sessionDomain.crossBookMode}`,
		);
		if (savedSessionId) {
			// 设置 booklist 状态（不创建新会话）
			this.bookDomain.restoreBooklist(booklist);
			warn(
				`[reenterBooklist DIAG] after restoreBooklist: _currentBooklist.bookIds=${JSON.stringify(this.bookDomain.currentBooklistBookIds)}`,
			);
			this.plugin.settings.lastCrossBookMode = true;
			this.plugin.settings.lastActiveBooklistId = booklist.id;
			await this.plugin.saveSettings();

			if (await this.sessionDomain.restoreSession(savedSessionId)) {
				this.sessionDomain.sessionId = savedSessionId;
				return;
			}
		}

		// 无已有会话，走正常 selectBooklist
		await this.bookDomain.selectBooklist(booklist);
	}

	public exitBooklist(): void {
		this.bookDomain.clearBooklist();
		this.sessionDomain.crossBookMode = false;
	}

	public restoreBooklist(booklist: Booklist): void {
		this.bookDomain.restoreBooklist(
			this.bookDomain.normalizeBooklistItems(booklist),
		);
	}

	public getCurrentIndexId(): string | null {
		return this.bookDomain.currentIndexId;
	}

	public getCurrentBooklistId(): string | null {
		return this.bookDomain.currentBooklist?.id ?? null;
	}

	get indexes(): IndexListItem[] {
		return this.bookDomain.indexes;
	}

	public async toggleDeepSearchMode(): Promise<void> {
		this.sessionDomain.useLLMTreeSearch = !this.sessionDomain.useLLMTreeSearch;
		const modeText = this.sessionDomain.useLLMTreeSearch
			? "深度思考模式已开启"
			: "深度思考模式已关闭";
		new Notice(modeText);
		log(`[DeepPDF] toggleDeepSearchMode: ${modeText}`);
		this.plugin.settings.lastDeepSearchMode = this.sessionDomain.useLLMTreeSearch;
		await this.plugin.saveSettings();
	}

	public async sendMessageWithInput(message: string): Promise<void> {
		await this.sessionDomain.sendUserMessageWithInput(message);
	}

	getCurrentBookInfo(): {
		title: string | null;
		page_count: number;
		docDescription: string | null;
	} {
		return this.bookDomain.getCurrentBookInfo();
	}

	async loadIndexes(): Promise<void> {
		await this.bookDomain.loadIndexes();
	}

	// ==================== Lifecycle ====================

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("deeppdf-container");
		container.addClass("deeppdf-chat-container");
		this.renderMainUI(container);
	}

	/** 装配 host（layout 装配层与 View 的契约） */
	private buildLayoutHost(): SidebarLayoutHost {
		return {
			app: this.app,
			plugin: this.plugin,
			bookDomain: this.bookDomain,
			sessionDomain: this.sessionDomain,
			ttsDomain: this.ttsDomain,
			voiceDomain: this.voiceDomain,
			excerptController: this.excerptController,
			quoteManager: this.quoteManager,
			chatDocumentService: this.chatDocumentService,
			registerEvent: (e) => this.registerEvent(e),
			exitBooklist: () => this.exitBooklist(),
			toggleReadingTTS: () => this.toggleReadingTTS(),
			selectIndex: (id) => this.selectIndex(id),
			autoSyncCurrentChapter: () => this.autoSyncCurrentChapter(),
			getMessageList: () => this.messageList,
			getChatInput: () => this.chatInput,
			getReadingTopbar: () => this.readingTopbar,
		};
	}

	private async renderMainUI(container: HTMLElement): Promise<void> {
		container.empty();
		this.chatContainerEl = container;
		const self = this;
		const host = this.buildLayoutHost();

		// 阅读顶栏
		this.readingTopbar = createReadingTopbar(host);
		const topbarEl = this.readingTopbar.getElement();
		if (topbarEl) container.appendChild(topbarEl);

		// 奚童表情：用户活动重置 idle 计时器
		this.registerDomEvent(container, "mouseenter", () =>
			this.readingTopbar?.onMascotUserActivity(),
		);
		this.registerDomEvent(container, "keydown", () =>
			this.readingTopbar?.onMascotUserActivity(),
		);
		this.registerDomEvent(container, "click", () =>
			this.readingTopbar?.onMascotUserActivity(),
		);

		// 消息列表 + ChatPresenter
		this.messageList = createMessageListSection(container, host);
		this.chatPresenter = new ChatPresenter({
			eventBus: this.eventBus,
			get messageList() {
				return self.messageList;
			},
			get chatInput() {
				return self.chatInput;
			},
			get readingTopbar() {
				return self.readingTopbar;
			},
			getActiveFilePath: () => self.app.workspace.getActiveFile()?.path ?? null,
			onDocumentsChanged: (hasDocs) => self.updateMessageListPadding(hasDocs),
		});

		// 输入区 + 引用卡片容器
		const inputSection = createChatInputSection(
			container,
			host,
			isVoiceEnabled(this.plugin),
		);
		this.chatInput = inputSection.chatInput;
		this.quotesContainer = inputSection.quotesContainer;

		// 移动端键盘适配
		this.mobileKeyboard.setup(this.chatContainerEl);

		// 注册工作区事件（select-index / quote / excerpt / active-leaf-change）
		registerWorkspaceEvents(host);

		// 加载索引 + 恢复状态
		await this.loadIndexes();
		await this.sessionDomain.restoreCrossBookMode();
		if (!this.bookDomain.currentIndexId && !this.sessionDomain.crossBookMode) {
			await this.sessionDomain.restoreGeneralChatSession();
		}
	}

	/** 自动同步当前章节到上下文（委托 ChatDocumentService） */
	private async autoSyncCurrentChapter(): Promise<void> {
		await this.chatDocumentService?.syncCurrentChapter(
			this.bookDomain.currentPdfName,
		);
	}

	/**
	 * 更新消息列表的底部间距
	 * 当有上下文标签或引用卡片时，增加间距避免遮挡
	 */
	private updateMessageListPadding(hasContextTags: boolean): void {
		const messagesContainer = this.containerEl?.querySelector(
			".deeppdf-messages-container",
		) as HTMLElement | null;
		if (!messagesContainer) return;

		// 基础间距 110px + 上下文标签高度约 40px + 引用卡片高度
		const basePadding = 110;
		const contextTagsHeight = hasContextTags ? 44 : 0;
		const quotesHeight = this.quotesContainer?.offsetHeight || 0;
		messagesContainer.style.paddingBottom = `${basePadding + contextTagsHeight + quotesHeight}px`;
	}

	async onClose() {
		const safe = (label: string, fn: () => void) => {
			try {
				fn();
			} catch (e) {
				warn(`[DeepPDF] Error ${label}:`, e);
			}
		};

		try {
			safe("mobileKeyboard", () => this.mobileKeyboard.destroy());
			this.chatContainerEl = null;

			if (this.sessionDomain.currentStreamController) {
				this.sessionDomain.cancelStream();
			}

			safe("ttsDomain", () => this.ttsDomain?.destroy());
			safe("chatPresenter", () => {
				this.chatPresenter?.dispose();
				this.chatPresenter = null;
			});
			safe("messageList", () => {
				this.messageList?.destroy();
				this.messageList = null;
			});
			safe("chatInput", () => {
				this.chatInput?.destroy();
				this.chatInput = null;
			});
			safe("voiceDomain", () => this.voiceDomain?.destroy());

			this.eventBus.dispose();

			safe("readingTopbar", () => {
				this.readingTopbar?.destroy();
				this.readingTopbar = null;
			});
		} catch (error) {
			logError("[DeepPDF] Error in onClose:", error);
			// 不要重新抛出错误，避免影响 Obsidian 的 UI
		}
	}
}
