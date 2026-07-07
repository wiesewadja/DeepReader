/**
 * 阅读模式生命周期编排（深模块）
 * 承载 activate/deactivate/start/stop/openMostRecent 的状态与编排逻辑，
 * 从 ReadingModeService（Shell）抽出，使其收敛为稳定的公共 facade。
 *
 * 关键约束：ScrollPatchService 契约身份仍在 Shell 上。本模块通过
 * deps.getScrollPatchTarget() 获取 Shell 实例作为 installScrollPatch/uninstallScrollPatch 的目标，
 * 因此 patcher 路由命中的是 Shell（其 isActive/activeContainerEl 为代理 getter，scrollToElementInColumn 为薄委托）。
 */

import {
	type App,
	TFile,
	type EventRef,
	MarkdownView,
} from "obsidian";
import type { ReadingModeCallbacks } from "./reading-mode-orchestrator.js";
import { ChapterDetection } from "./chapter-detection.js";
import { ChapterNavigator } from "./chapter-navigator.js";
import { PageMemoryStore } from "./page-memory-store.js";
import { ChatWidgetCoordinator } from "./chat-widget-coordinator.js";
import { PaginationCoordinator } from "./pagination-coordinator.js";
import {
	installScrollPatch,
	uninstallScrollPatch,
	type ScrollPatchService,
} from "./scroll-patch.js";
import { SelectionToolbar } from "./selection-toolbar.js";
import { ChapterNav } from "./chapter-nav.js";
import { serviceLog } from "../../utils/logger.js";

export interface ReadingModeLifecycleDeps {
	app: App;
	chapterDetection: ChapterDetection;
	chapterNavigator: ChapterNavigator;
	paginationCoordinator: PaginationCoordinator;
	chatWidget: ChatWidgetCoordinator;
	pageMemoryStore: PageMemoryStore;
	getCallbacks: () => ReadingModeCallbacks | null;
	getStyle: () => "paginated" | "scrolling";
	getAutoEnable: () => boolean;
	/** 返回实现 ScrollPatchService 的 Shell 实例（契约身份必须留在该实例上） */
	getScrollPatchTarget: () => ScrollPatchService;
}

/**
 * 阅读模式生命周期状态机 + 编排。
 * 与 Shell 解耦：Shell 仅持有本实例并代理其公开面与 ScrollPatchService 契约。
 */
export class ReadingModeLifecycle {
	private deps: ReadingModeLifecycleDeps;

	/** 激活态。供 ScrollPatchService 接口读取（Shell 以 getter 代理） */
	public isActive: boolean = false;
	/** 已激活 leaf 的 containerEl。供 ScrollPatchService 接口读取（Shell 以 getter 代理） */
	public activeContainerEl: HTMLElement | null = null;
	private _currentFile: TFile | null = null;
	/** 当前书籍名（notifyBookDetected 写入） */
	private currentBookName: string = "";
	/** 已激活分页阅读模式的书籍名（同书新章节不重复激活） */
	private activatedBookForReading: string = "";
	private pendingRetry: ReturnType<typeof setTimeout> | null = null;
	private fileOpenHandler: EventRef | null = null;
	private selectionToolbar: SelectionToolbar | null = null;
	private chapterNav: ChapterNav | null = null;
	private layoutChangeHandler: EventRef | null = null;
	private resizeHandler: EventRef | null = null;

	constructor(deps: ReadingModeLifecycleDeps) {
		this.deps = deps;
	}

	/** 当前文件（供 Shell.getCurrentFile 代理） */
	public get currentFile(): TFile | null {
		return this._currentFile;
	}

	/** 当前书籍名（供 Shell 注入给 PaginationCoordinator 的 getBookName 闭包） */
	public get bookName(): string {
		return this.currentBookName;
	}

	/**
	 * 设置回调函数（由 Shell 持有，通过 getCallbacks() 暴露）。
	 * 若工具栏已初始化则重建以应用新回调。
	 */
	setCallbacks(_callbacks: ReadingModeCallbacks): void {
		if (this.selectionToolbar) {
			this.selectionToolbar.destroy();
			this.initSelectionToolbar();
		}
	}

	/**
	 * 激活阅读模式
	 */
	activate(file: TFile, retryCount = 0): void {
		// 如果是同一文件，将对应 leaf 激活到前台即可
		if (this.isActive && this._currentFile?.path === file.path) {
			const existingLeaf = this.deps.app.workspace
				.getLeavesOfType("markdown")
				.find(
					(l) =>
						(l.view as import("obsidian").MarkdownView)?.file?.path ===
						file.path,
				);
			if (existingLeaf) {
				this.deps.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
			}
			return;
		}

		// 先清理旧状态（移除旧 containerEl 上的 CSS 类、销毁旧分页器等）
		this.deactivate();

		serviceLog("[DeepPDF] ReadingMode activating for:", file.path);

		// 查找包含目标文件的 markdown view（不依赖 activeLeaf）
		const markdownLeaves = this.deps.app.workspace.getLeavesOfType("markdown");
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
		this.deps.paginationCoordinator.destroyPaginator();

		this._currentFile = file;
		this.isActive = true;
		this.activatedBookForReading = this.deps.chapterDetection.getBookNameFromFile(file);

		// 切换到阅读视图
		this.switchToReadingView();

		// 添加阅读模式 CSS 类到当前 leaf 的 containerEl，避免全局污染
		this.activeContainerEl = view.containerEl;
		view.containerEl.classList.add("deeppdf-reading-mode");
		if (this.deps.getStyle() === "paginated") {
			view.containerEl.classList.add("deeppdf-paginated");
		}

		// 延迟初始化分页器，等待视图渲染完成（仅分页模式）
		if (this.deps.getStyle() === "paginated") {
			setTimeout(() => {
				serviceLog("[DeepPDF] ReadingMode: initializing paginator");

				this.deps.paginationCoordinator.initPaginator();
			}, 200);

			// 拦截 scrollIntoView，修复 multi-column 布局下的 blockId 跳转
			// 使用引用计数模块：多 service 并存时安全，最后一个卸载时还原 native
			installScrollPatch(this.deps.getScrollPatchTarget());

			// 监听 hashchange，处理 blockId 跳转（双重保险）
			this.deps.paginationCoordinator.setupHashChangeHandler();
		}

		// 通知书籍检测回调
		this.notifyBookDetected(file);

		// 初始化移动端浮动按钮
		this.deps.chatWidget.initMobileFab();

		// 初始化/显示桌面端提问悬浮球
		this.deps.chatWidget.updateVisibility();

		// 隐藏 Obsidian 移动端底部导航栏，最大化阅读区域
		this.deps.chatWidget.toggleMobileNavbar(false);

		serviceLog("[ReadingMode] Activated for:", file.path);
	}

	/**
	 * 通知检测到书籍章节
	 */
	private notifyBookDetected(file: TFile): void {
		const callbacks = this.deps.getCallbacks();
		if (!callbacks?.onBookDetected) return;

		// 从文件的 frontmatter 获取 index_id 或 pdf_index_id
		const cache = this.deps.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		const indexId = String(
			frontmatter?.index_id || frontmatter?.pdf_index_id || "",
		);

		// 从 frontmatter 或路径提取书名
		const bookName = this.deps.chapterDetection.getBookNameFromFile(file);

		// 只要有书名就可以尝试切换（即使没有 index_id，也可以通过书名查找）
		if (bookName) {
			this.currentBookName = bookName;
			serviceLog(
				"[ReadingMode] Book detected:",
				bookName,
				"indexId:",
				indexId || "will search by name",
			);
			callbacks.onBookDetected(indexId, bookName);
		}
	}

	/**
	 * 切换当前 leaf 到阅读视图
	 */
	private switchToReadingView(): void {
		const view = this.deps.app.workspace.getActiveViewOfType(MarkdownView);
		if (view && view.getMode() !== "preview") {
			view.setState(
				{ ...view.getState(), mode: "preview" },
				{ history: false },
			);
			serviceLog("[ReadingMode] Switched to reading view");
		}
	}

	/**
	 * 初始化悬浮工具栏
	 */
	private initSelectionToolbar(): void {
		const callbacks = this.deps.getCallbacks();
		if (!callbacks) {
			serviceLog("[ReadingMode] No callbacks set, skipping toolbar init");
			return;
		}

		this.selectionToolbar = new SelectionToolbar({
			app: this.deps.app,
			onQuote: callbacks.onQuote,
			onExcerpt: callbacks.onExcerpt,
			onSaveHighlight: callbacks.onSaveHighlight,
			onRemoveHighlight: callbacks.onRemoveHighlight,
		});
		this.selectionToolbar.init();
		serviceLog("[ReadingMode] Selection toolbar initialized");
	}

	/**
	 * 停用阅读模式
	 */
	deactivate(): void {
		if (!this.isActive) return;

		const callbacks = this.deps.getCallbacks();
		callbacks?.onStopReadingTTS?.();

		// 保存当前页码到记忆（含 lastReadAt 标记，触发持久化）
		if (this._currentFile) {
			this.deps.paginationCoordinator.recordCurrentPage();
		}

		// 清理聊天组件（移动端 FAB + 桌面端提问悬浮球）
		this.deps.chatWidget.destroy();

		this.deps.paginationCoordinator.destroyPaginator();

		// 清理旧的章节导航 UI 元素（如果有）
		const oldNavElements = document.querySelectorAll(".deeppdf-chapter-nav");
		oldNavElements.forEach((el) => el.remove());

		// 恢复 scrollIntoView（引用计数归零时才真正还原 prototype）
		uninstallScrollPatch(this.deps.getScrollPatchTarget());

		// 清理 hashchange 监听
		this.deps.paginationCoordinator.teardownHashChangeHandler();

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
		this.deps.chatWidget.toggleMobileNavbar(true);

		this.isActive = false;
		this._currentFile = null;

		// 通知外部清除 UI（如顶栏书名）
		callbacks?.onDeactivate?.();

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
		if (this.deps.getCallbacks()) {
			this.initSelectionToolbar();
		}

		// 初始化章节导航
		this.initChapterNav();

		// 监听布局变更和窗口缩放事件以动态显示/隐藏桌面端提问悬浮球
		this.layoutChangeHandler = this.deps.app.workspace.on("layout-change", () => {
			this.deps.chatWidget.updateVisibility();
			if (this.deps.paginationCoordinator.getPaginator()?.isActive()) {
				this.deps.paginationCoordinator.updateLayout();
				setTimeout(() => {
					if (this.deps.paginationCoordinator.getPaginator()?.isActive()) {
						this.deps.paginationCoordinator.updateLayout();
					}
				}, 300);
			}
		});
		this.resizeHandler = this.deps.app.workspace.on("resize", () => {
			this.deps.chatWidget.updateVisibility();
			if (this.deps.paginationCoordinator.getPaginator()?.isActive()) {
				this.deps.paginationCoordinator.updateLayout();
			}
		});

		this.fileOpenHandler = this.deps.app.workspace.on("file-open", (file) => {
			serviceLog("[DeepPDF] file-open event:", file?.path);
			if (file && this.deps.chapterDetection.isChapterFile(file)) {
				if (this.deps.getAutoEnable()) {
					const bookName = this.deps.chapterDetection.getBookNameFromFile(file);
					// Re-activate if: not active, different book, or different file (new chapter)
					const isDifferentFile = this._currentFile?.path !== file.path;
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
					const view = this.deps.app.workspace.getActiveViewOfType(MarkdownView);
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
			const activeFile = this.deps.app.workspace.getActiveFile();
			if (
				activeFile &&
				this.deps.chapterDetection.isChapterFile(activeFile) &&
				this.deps.getAutoEnable()
			) {
				this.activate(activeFile);
			} else if (activeFile && activeFile.extension === "md") {
				// 否则自动切回 edit 模式
				const view = this.deps.app.workspace.getActiveViewOfType(MarkdownView);
				if (view && view.getMode() !== "source") {
					view.setState(
						{ ...view.getState(), mode: "source" },
						{ history: false },
					);
					serviceLog("[ReadingMode] Switched to edit view on startup");
				}
			}
		};

		if (this.deps.app.workspace.layoutReady) {
			checkActiveFile();
		} else {
			this.deps.app.workspace.onLayoutReady(() => {
				checkActiveFile();
			});
		}

		// 插件启动时 metadataCache 可能未就绪，监听 resolved 事件重试
		this.deps.app.metadataCache.on("resolved", () => {
			if (!this.isActive && this.deps.getAutoEnable()) {
				const file = this.deps.app.workspace.getActiveFile();
				if (file && this.deps.chapterDetection.isChapterFile(file)) {
					serviceLog(
						"[ReadingMode] metadataCache resolved, activating for:",
						file.path,
					);
					this.activate(file);
				}
			}
		});

		// onLayoutReady 后再次检查，确保 workspace 已就绪且有足够延迟让 metadataCache 加载
		this.deps.app.workspace.onLayoutReady(() => {
			if (!this.isActive && this.deps.getAutoEnable()) {
				const file = this.deps.app.workspace.getActiveFile();
				if (file && this.deps.chapterDetection.isChapterFile(file)) {
					serviceLog("[ReadingMode] onLayoutReady, activating for:", file.path);
					this.activate(file);
				}
			}

			// 最终保底：延迟 1 秒后再次检查，确保 metadataCache 已完全加载
			setTimeout(() => {
				if (!this.isActive && this.deps.getAutoEnable()) {
					const file = this.deps.app.workspace.getActiveFile();
					if (file && this.deps.chapterDetection.isChapterFile(file)) {
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
			app: this.deps.app,
			onNavigatePrev: () => this.deps.chapterNavigator.navigateToPrev(),
			onNavigateNext: () => this.deps.chapterNavigator.navigateToNext(),
			getNavigation: () => this.deps.chapterDetection.getChapterNavigation(),
			getPaginator: () => this.deps.paginationCoordinator.getPaginator(),
			isActive: () => this.isActive,
		});
		this.chapterNav.init();
		serviceLog("[ReadingMode] Chapter navigation initialized");
	}

	/**
	 * 从磁盘加载历史到内存 map（fire-and-forget 异步）
	 */
	private loadLastPagesFromDisk(): void {
		this.deps.pageMemoryStore.loadLastPagesFromDisk();
	}

	/**
	 * 打开最近阅读的书籍
	 * 找到 lastReadAt 最大的文件，激活其阅读模式（恢复上次页码）
	 * @returns true 表示找到并打开了；false 表示无历史或文件已删除
	 */
	async openMostRecent(): Promise<boolean> {
		const file = this.deps.pageMemoryStore.resolveMostRecentFile();
		if (!file) return false;

		// 如果文件已在某个 tab 中打开，激活该 tab
		const existingLeaf = this.deps.app.workspace
			.getLeavesOfType("markdown")
			.find(
				(l) =>
					(l.view as import("obsidian").MarkdownView)?.file?.path === file.path,
			);
		if (existingLeaf) {
			await this.deps.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
		} else {
			// 文件未在任何 tab 中打开，先打开它
			await this.deps.app.workspace.getLeaf(false).openFile(file);
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
		this.deps.pageMemoryStore.flushSave().catch((err) => {
			serviceLog("[ReadingMode] stop: flushSave failed:", err);
		});
		if (this.fileOpenHandler) {
			this.deps.app.workspace.offref(this.fileOpenHandler);
			this.fileOpenHandler = null;
		}
		if (this.layoutChangeHandler) {
			this.deps.app.workspace.offref(this.layoutChangeHandler);
			this.layoutChangeHandler = null;
		}
		if (this.resizeHandler) {
			this.deps.app.workspace.offref(this.resizeHandler);
			this.resizeHandler = null;
		}
		// @ts-ignore — metadataCache.on 返回的 eventRef 用 offref 清理
		this.deps.app.metadataCache.offref?.("resolved");
		if (this.selectionToolbar) {
			this.selectionToolbar.destroy();
			this.selectionToolbar = null;
		}
		if (this.chapterNav) {
			this.chapterNav.destroy();
			this.chapterNav = null;
		}
		this.deps.paginationCoordinator.destroyPaginator();
	}
}
