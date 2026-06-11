/**
 * 阅读模式编排器
 * 管理章节文件的书籍化阅读体验 — 创建并编排 SelectionToolbar/ChapterNav/PagePaginator/MobileReadingFab 的完整生命周期
 */

import {
	type App,
	TFile,
	type EventRef,
	MarkdownView,
	Platform,
} from "obsidian";
import {
	loadLastPages,
	saveLastPages,
} from "../../pageindex/last-page-store.js";
import type { HighlightColorId } from "../../types/highlight.js";
import type { QuoteMetadata } from "../../types/quote.js";
import { serviceLog } from "../../utils/logger.js";
import { getVaultPath } from "../../utils/mobile-fs.js";
import { ChapterNav } from "./chapter-nav.js";
import type { ChapterNavOptions } from "./chapter-nav.js";
import { MobileReadingFab } from "./mobile-reading-fab.js";
import { PagePaginator } from "./page-paginator.js";
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
}

export interface ChapterNavigation {
	prev: TFile | null;
	next: TFile | null;
	current: TFile;
	total: number;
	currentIndex: number;
}

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
	private paginator: PagePaginator | null = null;
	private callbacks: ReadingModeCallbacks | null = null;
	private autoEnable: boolean = true;
	private style: "paginated" | "scrolling" = "paginated";
	private mobileFab: MobileReadingFab | null = null;
	private hashChangeHandler: ((e: HashChangeEvent) => void) | null = null;
	private currentBookName: string = "";
	private pendingRetry: ReturnType<typeof setTimeout> | null = null;
	/** 已激活分页阅读模式的书籍名（同书新章节不重复激活） */
	private activatedBookForReading: string = "";
	/** 页码记忆：filePath → 上次阅读的页码 */
	private pageMemory: Map<string, number> = new Map();
	/** 最近一次 pageMemory 变更时间（用于"最近阅读"判定） */
	private lastReadAt: Map<string, number> = new Map();
	/** debounced 持久化定时器 */
	private _saveTimer: ReturnType<typeof setTimeout> | null = null;
	private _pluginId: string;
	/** 跨章回退标记：从后一章按 ← 时，前一章应恢复到最后一页 */
	private _jumpToLastPage: boolean = false;

	constructor(
		app: App,
		callbacks: ReadingModeCallbacks | undefined,
		pluginId: string,
	) {
		this.app = app;
		this.callbacks = callbacks || null;
		this._pluginId = pluginId;
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
		// 必须是 Markdown 文件
		if (file.extension !== "md") {
			return false;
		}

		// 路径以 DeepReader/ 开头
		if (!file.path.startsWith("DeepReader/")) {
			return false;
		}

		// 检查 frontmatter 标识字段
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		if (!frontmatter) {
			serviceLog("[ReadingMode] No frontmatter:", file.path);
			return false;
		}

		// 排除 MOC 文件（MOC 不需要沉浸式阅读模式）
		const isMoc =
			frontmatter.type === "pdf-moc" || frontmatter.type === "epub-moc";
		if (isMoc) {
			return false;
		}

		// 必须有 source 字段（书籍来源）
		const hasSource = !!(
			frontmatter.source ||
			frontmatter.pdf_name ||
			frontmatter.book
		);
		if (!hasSource) {
			serviceLog("[ReadingMode] File missing source:", file.path, frontmatter);
			return false;
		}

		serviceLog("[ReadingMode] Chapter file detected:", file.path);
		return true;
	}

	/**
	 * 从文件中提取书籍名称（用于同书判断）
	 */
	private getBookNameFromFile(file: TFile): string {
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		const bookName =
			frontmatter?.pdf_name || frontmatter?.book || frontmatter?.source || "";
		if (bookName) return bookName;
		// 从路径提取
		const pathParts = file.path.split("/");
		if (pathParts.length >= 2 && pathParts[0] === "DeepReader") {
			return pathParts[1];
		}
		return "";
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

		// 检查视图是否可用，不可用则延迟重试（插件重载时视图可能还在重建）
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
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
		this.paginator?.destroy();
		this.paginator = null;

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

				this.waitForRenderAndInitPaginator();
			}, 200);

			// 拦截 scrollIntoView，修复 multi-column 布局下的 blockId 跳转
			// 使用引用计数模块：多 service 并存时安全，最后一个卸载时还原 native
			installScrollPatch(this);

			// 监听 hashchange，处理 blockId 跳转（双重保险）
			this.setupHashChangeHandler();
		}

		// 通知书籍检测回调
		this.notifyBookDetected(file);

		// 初始化移动端浮动按钮
		this.initMobileFab();

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

		// 兼容多种 frontmatter 字段获取书名：pdf_name (旧), book (EPUB), source (PDF)
		let bookName =
			frontmatter?.pdf_name || frontmatter?.book || frontmatter?.source || "";

		// 如果没有书名，从文件路径提取书籍名称
		if (!bookName) {
			const pathParts = file.path.split("/");
			if (pathParts.length >= 2 && pathParts[0] === "DeepReader") {
				bookName = pathParts[1];
			}
		}

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

	/**
	 * 初始化移动端浮动按钮
	 */
	private initMobileFab(): void {
		if (!Platform.isMobile) return;
		this.mobileFab = new MobileReadingFab(() => {
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				leaf.setViewState({ type: "deepreader-sidebar", active: true });
				this.app.workspace.revealLeaf(leaf);
			}
		});
		this.mobileFab.show();
	}

	/**
	 * 更新 FAB 未读状态
	 */
	setFabUnread(hasUnread: boolean): void {
		this.mobileFab?.setUnread(hasUnread);
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

		// 保存当前页码到记忆（含 lastReadAt 标记，触发持久化）
		if (this.currentFile && this.paginator) {
			this.recordPage(this.currentFile.path, this.paginator.getCurrentPage());
		}

		// 清理移动端浮动按钮
		this.mobileFab?.destroy();
		this.mobileFab = null;

		this.paginator?.destroy();
		this.paginator = null;

		// 清理旧的章节导航 UI 元素（如果有）
		const oldNavElements = document.querySelectorAll(".deeppdf-chapter-nav");
		oldNavElements.forEach((el) => el.remove());

		// 恢复 scrollIntoView（引用计数归零时才真正还原 prototype）
		uninstallScrollPatch(this);

		// 清理 hashchange 监听
		this.teardownHashChangeHandler();

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
			}
		});

		// 检查当前打开的文件
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && this.isChapterFile(activeFile) && this.autoEnable) {
			this.activate(activeFile);
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
			getPaginator: () => this.paginator,
		});
		this.chapterNav.init();
		serviceLog("[ReadingMode] Chapter navigation initialized");
	}

	/**
	 * 等待渲染完成后初始化分页器
	 * 轮询检测 .markdown-preview-sizer 是否已有内容
	 */
	private waitForRenderAndInitPaginator(): void {
		this.paginator?.destroy();
		this.paginator = null;

		const maxAttempts = 15;
		let attempts = 0;

		// 提取章节名称（去除编号前缀）
		const chapterName = this.extractChapterName();

		const tryInit = () => {
			attempts++;
			const container = this.activeContainerEl?.querySelector(
				".markdown-preview-sizer",
			) as HTMLElement;

			if (container && container.children.length > 1) {
				this.paginator = new PagePaginator({
					container,
					onNavigatePrev: () => this.navigateToPrev(),
					onNavigateNext: () => this.navigateToNext(),
					hasPrevChapter: () => this.getChapterNavigation()?.prev != null,
					hasNextChapter: () => this.getChapterNavigation()?.next != null,
					onPageChange: (page) => {
						// 每翻页都记录 + 调度持久化（debounced 200ms）
						if (this.currentFile) {
							this.recordPage(this.currentFile.path, page);
						}
					},
					chapterName,
					bookName: this.currentBookName,
				});
				this.paginator.paginateAndShow();

				// 恢复页码（双 rAF 确保 paginator 布局完成）
				if (this.currentFile) {
					// 跨章回退：跳到最后一页（翻书语义）
					const restoreLastPage = this._jumpToLastPage;
					this._jumpToLastPage = false;

					const savedPage = restoreLastPage
						? undefined
						: this.pageMemory.get(this.currentFile.path);
					const shouldRestore =
						restoreLastPage || (savedPage != null && savedPage > 1);
					if (shouldRestore) {
						requestAnimationFrame(() => {
							requestAnimationFrame(() => {
								if (!this.paginator) return;
								const scrollView = this.activeContainerEl?.querySelector(
									".markdown-preview-view",
								) as HTMLElement;
								if (!scrollView) return;

								const totalPages = this.paginator.getTotalPages();
								const targetPage = restoreLastPage
									? totalPages
									: Math.max(1, Math.min(savedPage!, totalPages || savedPage!));
								if (targetPage <= 1 && !restoreLastPage) return;

								const targetScroll = (targetPage - 1) * scrollView.clientWidth;
								const maxScroll = Math.max(
									0,
									scrollView.scrollWidth - scrollView.clientWidth,
								);

								this.paginator.setCurrentPage(targetPage);
								scrollView.scrollLeft = Math.min(targetScroll, maxScroll);
							});
						});
					}
				}

				serviceLog("[ReadingMode] Paginator initialized");
				return;
			}

			if (attempts < maxAttempts) {
				setTimeout(tryInit, 150);
			} else {
				serviceLog.warn(
					"[ReadingMode] Paginator: render not ready after timeout",
				);
			}
		};

		tryInit();
	}

	/**
	 * 提取章节名称（去除编号前缀）
	 * 例如: "23 - 第十九章 如何阅读社会科学" -> "第十九章 如何阅读社会科学"
	 */
	private extractChapterName(): string {
		if (!this.currentFile) return "";

		const basename = this.currentFile.basename;
		// 匹配 "数字 - " 或 "数字- " 格式并去除
		const match = basename.match(/^\d+\s*[-–]\s*(.+)$/);
		return match ? match[1] : basename;
	}

	/**
	 * 从磁盘加载历史到内存 map（fire-and-forget 异步）
	 *
	 * 注意：加载完成前 pageMemory 为空 Map，activate() 中的页码恢复会静默跳过。
	 * 冷启动后用户在 ~100ms 内打开文件可能丢失恢复，但实际操作间隔通常远大于此。
	 */
	private loadLastPagesFromDisk(): void {
		const vaultPath = getVaultPath(this.app);
		if (!vaultPath) return;
		loadLastPages(vaultPath, this._pluginId)
			.then(({ pages, lastReadAt }) => {
				this.pageMemory = pages;
				this.lastReadAt = lastReadAt;
				serviceLog("[ReadingMode] Loaded last-pages:", pages.size, "entries");
			})
			.catch((err) => {
				serviceLog("[ReadingMode] loadLastPages failed:", err);
			});
	}

	/**
	 * 记录页码 + 标记最近阅读时间 + 调度 debounced 持久化
	 */
	private recordPage(filePath: string, page: number): void {
		if (!filePath) return;
		if (typeof page !== "number" || !Number.isFinite(page) || page < 1) return;
		const total = this.paginator?.getTotalPages() ?? 0;
		if (total > 0 && page > total) return;
		this.pageMemory.set(filePath, page);
		this.lastReadAt.set(filePath, Date.now());
		// 内存侧淘汰：与 last-page-store MAX_ENTRIES 同步，防止长期运行 map 无限增长
		if (this.pageMemory.size > 500) {
			let oldest: string | null = null;
			let oldestTime = Infinity;
			for (const [k, ts] of this.lastReadAt) {
				if (ts < oldestTime) {
					oldestTime = ts;
					oldest = k;
				}
			}
			if (oldest) {
				this.pageMemory.delete(oldest);
				this.lastReadAt.delete(oldest);
			}
		}
		this.scheduleSave();
	}

	/**
	 * 调度 debounced 持久化（200ms 内合并多次翻页）
	 */
	private scheduleSave(): void {
		if (this._saveTimer) clearTimeout(this._saveTimer);
		this._saveTimer = setTimeout(() => {
			this._saveTimer = null;
			this.flushSave().catch((err) => {
				serviceLog("[ReadingMode] flushSave failed:", err);
			});
		}, 200);
	}

	/**
	 * 立即保存到磁盘（取消 pending timer）
	 */
	async flushSave(): Promise<void> {
		if (this._saveTimer) {
			clearTimeout(this._saveTimer);
			this._saveTimer = null;
		}
		const vaultPath = getVaultPath(this.app);
		if (!vaultPath) return;
		// 没有历史可写
		if (this.pageMemory.size === 0) return;
		await saveLastPages(
			vaultPath,
			this.pageMemory,
			this.lastReadAt,
			this._pluginId,
		);
	}

	/**
	 * 在指定文件夹下查找最近阅读的文件路径。
	 * 用于书库点击书籍时定位到上次阅读的章节。
	 * @param folderPath 书籍章节文件夹路径（如 "DeepReader/书名"）
	 * @returns 最近阅读的文件路径，或 null
	 */
	findMostRecentInFolder(folderPath: string): string | null {
		let bestPath: string | null = null;
		let bestTime = -1;
		for (const [path, time] of this.lastReadAt) {
			if (path.startsWith(folderPath + "/") && time > bestTime) {
				bestTime = time;
				bestPath = path;
			}
		}
		return bestPath;
	}

	/**
	 * 打开最近阅读的书籍
	 * 找到 lastReadAt 最大的文件，激活其阅读模式（恢复上次页码）
	 * @returns true 表示找到并打开了；false 表示无历史或文件已删除
	 */
	async openMostRecent(): Promise<boolean> {
		if (this.lastReadAt.size === 0) {
			serviceLog("[ReadingMode] openMostRecent: no last-read history");
			return false;
		}
		let mostRecentPath: string | null = null;
		let mostRecentTime = -1;
		for (const [path, time] of this.lastReadAt) {
			if (time > mostRecentTime) {
				mostRecentTime = time;
				mostRecentPath = path;
			}
		}
		if (!mostRecentPath) return false;

		const file = this.app.vault.getAbstractFileByPath(mostRecentPath);
		if (!(file instanceof TFile)) {
			// 文件已被删除，清理历史
			serviceLog(
				"[ReadingMode] openMostRecent: file no longer exists:",
				mostRecentPath,
			);
			this.lastReadAt.delete(mostRecentPath);
			this.pageMemory.delete(mostRecentPath);
			this.scheduleSave();
			return false;
		}

		serviceLog(
			"[ReadingMode] openMostRecent:",
			mostRecentPath,
			"at",
			mostRecentTime,
		);

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
		if (this.paginator) {
			this.paginator.destroy();
			this.paginator = null;
		}
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
		return this.paginator;
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
		if (!this.currentFile) return null;

		const parent = this.currentFile.parent;
		if (!parent) return null;

		// 获取同文件夹下的所有章节文件
		const chapterFiles = parent.children
			.filter((child): child is TFile => {
				if (!(child instanceof TFile)) return false;
				if (child.extension !== "md") return false;
				// 匹配 "01 - 标题" 或 "01-标题" 格式
				return /^\d+/.test(child.basename);
			})
			.sort((a, b) =>
				a.basename.localeCompare(b.basename, undefined, { numeric: true }),
			);

		const currentIndex = chapterFiles.findIndex(
			(f) => f.path === this.currentFile?.path,
		);

		if (currentIndex === -1) return null;

		return {
			prev: currentIndex > 0 ? chapterFiles[currentIndex - 1] : null,
			next:
				currentIndex < chapterFiles.length - 1
					? chapterFiles[currentIndex + 1]
					: null,
			current: this.currentFile,
			total: chapterFiles.length,
			currentIndex: currentIndex + 1, // 1-based index
		};
	}

	/**
	 * 跳转到上一章
	 */
	async navigateToPrev(): Promise<boolean> {
		const nav = this.getChapterNavigation();
		if (nav?.prev) {
			this._jumpToLastPage = true;
			await this.openFile(nav.prev);
			return true;
		}
		return false;
	}

	/**
	 * 跳转到下一章
	 */
	async navigateToNext(): Promise<boolean> {
		const nav = this.getChapterNavigation();
		if (nav?.next) {
			await this.openFile(nav.next);
			return true;
		}
		return false;
	}

	/**
	 * 打开文件
	 */
	private async openFile(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		if (leaf) {
			await leaf.openFile(file, { active: true });
		}
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
		// 双层 rAF：第一层等待当前帧渲染完成，第二层等待布局重新计算
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				const elemRect = element.getBoundingClientRect();
				const containerRect = scrollView.getBoundingClientRect();
				const computedStyle = window.getComputedStyle(scrollView);
				const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;

				// 元素在可滚动内容中的绝对水平位置
				// elemRect.left 是相对视口的，containerRect.left 也是相对视口的
				// scrollLeft 是当前已滚动的距离
				// paddingLeft 补偿 CSS padding 带来的偏移
				const absoluteLeft =
					elemRect.left - containerRect.left + scrollView.scrollLeft;
				const viewWidth = scrollView.clientWidth;

				if (viewWidth === 0) return;

				// 计算目标页（列）：0-based
				const targetPage = Math.floor(absoluteLeft / viewWidth);
				const targetScrollLeft = targetPage * viewWidth;

				serviceLog(
					`[ReadingMode] BlockId jump: absoluteLeft=${absoluteLeft.toFixed(0)}, viewWidth=${viewWidth}, targetPage=${targetPage + 1}, scrollLeft=${targetScrollLeft}`,
				);

				// 平滑滚动到目标列
				scrollView.scrollTo({
					left: targetScrollLeft,
					behavior: "smooth",
				});

				// 更新分页器的当前页码
				if (this.paginator) {
					this.paginator.setCurrentPage(targetPage + 1);
				}

				// 高亮目标元素
				element.classList.add("deeppdf-block-highlight");
				setTimeout(() => {
					element.classList.remove("deeppdf-block-highlight");
				}, 2000);
			});
		});
	}

	/**
	 * 设置 hashchange 监听器，处理 blockId 舜转
	 * 这是双重保险机制：当 URL 中有 #^blockId 时，手动处理跳转
	 */
	private setupHashChangeHandler(): void {
		if (this.hashChangeHandler) return;

		this.hashChangeHandler = (e: HashChangeEvent) => {
			if (!this.isActive) return;

			const hash = window.location.hash;
			if (!hash.startsWith("#^")) return;

			const blockId = hash.substring(2); // 移除 #^
			serviceLog("[ReadingMode] Hashchange detected for blockId:", blockId);

			// 等待 DOM 更新
			requestAnimationFrame(() => {
				this.jumpToBlockId(blockId);
			});
		};

		window.addEventListener("hashchange", this.hashChangeHandler);
		serviceLog("[ReadingMode] Hashchange handler setup");
	}

	/**
	 * 清理 hashchange 监听器
	 */
	private teardownHashChangeHandler(): void {
		if (this.hashChangeHandler) {
			window.removeEventListener("hashchange", this.hashChangeHandler);
			this.hashChangeHandler = null;
			serviceLog("[ReadingMode] Hashchange handler teardown");
		}
	}

	/**
	 * 跳转到指定的 blockId
	 * 在 CSS multi-column 布局中手动计算横向位置
	 */
	private jumpToBlockId(blockId: string): void {
		const scrollView = document.querySelector(
			".deeppdf-reading-mode .markdown-preview-view",
		) as HTMLElement;
		if (!scrollView) {
			serviceLog("[ReadingMode] No scrollView found for blockId jump");
			return;
		}

		// Obsidian 会将 ^blockId 转为 id="blockId" 的属性
		const targetElement = scrollView.querySelector(
			`[id="${blockId}"]`,
		) as HTMLElement;
		if (!targetElement) {
			serviceLog(
				"[ReadingMode] Target element not found for blockId:",
				blockId,
			);
			return;
		}

		this.scrollToElementInColumn(targetElement, scrollView);
		serviceLog("[ReadingMode] Jumped to blockId:", blockId);
	}
}
