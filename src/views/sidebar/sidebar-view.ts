/**
 * DeepPDF 侧边栏视图
 * ChatGPT 风格的对话界面
 */

import { ItemView, type WorkspaceLeaf, Notice, Platform } from "obsidian";
import { type FrontendAgent } from "../../agent/index.js";
import { SessionStore } from "../../agent/session/index.js";
import type { DeepReaderPluginInterface } from "../../agent/tools/context/vault.js";
import { ChatInput } from "../../components/chat-input/chat-input.js";
import type {
	QuoteItem,
	QuoteMetadata,
} from "../../components/chat-input/chat-input.js";
import { ConfirmModal } from "../../components/confirm-modal.js";
import { Drawer } from "../../components/drawer/drawer.js";
import { ExcerptModal } from "../../components/excerpt/excerpt-modal.js";
import { IndexManager } from "../../components/index-manager/index-manager.js";
import {
	MessageList,
	type GuidanceType,
	GUIDANCE_BUTTONS,
} from "../../components/message-list/message-list.js";
import { ReadingTopbar } from "../../components/reading-topbar/index.js";
import { type TaskProgressCard } from "../../components/task-progress-card.js";
import { resolveRoleConfig } from "../../config/providers.js";
import {
	type TTSService,
	type TTSPlayState,
} from "../../services/tts/tts-service.js";
import { VoiceInputController } from "../../services/asr/voice-input-controller.js";
import { PushToTalkController } from "../../services/push-to-talk.js";
import type { ExcerptContent, ExcerptMetadata } from "../../types/excerpt.js";
import {
	IndexListItem,
	type Booklist,
	stripFileExtension,
} from "../../types/index.js";
import { PDFFileSelectorModal } from "../../ui/pdf-file-selector.js";
import { findBlockIdFromRange } from "../../utils/block-utils.js";
import { Icons, getIcon } from "../../utils/icons.js";
import { uiLog as log, warn, error as logError } from "../../utils/logger.js";
import { BookDomain } from "./domains/book-domain.js";
import { TTSDomain } from "./domains/tts-domain.js";
import { SessionDomain } from "./domains/session-domain.js";
import { ChatDocumentService } from "./services/chat-document-service.js";
import { EventBus } from "./event-bus.js";
import type { SidebarEventMap } from "./events.js";
import { ChatPresenter } from "./presenters/chat-presenter.js";
import { QuoteManager } from "./quote-manager.js";
import { copyToClipboard as _copyToClipboard } from "./search-utils.js";

export const SIDEBAR_VIEW_TYPE = "deeppdf-sidebar-view";

export class SidebarView extends ItemView {
	private plugin: DeepReaderPluginInterface;
	private readingTopbar: ReadingTopbar | null = null;
	private taskCards: Map<string, TaskProgressCard> = new Map();

	// 对话界面组件
	private messageList: MessageList | null = null;
	private chatInput: ChatInput | null = null;

	// EventBus：每个 SidebarView 实例独立
	private eventBus: EventBus<SidebarEventMap> = new EventBus<SidebarEventMap>();

	// 聊天上下文文档服务（章节辅助阅读）
	private chatDocumentService: ChatDocumentService | null = null;

	// 引用卡片管理
	private quotesContainer: HTMLElement | null = null;

	// ── 子系统 controller ──
	private quoteManager: QuoteManager;
	private ttsDomain: TTSDomain;
	private sessionDomain: SessionDomain;
	private bookDomain: BookDomain;
	private chatPresenter: ChatPresenter | null = null;
	private voiceInputCtrl: VoiceInputController | null = null;
	private pushToTalkCtrl: PushToTalkController | null = null;

	// 移动端键盘适配
	private chatContainerEl: HTMLElement | null = null;
	private mobileKeyboardCleanup: (() => void) | null = null;

	/**
	 * 删除索引（本地实现）
	 */
	async handleDeleteIndex(indexId: string) {
		await this.bookDomain.deleteIndex(indexId);
	}

	async refreshIndexes(): Promise<void> {
		await this.bookDomain.refreshIndexes();
	}

	/** 停止原文朗读（翻页/切章/关闭阅读模式时调用） */
	stopReadingTTS(resetIndex = true): void {
		if (this.ttsDomain.isAutoPageTurning()) {
			return; // 程序翻页，朗读已在 readCurrentPage 内自然结束
		}
		this.ttsDomain.stopReading(resetIndex);
		this.readingTopbar?.setReadingTTSState('idle');
		this.clearReadingHighlight();
	}

	/** 清除朗读高亮 */
	private clearReadingHighlight(): void {
		this.plugin.readingModeService?.clearHighlight();
	}

	/** 高亮朗读段落元素 */
	private highlightReadingElement(el: HTMLElement): void {
		this.plugin.readingModeService?.highlightElement(el);
	}

	/** 获取当前页文本 */
	/** 翻到下一页 */
	private goToNextPage(): boolean {
		const service = this.plugin.readingModeService;
		return service?.nextPage?.() ?? false;
	}

	/** 切换原文朗读（按钮点击 / Hotkey） */
	async toggleReadingTTS(): Promise<void> {
		// 如果正在朗读，停止
		if (this.readingTopbar?.getReadingTTSState() !== 'idle') {
			this.stopReadingTTS(false);
			return;
		}

		// 获取朗读文本：优先选区
		const selection = window.getSelection()?.toString()?.trim();
		if (selection) {
			this.readingTopbar?.setReadingTTSState('loading');
			try {
				await this.ttsDomain.readCurrentPage(selection);
				this.readingTopbar?.setReadingTTSState(
					this.ttsDomain.getCurrentSource() === 'reading' ? 'playing' : 'idle',
				);
			} catch (e) {
				this.readingTopbar?.setReadingTTSState('idle');
			}
			return;
		}

		// 无选区时检查当前页是否有内容
		const service = this.plugin.readingModeService;
		const paragraphs = service?.getPageParagraphs?.() || [];
		if (paragraphs.length === 0) {
			new Notice('当前没有可朗读的文本');
			return;
		}

		this.readingTopbar?.setReadingTTSState('loading');
		try {
			await this.ttsDomain.readCurrentPage(); // 无参数走页面朗读
			this.readingTopbar?.setReadingTTSState(
				this.ttsDomain.getCurrentSource() === 'reading' ? 'playing' : 'idle',
			);
		} catch (e) {
			this.readingTopbar?.setReadingTTSState('idle');
		}
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
				const msg = self.messageList?.getMessage(messageId);
				const messageEl = msg?.getElement();
				const contentEl = messageEl?.querySelector('.deeppdf-message-content') as HTMLElement | null;
				if (!contentEl) return [];
				const allElements = Array.from(contentEl.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote'));
				// 选出叶子块级元素（其子树内不含其他块级元素）。
				// querySelectorAll 按文档先序返回，用祖先栈一次遍历标记非叶子节点，O(n)。
				const nonLeaf = new Set<Element>();
				const ancestorStack: Element[] = [];
				for (const el of allElements) {
					while (ancestorStack.length > 0 && !ancestorStack[ancestorStack.length - 1].contains(el)) {
						ancestorStack.pop();
					}
					if (ancestorStack.length > 0) {
						nonLeaf.add(ancestorStack[ancestorStack.length - 1]);
					}
					ancestorStack.push(el);
				}
				return allElements
					.filter((el) => !nonLeaf.has(el))
					.map((el) => el.textContent || "");
			},
			highlightElement: (el) => self.highlightReadingElement(el),
			clearHighlight: () => self.clearReadingHighlight(),
			getCurrentPage: () => {
				const service = self.plugin.readingModeService;
				return service?.getCurrentPage?.() || 1;
			},
			getPageParagraphs: (pageNumber?: number) => {
				const service = self.plugin.readingModeService;
				return service?.getPageParagraphs?.(pageNumber) || [];
			},
			isDualPageMode: () => {
				const service = self.plugin.readingModeService;
				return service?.isDualPageMode?.() || false;
			},
			goToNextPage: () => self.goToNextPage(),
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

	/**
	 * 选择索引（从弹窗中调用或自动切换）
	 * @param indexId 索引 ID
	 */
	public async selectIndex(indexId: string): Promise<void> {
		// 选书时退出书单/阅读顾问模式
		if (this.sessionDomain.crossBookMode) {
			this.sessionDomain.crossBookMode = false;
		}
		if (this.sessionDomain.generalChatMode) {
			this.sessionDomain.generalChatMode = false;
		}
		await this.bookDomain.selectIndex(indexId);
	}

	public async selectBooklist(booklist: Booklist): Promise<void> {
		this.sessionDomain.crossBookMode = true;
		// 补全 items（历史书单不含 items）
		if (!booklist.items || booklist.items.length === 0) {
			const items = booklist.bookIds.map((id) => {
				const idx = this.bookDomain.indexes.find((i) => i.id === id);
				let name = idx?.pdf_name || id;
				name = stripFileExtension(name);
				return { id, name, author: idx?.author };
			});
			booklist = { ...booklist, items };
		}
		await this.bookDomain.selectBooklist(booklist);
	}

	/** 重新进入历史书单：恢复已有会话，无会话则新建 */
	public async reenterBooklist(booklist: Booklist): Promise<void> {
		// 补全 items
		if (!booklist.items || booklist.items.length === 0) {
			const items = booklist.bookIds.map((id) => {
				const idx = this.bookDomain.indexes.find((i) => i.id === id);
				let name = idx?.pdf_name || id;
				name = stripFileExtension(name);
				return { id, name, author: idx?.author };
			});
			booklist = { ...booklist, items };
		}

		this.sessionDomain.crossBookMode = true;

		// 尝试恢复已有会话
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



			const restored =
				await this.sessionDomain.restoreSession(savedSessionId);
			if (restored) {
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
		// 补全 items：优先用已存的 bookNames，fallback 到 indexes 查找
		const items = booklist.bookIds.map((id, i) => {
			const idx = this.bookDomain.indexes.find((ix) => ix.id === id);
			const name = stripFileExtension(
				idx?.pdf_name || booklist.bookNames?.[i] || id,
			);
			return { id, name, author: idx?.author };
		});
		const restored = { ...booklist, items };
		this.bookDomain.restoreBooklist(restored);
	}

	/**
	 * 自动同步当前章节到上下文
	 *
	 * 默认行为：
	 * - 首次打开章节时，自动加载到上下文
	 * - 切换章节时，自动更新为新章节
	 * - 只有用户手动点击按钮才能卸载文档
	 */
	private async autoSyncCurrentChapter(): Promise<void> {
		if (!this.chatDocumentService || !this.bookDomain.currentPdfName) return;

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== "md") return;

		// 检查当前文件是否属于正在阅读的书籍
		const bookPath = `DeepReader/${this.bookDomain.currentPdfName}/`;
		if (!activeFile.path.startsWith(bookPath)) return;

		// 排除书籍主文件（只加载章节文件）
		if (activeFile.path === `${bookPath}${this.bookDomain.currentPdfName}.md`)
			return;

		// 检查当前章节是否已在上下文中
		if (this.chatDocumentService.hasDocument(activeFile.path)) return;

		// 找到当前书籍的章节文档（source === 'current' 的文档）
		const docs = this.chatDocumentService.getLoadedDocuments();
		const currentChapterDoc = Array.from(docs.values()).find(
			(doc) => doc.source === "current" && doc.path.startsWith(bookPath),
		);

		if (currentChapterDoc) {
			// 卸载旧的章节
			this.chatDocumentService.removeDocument(currentChapterDoc.path);
			log(`[DeepPDF] 自动卸载旧章节: ${currentChapterDoc.name}`);
		}

		// 加载新的章节到上下文
		await this.chatDocumentService.loadByPath(activeFile.path, "current");
		log(`[DeepPDF] 自动加载章节: ${activeFile.basename}`);
	}

	/**
	 * 获取当前选中的索引 ID
	 */
	public getCurrentIndexId(): string | null {
		return this.bookDomain.currentIndexId;
	}

	public getCurrentBooklistId(): string | null {
		return this.bookDomain.currentBooklist?.id ?? null;
	}

	/** 索引列表（供 main.ts 等外部调用者使用） */
	get indexes(): import("../../types/index.js").IndexListItem[] {
		return this.bookDomain.indexes;
	}

	/**
	 * 通过书名选择索引（自动切换时使用）
	 */
	public async selectBookByName(bookName: string): Promise<void> {
		if (this.sessionDomain.crossBookMode) {
			this.sessionDomain.crossBookMode = false;
		}
		await this.bookDomain.selectBookByName(bookName);
	}

	/**
	 * 创建阅读顶栏 (简化版)
	 */
	private createReadingTopbar(container: HTMLElement) {
		this.readingTopbar = new ReadingTopbar({
			onOpenLibrary: () => this.bookDomain.openLibrary(),
			onOpenSettings: () => {
				// 打开设置并定位到 DeepPDF 插件
				const setting = (this.app as any).setting;
				if (setting) {
					setting.open();
					setting.openTabById(this.plugin.manifest.id);
				}
			},
			onCoverClick: async () => {
				const service = this.plugin.readingModeService;
				if (!service) return;
				const opened = await service.openMostRecent();
				if (!opened) {
					// 无最近阅读历史：fallback 到书库
					this.bookDomain.openLibrary();
				}
			},
			onExitBooklist: () => this.exitBooklist(),
			onBooklistRename: (newName: string) => {
				this.bookDomain.renameBooklist(newName);
			},
			onToggleReadingTTS: () => this.toggleReadingTTS(),
		});

		const el = this.readingTopbar.getElement();
		if (el) {
			container.appendChild(el);
		}
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("deeppdf-container");
		container.addClass("deeppdf-chat-container");

		// 设置聚焦模式变化监听（已移除）
		// this.setupFocusModeListener();

		// 直接渲染主 UI（不阻塞）
		this.renderMainUI(container);
	}

	/**
	 * 渲染主界面
	 */
	private async renderMainUI(container: HTMLElement): Promise<void> {
		container.empty();
		this.chatContainerEl = container;

		this.registerEvent(
			this.eventBus.on("chat:documents-changed", ({ documents }) => {
				// 同步文档内容到 currentMarkdownFiles 供 Agent 搜索使用
				const files: Record<string, string> = {};
				for (const doc of documents) {
					files[doc.path] = doc.content;
				}
				this.sessionDomain.currentMarkdownFiles = files;

				// 更新加载按钮的激活状态（检查当前活跃文件是否已加载）
				const activeFile = this.app.workspace.getActiveFile();
				const isCurrentDocLoaded = activeFile
					? documents.some((d) => d.path === activeFile.path)
					: false;
				this.chatInput?.setLoadBtnActive(isCurrentDocLoaded);
				// 更新消息列表的底部间距，避免被上下文标签遮挡
				this.updateMessageListPadding(documents.length > 0);
			}),
		);

		// 创建阅读顶栏（有消息时提供书名/封面/设置入口）
		this.createReadingTopbar(container);

		// 奚童表情：用户活动重置 idle 计时器
		this.registerDomEvent(container, "mouseenter", () => {
			this.readingTopbar?.onMascotUserActivity();
		});
		this.registerDomEvent(container, "keydown", () => {
			this.readingTopbar?.onMascotUserActivity();
		});
		this.registerDomEvent(container, "click", () => {
			this.readingTopbar?.onMascotUserActivity();
		});

		// 创建消息列表区
		this.createMessageListSection(container);

		// 创建输入区
		this.createChatInputSection(container);

		// 移动端键盘适配：键盘弹起时收缩容器高度，避免输入框被遮挡
		this.setupMobileKeyboardAdaptation();

		// 加载索引列表
		await this.loadIndexes();

		// 恢复跨书籍模式状态
		await this.sessionDomain.restoreCrossBookMode();

		// 无书时自动进入阅读顾问模式
		if (!this.bookDomain.currentIndexId && !this.sessionDomain.crossBookMode) {
			await this.sessionDomain.restoreGeneralChatSession();
		}

		// 监听 URI 协议触发的索引切换事件
		// 自定义事件，Obsidian 类型定义不支持，使用 any 绕过
		const workspace = this.app.workspace as any;
		this.registerEvent(
			workspace.on("deeppdf:select-index", async (indexId: string) => {
				log("[DeepPDF] Received select-index event:", indexId);

				// 如果当前处于跨书籍模式，先切换回单书籍模式
				if (this.sessionDomain.crossBookMode) {
					log("[DeepPDF] 从阅读入口点击，自动关闭跨书籍模式");
					this.sessionDomain.crossBookMode = false;
					this.readingTopbar?.setCrossBookMode(false);
					this.plugin.settings.lastCrossBookMode = false;
					await this.plugin.saveSettings();

					// 取消任何正在进行的流式请求，避免旧回调更新新消息列表
					this.sessionDomain.cancelStream();

					// 清空跨书籍模式的消息，准备加载单书籍会话
					this.messageList?.clear();
				}

				// 直接调用 selectIndex 方法，确保顶栏正确更新
				await this.selectIndex(indexId);
			}),
		);

		// 监听阅读模式引用事件
		this.registerEvent(
			workspace.on(
				"deeppdf:quote-selection",
				async (
					metadata: import("../../components/chat-input/chat-input.js").QuoteMetadata,
				) => {
					log("[DeepPDF] Received quote-selection event");
					this.quoteManager.handleQuoteSelection(metadata);
				},
			),
		);

		this.registerEvent(
			workspace.on(
				"deeppdf:excerpt-selection",
				async (text: string, range: Range) => {
					log("[DeepPDF] Received excerpt-selection event");
					this.handleExcerptSelection(text, range);
				},
			),
		);

		// 监听文件切换事件，更新文档加载按钮状态 + 阅读进度追踪 + 自动同步章节上下文
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				if (this.chatDocumentService) {
					const activeFile = this.app.workspace.getActiveFile();
					const isLoaded = activeFile
						? this.chatDocumentService.hasDocument(activeFile.path)
						: false;
					this.chatInput?.setLoadBtnActive(isLoaded);
				}
				// 自动同步当前章节到上下文
				this.autoSyncCurrentChapter();
			}),
		);
	}

	/**
	 * 更新输入框 placeholder 反映引用数量
	 */
	private getQuotes(): QuoteItem[] {
		return this.quoteManager.getQuotes();
	}

	/**
	 * 处理摘录选中文字（阅读模式中的摘录）
	 * 保存位置：书籍摘录/{书名}/摘录-{日期}.md
	 * 链接：链接到章节文件，精确到 block id
	 */
	private handleExcerptSelection(text: string, range: Range): void {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("没有打开的文件");
			return;
		}

		// 从文件的 frontmatter 或路径中提取书籍信息
		const cache = this.app.metadataCache.getFileCache(activeFile);
		let bookName = cache?.frontmatter?.pdf_name || "";
		const indexId = String(
			cache?.frontmatter?.index_id || cache?.frontmatter?.pdf_index_id || "",
		);

		// 如果没有从 frontmatter 获取到书名，从路径提取
		if (!bookName) {
			const pathParts = activeFile.path.split("/");
			// 假设路径格式是 DeepReader/{书名}/章节.md 或 {书名}/章节.md
			if (pathParts.length >= 2) {
				if (pathParts[0] === "DeepReader") {
					bookName = pathParts[1];
				} else {
					bookName = pathParts[0];
				}
			} else {
				bookName = activeFile.basename;
			}
		}

		// 获取选中文字所在的 block id
		const blockId = findBlockIdFromRange(range, activeFile.path, this.app);
		log("[DeepPDF] Found block id for excerpt:", blockId);

		// 构建元数据
		const metadata: ExcerptMetadata = {
			sourcePdf: bookName,
			createdAt: new Date().toISOString(),
			sourceType: "reading",
			chapterPath: activeFile.path,
			chapterName: activeFile.basename,
			blockId: blockId || undefined,
			excerptType: "excerpt",
		};

		const modal = new ExcerptModal({
			app: this.app,
			content: { text },
			metadata,
			excerptService: this.plugin.getExcerptService?.(),
			onSave: async (path: string) => {
				new Notice(`摘录已保存到 ${path}`);
				// 摘录成功后，在阅读界面标记文本（添加虚线下划线）
				this.markExcerptText(range);
			},
		});
		modal.open();
	}

	/**
	 * 在阅读界面标记摘录文本（添加虚线下划线）
	 */
	private markExcerptText(range: Range): void {
		try {
			const excerptMark = document.createElement("mark");
			excerptMark.setAttribute("data-excerpt", "true");

			// 使用 extractContents 和 insertNode 来包装选中内容
			const fragment = range.extractContents();
			excerptMark.appendChild(fragment);
			range.insertNode(excerptMark);

			log("[DeepPDF] Marked excerpt text with dotted underline");
		} catch (err) {
			log("[DeepPDF] Failed to mark excerpt text:", err);
		}
	}

	/**
	 * 创建消息列表区
	 */
	private createMessageListSection(container: HTMLElement) {
		const self = this;
		const section = container.createDiv({
			cls: "deeppdf-message-list-section",
		});

		// 创建消息列表组件
		this.messageList = new MessageList(
			{
				onRegenerate: (messageId: string) => {
					this.sessionDomain.handleRegenerate(messageId);
				},
				onCopy: (messageId: string) => {
					const message = this.messageList?.getMessage(messageId);
					const content = message?.getData().content;
					if (content) {
						_copyToClipboard(content);
					}
				},
				onQuestionClick: (question: string) => {
					this.sessionDomain.handleQuestionClick(question);
				},
				onGenerateOutline: () => {
					this.sessionDomain.handleGenerateOutline();
				},
				onGuidanceClick: (type: GuidanceType) => {
					this.sessionDomain.handleGuidanceClick(type);
				},
				onExcerpt: (
					messageId: string,
					content: ExcerptContent,
					metadata: ExcerptMetadata,
				) => {
					const message = this.messageList?.getMessage(messageId);
					const data = message?.getData();
					if (data?.pdfName) {
						metadata.sourcePdf = data.pdfName;
					}
					metadata.sourceType = "chat";
					delete (metadata as any).chapterPath;
					delete (metadata as any).chapterName;
					const modal = new ExcerptModal({
						content,
						metadata,
						app: this.app,
						onSave: (path: string) => {
							new Notice(`摘录已保存到 ${path}`);
						},
					});
					modal.open();
				},
				onQuote: (
					metadata: import("../../components/chat-input/chat-input.js").QuoteMetadata,
				) => {
					this.quoteManager.handleQuoteSelection(metadata);
				},
				onDelete: (messageId: string) => {
					new ConfirmModal(
						this.app,
						"删除对话",
						"此操作不可撤销",
						() => {
							this.sessionDomain.handleDeleteMessagePair(messageId);
							this.messageList?.removeMessage(messageId);
						},
					).open();
				},
				onTTS: async (messageId: string, content: string) => {
					// 喇叭按钮始终直接朗读原文，不走摘要模式
					this.ttsDomain.speak(messageId, content);
				},
				onStreamingEnd: (messageId: string, content: string) => {
					this.ttsDomain.preloadPreview(messageId, content, {
						indexId: this.bookDomain.currentIndexId || undefined,
						pdfName: this.bookDomain.getDisplayName(this.bookDomain.currentPdfName || '') || undefined,
						author: this.bookDomain.currentBookAuthor || undefined,
					});
				},
				getCurrentBookInfo: () => ({
					coverUrl: this.bookDomain.currentBookCoverUrl,
					author: this.bookDomain.currentBookAuthor,
					bookName: this.bookDomain.currentPdfName,
				}),
			},
			this.app,
		);

		const messageListEl = this.messageList.getElement();
		if (messageListEl) {
			section.appendChild(messageListEl);
		}

		// 创建 ChatPresenter，将 domain 事件映射到 UI
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
		});

		// 注意：引用卡片容器已移至 createChatInputSection
	}

	/**
	 * 创建聊天输入区
	 */
	private createChatInputSection(container: HTMLElement) {
		const section = container.createDiv({ cls: "deeppdf-chat-input-section" });

		// 创建聊天输入组件（在最上方）
		// 检查是否可启用语音输入（需要 MiMo API Key）
		const ttsConfig = resolveRoleConfig("tts", this.plugin.settings);
		const chatConfig = resolveRoleConfig("chat", this.plugin.settings);

		// 创建聊天输入组件（在最上方）
		this.chatInput = new ChatInput({
			placeholder: Platform.isMobile ? "长按说话，或输入文字" : "输入以开始对话...",
			onSend: (message: string, _chatInputQuotes) => {
				// 使用 sidebar 自己管理的引用列表（而非 ChatInput 内部的空数组）
				this.sessionDomain.sendUserMessage(message, this.quoteManager.getQuotes());
			},
			app: this.app,
			onStop: () => {
				this.sessionDomain.stopGeneration();
			},
			onHeightChange: (height: number) => {
				// 动态调整消息列表的底部间距（包含引用卡片高度）
				const quotesHeight = this.quotesContainer?.offsetHeight || 0;
				this.messageList?.updateBottomPadding(height, quotesHeight);
			},
			onLoadCurrentDoc: async () => {
				await this.loadCurrentDocument();
			},
			onUnloadCurrentDoc: async () => {
				await this.unloadCurrentDocument();
			},
			onVoiceStart: ttsConfig && chatConfig
				? () => this.startVoiceRecording()
				: undefined,
			onVoiceStop: ttsConfig && chatConfig
				? () => this.stopVoiceRecording()
				: undefined,
			onVoiceCancel: ttsConfig && chatConfig
				? () => this.cancelVoiceRecording()
				: undefined,
		});

		// 创建引用卡片容器（在输入框上方）
		this.quotesContainer = section.createDiv({
			cls: "deeppdf-quotes-container",
		});
		// 接线 QuoteManager：告诉它往哪里渲染卡片。
		// 311b3a61 refactor 误删了这个调用，导致引用卡片永远不出现，
		// UI 上仅显示 placeholder 文字"已引用 N 段文字..."。
		this.quoteManager.setContainer(this.quotesContainer);

		const chatInputEl = this.chatInput.getElement();
		if (chatInputEl) {
			section.appendChild(chatInputEl);
		}
	}

	/**
	 * 移动端长按触发 Push-to-Talk
	 * 开始语音录音
	 */
	private startVoiceRecording(): void {
		const ttsConfig = resolveRoleConfig("tts", this.plugin.settings);
		const chatConfig = resolveRoleConfig("chat", this.plugin.settings);
		if (!ttsConfig || !chatConfig || !this.chatInput) return;

		if (!this.pushToTalkCtrl) {
			this.pushToTalkCtrl = new PushToTalkController(
				this.chatInput,
				{
					asrApiKey: ttsConfig.apiKey,
					asrBaseUrl: ttsConfig.baseUrl,
					llmApiKey: chatConfig.apiKey,
					llmBaseUrl: chatConfig.baseUrl,
				},
				{
					onStateChange: (state) => {
						// 状态变化由 ChatInput.setVoiceState 处理
					},
					onTextReady: (text) => {
						// 文本已通过 chatInput.setValue 填入
					},
					onError: (error) => {
						new Notice(`语音输入失败: ${error.message}`);
					},
				},
			);
		}

		this.pushToTalkCtrl.start();
	}

	/**
	 * 停止语音录音并识别发送
	 */
	private stopVoiceRecording(): void {
		if (!this.pushToTalkCtrl) return;

		const bookContext = this.bookDomain.getCurrentBookInfo();
		this.pushToTalkCtrl.stop(bookContext ? {
			title: bookContext.title || '未知书籍',
			description: bookContext.docDescription || undefined,
		} : undefined);
	}

	/**
	 * 取消语音录音（直接丢弃，不做识别）
	 */
	private cancelVoiceRecording(): void {
		if (!this.pushToTalkCtrl) return;
		this.pushToTalkCtrl.cancel();
	}

	/**
	 * 长按时 start 录音，touchend 时 stop 识别+重写
	 */
	private startPushToTalk(): void {
		const ttsConfig = resolveRoleConfig("tts", this.plugin.settings);
		const chatConfig = resolveRoleConfig("chat", this.plugin.settings);
		if (!ttsConfig || !chatConfig || !this.chatInput) return;

		if (!this.pushToTalkCtrl) {
			this.pushToTalkCtrl = new PushToTalkController(
				this.chatInput,
				{
					asrApiKey: ttsConfig.apiKey,
					asrBaseUrl: ttsConfig.baseUrl,
					llmApiKey: chatConfig.apiKey,
					llmBaseUrl: chatConfig.baseUrl,
				},
				{
					onStateChange: (state) => {
						// 状态变化由 ChatInput.setVoiceState 处理
					},
					onTextReady: (text) => {
						// 文本已通过 chatInput.setValue 填入
					},
					onError: (error) => {
						new Notice(`语音输入失败: ${error.message}`);
					},
				},
			);
		}

		// 长按触发时直接 start
		this.pushToTalkCtrl.start();

		// 监听 touchend 触发 stop
		const textarea = this.chatInput.getElement()?.querySelector('textarea');
		if (textarea) {
			const handleTouchEnd = () => {
				textarea.removeEventListener('touchend', handleTouchEnd);
				const bookInfo = this.bookDomain.getCurrentBookInfo();
				this.pushToTalkCtrl?.stop(bookInfo ? {
					title: bookInfo.title || '未知书籍',
					description: bookInfo.docDescription || undefined,
				} : undefined);
			};
			textarea.addEventListener('touchend', handleTouchEnd, { once: true });
		}
	}

	/**
	 * 移动端键盘适配
	 * 监听 visualViewport，键盘弹起时收缩聊天容器高度，
	 * 使钉底的输入框自然位于键盘上方，避免被遮挡。
	 * 仅移动端启用，桌面端为空操作。
	 */
	private setupMobileKeyboardAdaptation(): void {
		if (!Platform.isMobile) return;
		if (!this.chatContainerEl) return;
		const vv = window.visualViewport;
		if (!vv) return;

		const container = this.chatContainerEl;
		// 视口高度差超过此阈值视为键盘弹起（过滤地址栏伸缩等微小变化）
		const KEYBOARD_THRESHOLD = 100;
		let lastApplied = "__init__";

		const update = () => {
			const keyboardHeight = window.innerHeight - vv.height;
			const raised = keyboardHeight > KEYBOARD_THRESHOLD;
			
			let target = "";
			if (raised) {
				const containerTop = container.getBoundingClientRect().top + window.scrollY;
				const viewportTop = vv.offsetTop || 0;
				const usableTop = Math.max(0, containerTop - viewportTop);
				target = `${vv.height - usableTop}px`;
			}

			if (target === lastApplied) return;
			container.style.height = target;
			lastApplied = target;

			// 当键盘弹起时，确保当前聚焦的输入框滚动到视口中
			if (raised && document.activeElement && container.contains(document.activeElement)) {
				setTimeout(() => {
					const inputSection = container.querySelector('.deeppdf-chat-input-section');
					inputSection?.scrollIntoView({ block: "end", behavior: "smooth" });
				}, 300);
			}
		};

		vv.addEventListener("resize", update);
		vv.addEventListener("scroll", update);
		update();

		this.mobileKeyboardCleanup = () => {
			vv.removeEventListener("resize", update);
			vv.removeEventListener("scroll", update);
			container.style.height = "";
		};
	}

	/**
	 * 加载当前文档到上下文
	 */
	private async loadCurrentDocument(): Promise<void> {
		if (!this.chatDocumentService) return;

		const doc = await this.chatDocumentService.loadCurrentDocument();
		if (doc) {
			// new Notice(`已加载: ${doc.name}`);
		}
	}

	/**
	 * 从上下文卸载当前文档
	 */
	private async unloadCurrentDocument(): Promise<void> {
		if (!this.chatDocumentService) return;

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		this.chatDocumentService.removeDocument(activeFile.path);
	}

	/**
	 * 切换深度思考模式
	 */
	public async toggleDeepSearchMode(): Promise<void> {
		this.sessionDomain.useLLMTreeSearch = !this.sessionDomain.useLLMTreeSearch;
		const modeText = this.sessionDomain.useLLMTreeSearch
			? "深度思考模式已开启"
			: "深度思考模式已关闭";
		new Notice(modeText);
		log(`[DeepPDF] toggleDeepSearchMode: ${modeText}`);
		// 持久化设置
		this.plugin.settings.lastDeepSearchMode = this.sessionDomain.useLLMTreeSearch;
		await this.plugin.saveSettings();
	}

	// ==================== 消息处理 ====================

	/** 从外部发送消息 */
	public async sendMessageWithInput(message: string): Promise<void> {
		await this.sessionDomain.sendUserMessageWithInput(message);
	}

	/**
	 * 更新消息列表的底部间距
	 * 当有上下文标签或引用卡片时，增加间距避免遮挡
	 */
	private updateMessageListPadding(hasContextTags: boolean): void {
		const messagesContainer = this.containerEl?.querySelector(
			".deeppdf-messages-container",
		) as HTMLElement;
		if (!messagesContainer) return;

		// 基础间距 110px + 上下文标签高度约 40px + 引用卡片高度
		const basePadding = 110;
		const contextTagsHeight = hasContextTags ? 44 : 0;
		const quotesHeight = this.quotesContainer?.offsetHeight || 0;

		messagesContainer.style.paddingBottom = `${basePadding + contextTagsHeight + quotesHeight}px`;
	}

	async loadIndexes(): Promise<void> {
		await this.bookDomain.loadIndexes();
	}

	/**
	 * 显示错误消息
	 */
	private showError(message: string): void {
		new Notice(message);
		logError("[DeepPDF]", message);
	}

	async onClose() {
		try {
			// 清理移动端键盘适配监听
			if (this.mobileKeyboardCleanup) {
				this.mobileKeyboardCleanup();
				this.mobileKeyboardCleanup = null;
			}
			this.chatContainerEl = null;

			if (this.sessionDomain.currentStreamController) {
				this.sessionDomain.cancelStream();
			}

			// 清理 TTS 服务
			if (this.ttsDomain) {
				try {
					this.ttsDomain.destroy();
				} catch (e) {
					warn("[DeepPDF] Error stopping TTS service:", e);
				}
			}

			// 清理 Presenter
			if (this.chatPresenter) {
				try {
					this.chatPresenter.dispose();
					this.chatPresenter = null;
				} catch (e) {
					warn("[DeepPDF] Error disposing chat presenter:", e);
				}
			}

			// 清理消息列表
			if (this.messageList) {
				try {
					this.messageList.destroy();
				} catch (e) {
					warn("[DeepPDF] Error destroying messageList:", e);
				}
				this.messageList = null;
			}

			// 清理聊天输入
			if (this.chatInput) {
				try {
					this.chatInput.destroy();
				} catch (e) {
					warn("[DeepPDF] Error destroying chatInput:", e);
				}
				this.chatInput = null;
			}

			// 清理语音输入控制器
			if (this.voiceInputCtrl) {
				try {
					this.voiceInputCtrl.destroy();
				} catch (e) {
					warn("[DeepPDF] Error destroying voiceInputCtrl:", e);
				}
				this.voiceInputCtrl = null;
			}

			// 清理 Push-to-Talk 控制器
			if (this.pushToTalkCtrl) {
				try {
					this.pushToTalkCtrl.destroy();
				} catch (e) {
					warn("[DeepPDF] Error destroying pushToTalkCtrl:", e);
				}
				this.pushToTalkCtrl = null;
			}

			// 清理 EventBus 订阅
			this.eventBus.dispose();

			// 清理任务卡片
			try {
				this.taskCards.clear();
			} catch (e) {
				warn("[DeepPDF] Error clearing taskCards:", e);
			}

			// 清理索引管理器
			if (this.readingTopbar) {
				try {
					this.readingTopbar.destroy();
				} catch (e) {
					warn("[DeepPDF] Error destroying readingTopbar:", e);
				}
				this.readingTopbar = null;
			}
		} catch (error) {
			logError("[DeepPDF] Error in onClose:", error);
			// 不要重新抛出错误，避免影响 Obsidian 的 UI
		}
	}

	/**
	 * 获取当前书籍信息（供调试命令使用）
	 */
	getCurrentBookInfo(): {
		title: string | null;
		page_count: number;
		docDescription: string | null;
	} {
		return this.bookDomain.getCurrentBookInfo();
	}
}
