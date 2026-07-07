/**
 * 阅读模式编排器
 * 管理章节文件的书籍化阅读体验 — 创建并编排 SelectionToolbar/ChapterNav/PagePaginator 的完整生命周期
 * （聊天组件由 ChatWidgetCoordinator 托管，页码记忆由 PageMemoryStore 托管，章节识别/导航由 ChapterDetection/ChapterNavigator 托管）
 */

import {
	type App,
	TFile,
	type EventRef,
	MarkdownView,
} from "obsidian";
import type { DeepPDFSettings } from "../../config/settings.js";
import type { HighlightColorId } from "../../types/highlight.js";
import type { QuoteMetadata } from "../../types/quote.js";
import { serviceLog } from "../../utils/logger.js";
import { SIDEBAR_VIEW_TYPE } from "../../views/sidebar/sidebar-view.js";
import { ChapterNav } from "./chapter-nav.js";
import type { ChapterNavOptions } from "./chapter-nav.js";
import { ChapterDetection } from "./chapter-detection.js";
import type { ChapterNavigation } from "./chapter-detection.js";
import { ChapterNavigator } from "./chapter-navigator.js";
import { PageMemoryStore } from "./page-memory-store.js";
import { ChatWidgetCoordinator } from "./chat-widget-coordinator.js";
import type { PagePaginator } from "./page-paginator.js";
import { PaginationCoordinator } from "./pagination-coordinator.js";
import {
	installScrollPatch,
	uninstallScrollPatch,
	type ScrollPatchService,
} from "./scroll-patch.js";
import { SelectionToolbar } from "./selection-toolbar.js";
import type { SelectionToolbarOptions } from "./selection-toolbar.js";

export interface ReadingModeCallbacks {
	onQuote: (metadata: QuoteMetadata) => void;
	onExcerpt: (text: string, range: Range) => void; // 添加 range 参数
	onSaveHighlight?: (text: string, color: HighlightColorId) => Promise<void>;
	onRemoveHighlight?: (text: string) => Promise<void>;
	onBookDetected?: (indexId: string, bookName: string) => void; // 检测到书籍章节时回调
	onDeactivate?: () => void; // 阅读模式停用时回调
	onStopReadingTTS?: () => void; // 翻页/切章/关闭时停止原文朗读
	onQuickQuestion?: (question: string) => Promise<void>;
	onRevealSidebar?: () => void;
}

export type { ChapterNavigation } from "./chapter-detection.js";

export class ReadingModeService implements ScrollPatchService {
	private app: App;
	/**
	 * 是否处于激活态。供 `ScrollPatchService` 接口读取，外部请勿直接修改
	 * （由 `activate()` / `deactivate()` 内部控制）。
	 */
	public isActive: boolean = false;
	private currentFile: TFile | null = null;
	/**
	 * 记录当前阅读模式所在 leaf 的 containerEl。
	 * 供 `ScrollPatchService` 接口读取以判断 scrollIntoView 目标是否归属本 service，
	 * 同时 `getActiveContainerEl()` 公开方法供外部使用。外部请勿直接修改。
	 */
	public activeContainerEl: HTMLElement | null = null;
	private fileOpenHandler: EventRef | null = null;
	private selectionToolbar: SelectionToolbar | null = null;
	private chapterNav: ChapterNav | null = null;
	private chapterDetection: ChapterDetection;
	private chapterNavigator: ChapterNavigator;
	private paginationCoordinator: PaginationCoordinator;
	private callbacks: ReadingModeCallbacks | null = null;
	private autoEnable: boolean = true;
	private style: "paginated" | "scrolling" = "paginated";
	private currentBookName: string = "";
	private pendingRetry: ReturnType<typeof setTimeout> | null = null;
	/** 已激活分页阅读模式的书籍名（同书新章节不重复激活） */
	private activatedBookForReading: string = "";
	/** 页码记忆存储（已抽到 PageMemoryStore 深模块） */
	private pageMemoryStore: PageMemoryStore;
	private _pluginId: string;
	/** 跨章回退标记：从后一章按 ← 时，前一章应恢复到最后一页 */
	private _jumpToLastPage: boolean = false;

	private chatWidget: ChatWidgetCoordinator;
	private layoutChangeHandler: EventRef | null = null;
	private resizeHandler: EventRef | null = null;

	constructor(
		app: App,
		callbacks: ReadingModeCallbacks | undefined,
		pluginId: string,
	) {
		this.app = app;
		this.callbacks = callbacks || null;
		this._pluginId = pluginId;
		this.pageMemoryStore = new PageMemoryStore(app, pluginId, () => this.paginationCoordinator.getPaginator()?.getTotalPages());
		this.chapterDetection = new ChapterDetection(this.app, () => this.currentFile);
		this.chapterNavigator = new ChapterNavigator({
			app: this.app,
			getChapterNavigation: () => this.getChapterNavigation(),
			// 闭包读取实时 callbacks，确保 setCallbacks 替换后仍能命中最新回调
			onStopReadingTTS: () => {
				this.callbacks?.onStopReadingTTS?.();
			},
			setJumpToLastPage: (value: boolean) => {
				this._jumpToLastPage = value;
			},
		});
		this.chatWidget = new ChatWidgetCoordinator(this.app, {
			getIsActive: () => this.isActive,
			getActiveContainerEl: () => this.activeContainerEl,
			// 闭包读实时 callbacks，确保 setCallbacks 替换后仍命中最新
			onQuickQuestion: (question: string) =>
				this.callbacks?.onQuickQuestion?.(question) ?? Promise.resolve(),
			onRevealSidebar: () => {
				this.callbacks?.onRevealSidebar?.();
			},
			sidebarViewType: SIDEBAR_VIEW_TYPE,
		});

		// 分页生命周期编排器：注入式解耦翻章 / 章节识别 / 页码记忆 / 共享态 R2
		this.paginationCoordinator = new PaginationCoordinator({
			getActiveContainerEl: () => this.getActiveContainerEl(),
			getCurrentFile: () => this.currentFile,
			getBookName: () => this.currentBookName,
			isActive: () => this.isActive,
			extractChapterName: () => this.extractChapterName(),
			navigateToPrev: () => this.navigateToPrev(),
			navigateToNext: () => this.navigateToNext(),
			getChapterNavigation: () => this.getChapterNavigation(),
			recordPage: (filePath, page) => this.recordPage(filePath, page),
			getSavedPage: (filePath) => this.pageMemoryStore.getPage(filePath),
			getPluginSettings: () => this.pluginSettings,
			onStopReadingTTS: () => this.callbacks?.onStopReadingTTS?.(),
			getJumpToLastPage: () => this._jumpToLastPage,
			clearJumpToLastPage: () => {
				this._jumpToLastPage = false;
			},
		});
	}

	/**
	 * 设置回调函数
	 */
	setCallbacks(callbacks: ReadingModeCallbacks): void {
		this.callbacks = callbacks;
		// 如果工具栏已初始化，需要重新创建以使用新回调
		if (this.selectionToolbar) {
			this.selectionToolbar.destroy();
			this.initSelectionToolbar();
		}
	}

	/**
	 * 设置是否自动启用阅读模式
	 */
	setAutoEnable(value: boolean): void {
		this.autoEnable = value;
	}

	/**
	 * 获取已激活阅读模式的 containerEl（用于判断当前 tab 是否为关联 tab）
	 */
	getActiveContainerEl(): HTMLElement | null {
		return this.activeContainerEl;
	}

	/**
	 * 获取当前页的纯文本内容（委托给 PagePaginator）
	 */
	getCurrentPageText(): string {
		return this.paginationCoordinator.getCurrentPageText();
	}

	getCurrentPage(): number {
		return this.paginationCoordinator.getCurrentPage();
	}

	getPageParagraphs(pageNumber?: number): { element: HTMLElement; text: string }[] {
		return this.paginationCoordinator.getPageParagraphs(pageNumber);
	}

	highlightElement(el: HTMLElement): void {
		this.paginationCoordinator.highlightElement(el);
	}

	clearHighlight(): void {
		this.paginationCoordinator.clearHighlight();
	}

	nextPage(): boolean {
		return this.paginationCoordinator.nextPage();
	}

	/**
	 * 获取自动启用状态
	 */
	getAutoEnable(): boolean {
		return this.autoEnable;
	}

	/**
	 * 设置阅读模式样式（分页/滚动）
	 * 如果当前已激活，立即切换
	 */
	setStyle(style: "paginated" | "scrolling"): void {
		this.style = style;
		// 如果当前已激活，重新激活以应用新样式
		if (this.isActive && this.currentFile) {
			const file = this.currentFile;
			this.deactivate();
			this.activate(file);
		}
	}

	/**
	 * 获取当前阅读模式样式
	 */
	getStyle(): "paginated" | "scrolling" {
		return this.style;
	}

	/**
	 * 读取自身插件设置。通过 Obsidian 内部 plugins 映射反射访问
	 * （ReadingModeService 未持有 plugin 引用），集中在此处便于将来改为注入式。
	 */
	private get pluginSettings(): DeepPDFSettings | undefined {
		return (this.app as any).plugins?.plugins?.[this._pluginId]?.settings;
	}

	/**
	 * 获取当前是否处于双页阅读模式
	 */
	isDualPageMode(): boolean {
		return this.paginationCoordinator.isDualPageMode();
	}

	/**
	 * 初始化悬浮工具栏
	 */
	private initSelectionToolbar(): void {
		if (!this.callbacks) {
			serviceLog("[ReadingMode] No callbacks set, skipping toolbar init");
			return;
		}

		this.selectionToolbar = new SelectionToolbar({
			app: this.app,
			onQuote: this.callbacks.onQuote,
			onExcerpt: this.callbacks.onExcerpt,
			onSaveHighlight: this.callbacks.onSaveHighlight,
			onRemoveHighlight: this.callbacks.onRemoveHighlight,
		});
		this.selectionToolbar.init();
		serviceLog("[ReadingMode] Selection toolbar initialized");
	}

	/**
	 * 判断文件是否为 DeepReader 章节文件
	 * 条件：
	 * 1. 必须是 Markdown 文件
	 * 2. 路径以 DeepReader/ 开头
	 * 3. frontmatter 中必须包含 source 字段（书籍标识）
	 */
	isChapterFile(file: TFile): boolean {
		return this.chapterDetection.isChapterFile(file);
	}

	/**
	 * 从文件中提取书籍名称（用于同书判断）
	 */
	private getBookNameFromFile(file: TFile): string {
		return this.chapterDetection.getBookNameFromFile(file);
	}

	/**
	 * 激活阅读模式
	 */
	activate(file: TFile, retryCount = 0): void {
		// 如果是同一文件，将对应 leaf 激活到前台即可
		if (this.isActive && this.currentFile?.path === file.path) {
			const existingLeaf = this.app.workspace
				.getLeavesOfType("markdown")
				.find(
					(l) =>
						(l.view as import("obsidian").MarkdownView)?.file?.path ===
						file.path,
				);
			if (existingLeaf) {
				this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
			}
			return;
		}

		// 先清理旧状态（移除旧 containerEl 上的 CSS 类、销毁旧分页器等）
		this.deactivate();

		serviceLog("[DeepPDF] ReadingMode activating for:", file.path);

		// 查找包含目标文件的 markdown view（不依赖 activeLeaf）
		const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
		const targetLeaf = markdownLeaves.find(
			(l) => (l.view as MarkdownView)?.file?.path === file.path,
		);
		const view = targetLeaf?.view as MarkdownView | undefined;

		if (!view) {
			if (retryCount >= 10) {
				serviceLog(
					"[ReadingMode] MarkdownView still not ready after 10 retries, giving up",
				);
				return;
			}
			// 去重：取消上一个未执行的重试，只保留最新的
			if (this.pendingRetry) clearTimeout(this.pendingRetry);
			this.pendingRetry = setTimeout(() => {
				this.pendingRetry = null;
				this.activate(file, retryCount + 1);
			}, 300);
			return;
		}

		// 立即销毁旧分页器（含底栏 DOM），防止新旧书籍信息叠加
		this.paginationCoordinator.destroyPaginator();

		this.currentFile = file;
		this.isActive = true;
		this.activatedBookForReading = this.getBookNameFromFile(file);

		// 切换到阅读视图
		this.switchToReadingView();

		// 添加阅读模式 CSS 类到当前 leaf 的 containerEl，避免全局污染
		this.activeContainerEl = view.containerEl;
		view.containerEl.classList.add("deeppdf-reading-mode");
		if (this.style === "paginated") {
			view.containerEl.classList.add("deeppdf-paginated");
		}

		// 延迟初始化分页器，等待视图渲染完成（仅分页模式）
		if (this.style === "paginated") {
			setTimeout(() => {
				serviceLog("[DeepPDF] ReadingMode: initializing paginator");

				this.paginationCoordinator.initPaginator();
			}, 200);

			// 拦截 scrollIntoView，修复 multi-column 布局下的 blockId 跳转
			// 使用引用计数模块：多 service 并存时安全，最后一个卸载时还原 native
			installScrollPatch(this);

			// 监听 hashchange，处理 blockId 跳转（双重保险）
			this.paginationCoordinator.setupHashChangeHandler();
		}

		// 通知书籍检测回调
		this.notifyBookDetected(file);

		// 初始化移动端浮动按钮
		this.chatWidget.initMobileFab();

		// 初始化/显示桌面端提问悬浮球
		this.chatWidget.updateVisibility();

		// 隐藏 Obsidian 移动端底部导航栏，最大化阅读区域
		this.chatWidget.toggleMobileNavbar(false);

		serviceLog("[ReadingMode] Activated for:", file.path);
	}

	/**
	 * 通知检测到书籍章节
	 */
	private notifyBookDetected(file: TFile): void {
		if (!this.callbacks?.onBookDetected) return;

		// 从文件的 frontmatter 获取 index_id 或 pdf_index_id
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		const indexId = String(
			frontmatter?.index_id || frontmatter?.pdf_index_id || "",
		);

		// 从 frontmatter 或路径提取书名
		const bookName = this.getBookNameFromFile(file);

		// 只要有书名就可以尝试切换（即使没有 index_id，也可以通过书名查找）
		if (bookName) {
			this.currentBookName = bookName;
			serviceLog(
				"[ReadingMode] Book detected:",
				bookName,
				"indexId:",
				indexId || "will search by name",
			);
			this.callbacks.onBookDetected(indexId, bookName);
		}
	}

	notifyChatStarted(): void {
		this.chatWidget.notifyChatStarted();
	}

	/** AI 回复到达（含出错）：若处于思考态则标记未读，并清除思考态 */
	notifyChatReplyReceived(): void {
		this.chatWidget.notifyChatReplyReceived();
	}

	/** 仅清除思考态，不产生未读副作用。用于 reset / 取消等重置场景 */
	clearChatThinking(): void {
		this.chatWidget.clearChatThinking();
	}

	/** TTS 朗读状态变化时驱动悬浮球朗读动效（message + reading 两路朗读统一入口） */
	setXitongReading(reading: boolean): void {
		this.chatWidget.setXitongReading(reading);
	}


	/**
	 * 获取当前视图的 .markdown-preview-view 元素（实际阅读区域）
	 */
	private getViewContent(): HTMLElement | null {
		if (this.activeContainerEl) {
			return this.activeContainerEl.querySelector(
				".markdown-preview-view",
			) as HTMLElement | null;
		}
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return view?.containerEl.querySelector(
			".markdown-preview-view",
		) as HTMLElement | null;
	}

	/**
	 * 切换当前 leaf 到阅读视图
	 */
	private switchToReadingView(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view && view.getMode() !== "preview") {
			view.setState(
				{ ...view.getState(), mode: "preview" },
				{ history: false },
			);
			serviceLog("[ReadingMode] Switched to reading view");
		}
	}

	/**
	 * 停用阅读模式
	 */
	deactivate(): void {
		if (!this.isActive) return;

		this.callbacks?.onStopReadingTTS?.();

		// 保存当前页码到记忆（含 lastReadAt 标记，触发持久化）
		if (this.currentFile) {
			this.paginationCoordinator.recordCurrentPage();
		}

		// 清理聊天组件（移动端 FAB + 桌面端提问悬浮球）
		this.chatWidget.destroy();

		this.paginationCoordinator.destroyPaginator();

		// 清理旧的章节导航 UI 元素（如果有）
		const oldNavElements = document.querySelectorAll(".deeppdf-chapter-nav");
		oldNavElements.forEach((el) => el.remove());

		// 恢复 scrollIntoView（引用计数归零时才真正还原 prototype）
		uninstallScrollPatch(this);

		// 清理 hashchange 监听
		this.paginationCoordinator.teardownHashChangeHandler();

		// 从记录的 containerEl 上移除 CSS 类（而非从当前 active view 移除，避免错误清理其他 tab）
		if (this.activeContainerEl) {
			this.activeContainerEl.classList.remove("deeppdf-reading-mode");
			this.activeContainerEl.classList.remove("deeppdf-paginated");
			this.activeContainerEl = null;
		}

		// 兼容处理：移除之前可能遗留在 body 上的类
		document.body.classList.remove("deeppdf-reading-mode");
		document.body.classList.remove("deeppdf-paginated");
		this.chapterNav?.hide();

		// 恢复 Obsidian 移动端底部导航栏
		this.chatWidget.toggleMobileNavbar(true);

		this.isActive = false;
		this.currentFile = null;

		// 通知外部清除 UI（如顶栏书名）
		this.callbacks?.onDeactivate?.();

		serviceLog("[ReadingMode] Deactivated");
	}

	/**
	 * 启动服务（监听文件打开事件）
	 */
	start(): void {
		serviceLog("[DeepPDF] ReadingMode service starting...");

		// 从磁盘加载上次阅读历史（fire-and-forget，启动不阻塞）
		this.loadLastPagesFromDisk();

		// 初始化悬浮工具栏
		if (this.callbacks) {
			this.initSelectionToolbar();
		}

		// 初始化章节导航
		this.initChapterNav();

		// 监听布局变更和窗口缩放事件以动态显示/隐藏桌面端提问悬浮球
		this.layoutChangeHandler = this.app.workspace.on("layout-change", () => {
			this.chatWidget.updateVisibility();
			if (this.paginationCoordinator.getPaginator()?.isActive()) {
				this.paginationCoordinator.updateLayout();
				setTimeout(() => {
					if (this.paginationCoordinator.getPaginator()?.isActive()) {
						this.paginationCoordinator.updateLayout();
					}
				}, 300);
			}
		});
		this.resizeHandler = this.app.workspace.on("resize", () => {
			this.chatWidget.updateVisibility();
			if (this.paginationCoordinator.getPaginator()?.isActive()) {
				this.paginationCoordinator.updateLayout();
			}
		});

		this.fileOpenHandler = this.app.workspace.on("file-open", (file) => {
			serviceLog("[DeepPDF] file-open event:", file?.path);
			if (file && this.isChapterFile(file)) {
				if (this.autoEnable) {
					const bookName = this.getBookNameFromFile(file);
					// Re-activate if: not active, different book, or different file (new chapter)
					const isDifferentFile = this.currentFile?.path !== file.path;
					if (
						!this.isActive ||
						this.activatedBookForReading !== bookName ||
						isDifferentFile
					) {
						this.activate(file);
					}
				}
			} else {
				this.deactivate();
				// 自动切回 edit 模式
				if (file && file.extension === "md") {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (view && view.getMode() !== "source") {
						view.setState(
							{ ...view.getState(), mode: "source" },
							{ history: false },
						);
						serviceLog("[ReadingMode] Switched to edit view (not a chapter file)");
					}
				}
			}
		});

		// 确保布局就绪后检查当前打开的文件
		const checkActiveFile = () => {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile && this.isChapterFile(activeFile) && this.autoEnable) {
				this.activate(activeFile);
			} else if (activeFile && activeFile.extension === "md") {
				// 否则自动切回 edit 模式
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view && view.getMode() !== "source") {
					view.setState(
						{ ...view.getState(), mode: "source" },
						{ history: false },
					);
					serviceLog("[ReadingMode] Switched to edit view on startup");
				}
			}
		};

		if (this.app.workspace.layoutReady) {
			checkActiveFile();
		} else {
			this.app.workspace.onLayoutReady(() => {
				checkActiveFile();
			});
		}

		// 插件启动时 metadataCache 可能未就绪，监听 resolved 事件重试
		this.app.metadataCache.on("resolved", () => {
			if (!this.isActive && this.autoEnable) {
				const file = this.app.workspace.getActiveFile();
				if (file && this.isChapterFile(file)) {
					serviceLog(
						"[ReadingMode] metadataCache resolved, activating for:",
						file.path,
					);
					this.activate(file);
				}
			}
		});

		// onLayoutReady 后再次检查，确保 workspace 已就绪且有足够延迟让 metadataCache 加载
		this.app.workspace.onLayoutReady(() => {
			if (!this.isActive && this.autoEnable) {
				const file = this.app.workspace.getActiveFile();
				if (file && this.isChapterFile(file)) {
					serviceLog("[ReadingMode] onLayoutReady, activating for:", file.path);
					this.activate(file);
				}
			}

			// 最终保底：延迟 1 秒后再次检查，确保 metadataCache 已完全加载
			setTimeout(() => {
				if (!this.isActive && this.autoEnable) {
					const file = this.app.workspace.getActiveFile();
					if (file && this.isChapterFile(file)) {
						serviceLog(
							"[ReadingMode] delayed retry, activating for:",
							file.path,
						);
						this.activate(file);
					}
				}
			}, 1000);
		});
	}

	/**
	 * 初始化章节导航
	 */
	private initChapterNav(): void {
		this.chapterNav = new ChapterNav({
			app: this.app,
			onNavigatePrev: () => this.navigateToPrev(),
			onNavigateNext: () => this.navigateToNext(),
			getNavigation: () => this.getChapterNavigation(),
			getPaginator: () => this.paginationCoordinator.getPaginator(),
			isActive: () => this.isActive,
		});
		this.chapterNav.init();
		serviceLog("[ReadingMode] Chapter navigation initialized");
	}

	/**
	 * 提取章节名称（去除编号前缀）
	 * 例如: "23 - 第十九章 如何阅读社会科学" -> "第十九章 如何阅读社会科学"
	 */
	private extractChapterName(): string {
		return this.chapterDetection.extractChapterName();
	}

	/**
	 * 从磁盘加载历史到内存 map（fire-and-forget 异步）
	 *
	 * 注意：加载完成前 pageMemory 为空 Map，activate() 中的页码恢复会静默跳过。
	 * 冷启动后用户在 ~100ms 内打开文件可能丢失恢复，但实际操作间隔通常远大于此。
	 */
	private loadLastPagesFromDisk(): void {
		this.pageMemoryStore.loadLastPagesFromDisk();
	}

	/**
	 * 记录页码 + 标记最近阅读时间 + 调度 debounced 持久化
	 */
	private recordPage(filePath: string, page: number): void {
		this.pageMemoryStore.recordPage(filePath, page);
	}

	/**
	 * 调度 debounced 持久化（200ms 内合并多次翻页）
	 */
	private scheduleSave(): void {
		this.pageMemoryStore.scheduleSave();
	}

	/**
	 * 立即保存到磁盘（取消 pending timer）
	 */
	async flushSave(): Promise<void> {
		return this.pageMemoryStore.flushSave();
	}

	/**
	 * 在指定文件夹下查找最近阅读的文件路径。
	 * 用于书库点击书籍时定位到上次阅读的章节。
	 * @param folderPath 书籍章节文件夹路径（如 "DeepReader/书名"）
	 * @returns 最近阅读的文件路径，或 null
	 */
	findMostRecentInFolder(folderPath: string): string | null {
		return this.pageMemoryStore.findMostRecentInFolder(folderPath);
	}

	/**
	 * 获取指定文件夹下最近阅读的时间戳。
	 * 用于书库按最近阅读时间排序。
	 * @param folderPath 书籍章节文件夹路径（如 "DeepReader/书名"）
	 * @returns 最近阅读的时间戳，如果没有阅读记录返回 0
	 */	getBookLastReadTime(folderPath: string): number {
		return this.pageMemoryStore.getBookLastReadTime(folderPath);
	}

	/**
	 * 打开最近阅读的书籍
	 * 找到 lastReadAt 最大的文件，激活其阅读模式（恢复上次页码）
	 * @returns true 表示找到并打开了；false 表示无历史或文件已删除
	 */
	async openMostRecent(): Promise<boolean> {
		const file = this.pageMemoryStore.resolveMostRecentFile();
		if (!file) return false;

		// 如果文件已在某个 tab 中打开，激活该 tab
		const existingLeaf = this.app.workspace
			.getLeavesOfType("markdown")
			.find(
				(l) =>
					(l.view as import("obsidian").MarkdownView)?.file?.path === file.path,
			);
		if (existingLeaf) {
			await this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
		} else {
			// 文件未在任何 tab 中打开，先打开它
			await this.app.workspace.getLeaf(false).openFile(file);
		}

		this.activate(file);
		return true;
	}

	/**
	 * 停止服务
	 */
	stop(): void {
		this.deactivate();
		// 立即落盘 pending 的页码更新（fire-and-forget）
		this.flushSave().catch((err) => {
			serviceLog("[ReadingMode] stop: flushSave failed:", err);
		});
		if (this.fileOpenHandler) {
			this.app.workspace.offref(this.fileOpenHandler);
			this.fileOpenHandler = null;
		}
		if (this.layoutChangeHandler) {
			this.app.workspace.offref(this.layoutChangeHandler);
			this.layoutChangeHandler = null;
		}
		if (this.resizeHandler) {
			this.app.workspace.offref(this.resizeHandler);
			this.resizeHandler = null;
		}
		// @ts-ignore — metadataCache.on 返回的 eventRef 用 offref 清理
		this.app.metadataCache.offref?.("resolved");
		if (this.selectionToolbar) {
			this.selectionToolbar.destroy();
			this.selectionToolbar = null;
		}
		if (this.chapterNav) {
			this.chapterNav.destroy();
			this.chapterNav = null;
		}
		this.paginationCoordinator.destroyPaginator();
	}

	/**
	 * 获取当前文件信息
	 */
	getCurrentFile(): TFile | null {
		return this.currentFile;
	}

	/**
	 * 获取分页器实例（供 ChapterNav 路由键盘事件）
	 */
	getPaginator(): PagePaginator | null {
		return this.paginationCoordinator.getPaginator();
	}

	/**
	 * 获取当前文件的 index_id
	 */
	getCurrentIndexId(): string | null {
		if (!this.currentFile) return null;
		const cache = this.app.metadataCache.getFileCache(this.currentFile);
		const raw = cache?.frontmatter?.index_id;
		return raw != null ? String(raw) : null;
	}

	/**
	 * 获取章节导航信息
	 */
	getChapterNavigation(): ChapterNavigation | null {
		return this.chapterDetection.getChapterNavigation();
	}

	/**
	 * 跳转到上一章（委托 ChapterNavigator）
	 */
	async navigateToPrev(): Promise<boolean> {
		return this.chapterNavigator.navigateToPrev();
	}

	/**
	 * 跳转到下一章（委托 ChapterNavigator）
	 */
	async navigateToNext(): Promise<boolean> {
		return this.chapterNavigator.navigateToNext();
	}

	/**
	 * 标记摘录文本（添加虚线下划线）
	 * @param range 选中的文本范围
	 */
	markExcerpt(range: Range): void {
		try {
			const excerptMark = document.createElement("mark");
			excerptMark.setAttribute("data-excerpt", "true");

			// 使用 extractContents 和 insertNode 来包装选中内容
			const fragment = range.extractContents();
			excerptMark.appendChild(fragment);
			range.insertNode(excerptMark);

			serviceLog("[DeepPDF] Marked excerpt text with dotted underline");
		} catch (err) {
			serviceLog("[DeepPDF] Failed to mark excerpt text:", err);
		}
	}

	/**
	 * 在 CSS multi-column 布局中滚动到目标元素。
	 * 由 `ScrollPatchService` 接口在 patched scrollIntoView 命中时被调用。
	 *
	 * 使用 getBoundingClientRect 计算元素在滚动内容中的绝对位置，
	 * 然后计算目标所在的"页"（列），设置 scrollLeft 跳转。
	 * 注意：需要使用双层 rAF 等待 CSS column 布局稳定后再计算位置。
	 *
	 * 公开访问但外部请勿直接调用（逻辑由 patcher 在路由时自动触发）。
	 */
	public scrollToElementInColumn(
		element: HTMLElement,
		scrollView: HTMLElement,
	): void {
		// 逻辑委托 PaginationCoordinator；Shell 保留此方法以满足 ScrollPatchService 契约
		this.paginationCoordinator.scrollToElementInColumn(element, scrollView);
	}
}
