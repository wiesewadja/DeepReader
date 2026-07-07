/**
 * 阅读模式编排器
 * 管理章节文件的书籍化阅读体验 — 创建并编排 SelectionToolbar/ChapterNav/PagePaginator 的完整生命周期
 * （聊天组件由 ChatWidgetCoordinator 托管，页码记忆由 PageMemoryStore 托管，章节识别/导航由 ChapterDetection/ChapterNavigator 托管）
 */

import {
	type App,
	TFile,
} from "obsidian";
import type { DeepPDFSettings } from "../../config/settings.js";
import type { HighlightColorId } from "../../types/highlight.js";
import type { QuoteMetadata } from "../../types/quote.js";
import { SIDEBAR_VIEW_TYPE } from "../../views/sidebar/sidebar-view.js";
import { ChapterDetection } from "./chapter-detection.js";
import type { ChapterNavigation } from "./chapter-detection.js";
import { ChapterNavigator } from "./chapter-navigator.js";
import { PageMemoryStore } from "./page-memory-store.js";
import { ChatWidgetCoordinator } from "./chat-widget-coordinator.js";
import type { PagePaginator } from "./page-paginator.js";
import { PaginationCoordinator } from "./pagination-coordinator.js";
import { ReadingModeLifecycle } from "./reading-mode-lifecycle.js";
import {
	type ScrollPatchService,
} from "./scroll-patch.js";

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
	 * 是否处于激活态。由 ReadingModeLifecycle 持有，Shell 以 getter 代理，
	 * 供 `ScrollPatchService` 接口读取（契约身份留在 Shell 实例上）。
	 */
	public get isActive(): boolean {
		return this.lifecycle.isActive;
	}
	/**
	 * 记录当前阅读模式所在 leaf 的 containerEl。
	 * 由 ReadingModeLifecycle 持有，Shell 以 getter 代理，供 `ScrollPatchService` 接口读取。
	 */
	public get activeContainerEl(): HTMLElement | null {
		return this.lifecycle.activeContainerEl;
	}
	private chapterDetection: ChapterDetection;
	private chapterNavigator: ChapterNavigator;
	private paginationCoordinator: PaginationCoordinator;
	private callbacks: ReadingModeCallbacks | null = null;
	private autoEnable: boolean = true;
	private style: "paginated" | "scrolling" = "paginated";
	/** 页码记忆存储（已抽到 PageMemoryStore 深模块） */
	private pageMemoryStore: PageMemoryStore;
	private _pluginId: string;
	/** 跨章回退标记：从后一章按 ← 时，前一章应恢复到最后一页 */
	private _jumpToLastPage: boolean = false;
	private chatWidget: ChatWidgetCoordinator;
	/** 生命周期编排（activate/deactivate/start/stop 状态机） */
	private lifecycle: ReadingModeLifecycle;

	constructor(
		app: App,
		callbacks: ReadingModeCallbacks | undefined,
		pluginId: string,
	) {
		this.app = app;
		this.callbacks = callbacks || null;
		this._pluginId = pluginId;
		this.pageMemoryStore = new PageMemoryStore(app, pluginId, () => this.paginationCoordinator.getPaginator()?.getTotalPages());
		this.chapterDetection = new ChapterDetection(this.app, () => this.getCurrentFile());
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
			getCurrentFile: () => this.getCurrentFile(),
			getBookName: () => this.lifecycle.bookName,
			isActive: () => this.isActive,
			extractChapterName: () => this.chapterDetection.extractChapterName(),
			navigateToPrev: () => this.navigateToPrev(),
			navigateToNext: () => this.navigateToNext(),
			getChapterNavigation: () => this.getChapterNavigation(),
			recordPage: (filePath, page) => this.pageMemoryStore.recordPage(filePath, page),
			getSavedPage: (filePath) => this.pageMemoryStore.getPage(filePath),
			getPluginSettings: () => this.pluginSettings,
			onStopReadingTTS: () => this.callbacks?.onStopReadingTTS?.(),
			getJumpToLastPage: () => this._jumpToLastPage,
			clearJumpToLastPage: () => {
				this._jumpToLastPage = false;
			},
		});

		// 生命周期编排：注入式解耦 activate/deactivate/start/stop 状态机
		this.lifecycle = new ReadingModeLifecycle({
			app: this.app,
			chapterDetection: this.chapterDetection,
			chapterNavigator: this.chapterNavigator,
			paginationCoordinator: this.paginationCoordinator,
			chatWidget: this.chatWidget,
			pageMemoryStore: this.pageMemoryStore,
			getCallbacks: () => this.callbacks,
			getStyle: () => this.style,
			getAutoEnable: () => this.autoEnable,
			getScrollPatchTarget: () => this,
		});
	}

	/**
	 * 设置回调函数
	 */
	setCallbacks(callbacks: ReadingModeCallbacks): void {
		this.callbacks = callbacks;
		// 工具栏重建由生命周期内部在已初始化时处理
		this.lifecycle.setCallbacks(callbacks);
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
		if (this.isActive && this.getCurrentFile()) {
			const file = this.getCurrentFile()!;
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
	 * 激活阅读模式（委托生命周期编排）
	 */
	activate(file: TFile, retryCount = 0): void {
		this.lifecycle.activate(file, retryCount);
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
	 * 停用阅读模式（委托生命周期编排）
	 */
	deactivate(): void {
		this.lifecycle.deactivate();
	}

	/**
	 * 启动服务（委托生命周期编排）
	 */
	start(): void {
		this.lifecycle.start();
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
		return this.lifecycle.openMostRecent();
	}

	/**
	 * 停止服务（委托生命周期编排）
	 */
	stop(): void {
		this.lifecycle.stop();
	}

	/**
	 * 获取当前文件信息（代理生命周期状态）
	 */
	getCurrentFile(): TFile | null {
		return this.lifecycle.currentFile;
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
		const currentFile = this.getCurrentFile();
		if (!currentFile) return null;
		const cache = this.app.metadataCache.getFileCache(currentFile);
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
