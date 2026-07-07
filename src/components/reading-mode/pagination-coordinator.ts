/**
 * PaginationCoordinator —— 阅读模式分页生命周期深模块
 *
 * 迁入自 ReadingModeService（Shell）的"分页"职责：
 *   - 分页器生命周期（waitForRenderAndInitPaginator → initPaginator）
 *   - scrolling 降级（getPageParagraphs / highlightElement / clearHighlight）
 *   - blockId 路由（scrollToElementInColumn + hashchange 双重保险）
 *   - 双页度量对接（getDualPageMetrics）
 *
 * 设计约束：
 *   - Shell 继续 `implements ScrollPatchService`；`scrollToElementInColumn` 由本模块实现，
 *     但 Shell 公开同名方法委托至此，保证 `installScrollPatch(this)` 传入的仍是稳定 Shell 实例（CRITICAL）。
 *   - 所有跨模块依赖（翻章 / 章节识别 / 页码记忆 / 共享态 R2）经注入闭包传入，避免上帝对象耦合。
 */

import { TFile } from "obsidian";
import type { DeepPDFSettings } from "../../config/settings.js";
import { serviceLog } from "../../utils/logger.js";
import { PagePaginator } from "./page-paginator.js";
import { getDualPageMetrics } from "./viewport-state.js";
import type { ChapterNavigation } from "./reading-mode-orchestrator.js";

export interface PaginationCoordinatorDeps {
	/** 读取 Shell 实时激活态 containerEl */
	getActiveContainerEl: () => HTMLElement | null;
	/** 读取 Shell 实时当前文件 */
	getCurrentFile: () => TFile | null;
	/** 读取 currentBookName（activate 时设置） */
	getBookName: () => string;
	/** 读取 Shell 实时激活态（hashchange handler 用） */
	isActive: () => boolean;
	/** 提取章节名（去编号前缀） */
	extractChapterName: () => string;
	/** 翻到上一章（paginator 回调） */
	navigateToPrev: () => Promise<boolean>;
	/** 翻到下一章（paginator 回调） */
	navigateToNext: () => Promise<boolean>;
	/** 章节导航信息（paginator 回调） */
	getChapterNavigation: () => ChapterNavigation | null;
	/** 记录页码（paginator 翻页回调 / deactivate 用） */
	recordPage: (filePath: string, page: number) => void;
	/** 读取已保存页码（恢复用） */
	getSavedPage: (filePath: string) => number | undefined;
	/** 读取插件设置（autoDualPage 等） */
	getPluginSettings: () => DeepPDFSettings | undefined;
	/** 停止原文朗读（翻页回调） */
	onStopReadingTTS: () => void;
	/** R2 共享态：读取跨章回退标记 */
	getJumpToLastPage: () => boolean;
	/** R2 共享态：清除跨章回退标记 */
	clearJumpToLastPage: () => void;
}

export class PaginationCoordinator {
	private deps: PaginationCoordinatorDeps;

	/** 分页器实例（paginated 模式由本模块持有与编排） */
	private paginator: PagePaginator | null = null;
	/** hashchange 监听器引用（双重保险） */
	private hashChangeHandler: ((e: HashChangeEvent) => void) | null = null;

	constructor(deps: PaginationCoordinatorDeps) {
		this.deps = deps;
	}

	// ── 公开委托（供 Shell 转发的稳定公共面） ──

	getPaginator(): PagePaginator | null {
		return this.paginator;
	}

	getCurrentPage(): number {
		return this.paginator?.getCurrentPage() || 1;
	}

	getCurrentPageText(): string {
		return this.paginator?.getCurrentPageText() || "";
	}

	/**
	 * 获取指定或当前页的段落列表（元素 + 文本），供逐段 TTS 朗读
	 * 分页模式：委托 paginator 按页码过滤
	 * 滚动模式：降级为获取当前视口内可见段落
	 */
	getPageParagraphs(
		pageNumber?: number,
	): { element: HTMLElement; text: string }[] {
		if (this.paginator?.isActive()) {
			return this.paginator.getPageParagraphs(pageNumber);
		}
		// 滚动模式：获取当前视口内可见段落
		const container = this.deps.getActiveContainerEl();
		if (!container) return [];
		const sizer = container.querySelector(
			".markdown-preview-sizer",
		) as HTMLElement;
		if (!sizer) return [];
		const allParagraphs = Array.from(
			sizer.querySelectorAll<HTMLElement>(
				"p, h1, h2, h3, h4, h5, h6, li",
			),
		);
		const viewTop = 0;
		const viewBottom = window.innerHeight;
		return allParagraphs
			.filter((el) => {
				const rect = el.getBoundingClientRect();
				const text = el.textContent?.trim() || "";
				if (!text) return false;
				// 段落与视口有交集
				return rect.bottom > viewTop && rect.top < viewBottom;
			})
			.map((el) => ({ element: el, text: el.textContent?.trim() || "" }));
	}

	/**
	 * 高亮指定的段落元素
	 * 分页模式：委托 paginator
	 * 滚动模式：直接高亮 + 滚动到可见区域
	 */
	highlightElement(el: HTMLElement): void {
		if (this.paginator?.isActive()) {
			this.paginator.highlightElement(el);
		} else {
			// 滚动模式：清除旧高亮，添加新高亮，滚动到视口
			this.clearHighlight();
			el.classList.add("deeppdf-tts-reading-paragraph");
			el.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	}

	/**
	 * 清除所有高亮
	 * 分页模式：委托 paginator
	 * 滚动模式：直接移除高亮 class
	 */
	clearHighlight(): void {
		if (this.paginator?.isActive()) {
			this.paginator.clearHighlight();
		} else {
			const container = this.deps.getActiveContainerEl();
			if (container) {
				container
					.querySelectorAll(".deeppdf-tts-reading-paragraph")
					.forEach((el) =>
						el.classList.remove("deeppdf-tts-reading-paragraph"),
					);
			}
		}
	}

	/**
	 * 翻到下一页（供原文朗读 TTS 自动翻页使用）
	 */
	nextPage(): boolean {
		return this.paginator?.nextPage() ?? false;
	}

	/**
	 * 获取当前是否处于双页阅读模式
	 */
	isDualPageMode(): boolean {
		return this.paginator?.isDualPageMode || false;
	}

	/**
	 * 触发分页器布局重算（layout-change / resize handler 调用）
	 */
	updateLayout(): void {
		this.paginator?.updateLayout();
	}

	/**
	 * 在 CSS multi-column 布局中滚动到目标元素。
	 * 由 `ScrollPatchService` 接口在 patched scrollIntoView 命中时被调用（Shell 委托至此）。
	 *
	 * 使用 getBoundingClientRect 计算元素在滚动内容中的绝对位置，
	 * 然后计算目标所在的"页"（列），设置 scrollLeft 跳转。
	 * 注意：需要使用双层 rAF 等待 CSS column 布局稳定后再计算位置。
	 */
	scrollToElementInColumn(element: HTMLElement, scrollView: HTMLElement): void {
		// 双层 rAF：第一层等待当前帧渲染完成，第二层等待布局重新计算
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				const elemRect = element.getBoundingClientRect();
				const containerRect = scrollView.getBoundingClientRect();
				const computedStyle = window.getComputedStyle(scrollView);
				const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;

				// 元素在可滚动内容中的绝对水平位置
				const absoluteLeft =
					elemRect.left -
					containerRect.left +
					scrollView.scrollLeft;
				const viewWidth = scrollView.clientWidth;

				if (viewWidth === 0) return;

				const isDual = this.isDualPageMode();
				let targetScrollLeft = 0;
				let targetPage = 0; // 0-based logical page

				if (isDual) {
					// 动态读取列度量，避免与 CSS 的 padding(50)/column-gap(60) 硬编码耦合
					const spreadStep = getDualPageMetrics(scrollView).spreadStep;
					const spreadIndex = Math.floor(
						Math.max(0, absoluteLeft - paddingLeft) / spreadStep,
					);
					targetScrollLeft = spreadIndex * spreadStep;
					targetPage = spreadIndex * 2;
				} else {
					targetPage = Math.floor(absoluteLeft / viewWidth);
					targetScrollLeft = targetPage * viewWidth;
				}

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
	 * 设置 hashchange 监听器，处理 blockId 跳转
	 * 这是双重保险机制：当 URL 中有 #^blockId 时，手动处理跳转
	 */
	setupHashChangeHandler(): void {
		if (this.hashChangeHandler) return;

		this.hashChangeHandler = (e: HashChangeEvent) => {
			if (!this.deps.isActive()) return;

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
	teardownHashChangeHandler(): void {
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

	/**
	 * 停用阅读模式时记录当前页码（含 lastReadAt 标记，触发持久化）
	 */
	recordCurrentPage(): void {
		const file = this.deps.getCurrentFile();
		if (file && this.paginator) {
			this.deps.recordPage(file.path, this.paginator.getCurrentPage());
		}
	}

	/**
	 * 销毁分页器（deactivate 时调用）
	 */
	destroyPaginator(): void {
		this.paginator?.destroy();
		this.paginator = null;
	}

	/**
	 * 等待渲染完成后初始化分页器
	 * 轮询检测 .markdown-preview-sizer 是否已有内容
	 */
	initPaginator(): void {
		this.paginator?.destroy();
		this.paginator = null;

		const maxAttempts = 15;
		let attempts = 0;

		// 提取章节名称（去除编号前缀）
		const chapterName = this.deps.extractChapterName();

		const tryInit = () => {
			attempts++;
			const container = this.deps
				.getActiveContainerEl()
				?.querySelector(".markdown-preview-sizer") as HTMLElement;

			if (container && container.children.length > 1) {
				const settings = this.deps.getPluginSettings();
				this.paginator = new PagePaginator({
					container,
					onNavigatePrev: () => this.deps.navigateToPrev(),
					onNavigateNext: () => this.deps.navigateToNext(),
					hasPrevChapter: () =>
						this.deps.getChapterNavigation()?.prev != null,
					hasNextChapter: () =>
						this.deps.getChapterNavigation()?.next != null,
					onPageChange: (page) => {
						// 每翻页都记录 + 调度持久化（debounced 200ms）
						const file = this.deps.getCurrentFile();
						if (file) {
							this.deps.recordPage(file.path, page);
						}
						this.deps.onStopReadingTTS();
					},
					chapterName,
					bookName: this.deps.getBookName(),
					autoDualPage: settings?.autoDualPage ?? true,
				});
				this.paginator.paginateAndShow();

				// 恢复页码（双 rAF 确保 paginator 布局完成）
				const file = this.deps.getCurrentFile();
				if (file) {
					// 跨章回退：跳到最后一页（翻书语义）
					const restoreLastPage = this.deps.getJumpToLastPage();
					this.deps.clearJumpToLastPage();

					const savedPage = restoreLastPage
						? undefined
						: this.deps.getSavedPage(file.path);
					const shouldRestore =
						restoreLastPage ||
						(savedPage != null && savedPage > 1);
					if (shouldRestore) {
						requestAnimationFrame(() => {
							requestAnimationFrame(() => {
								if (!this.paginator) return;
								const scrollView = this.deps
									.getActiveContainerEl()
									?.querySelector(
										".markdown-preview-view",
									) as HTMLElement;
								if (!scrollView) return;

								const totalPages =
									this.paginator.getTotalPages();
								const targetPage = restoreLastPage
									? totalPages
									: Math.max(
											1,
											Math.min(
												savedPage!,
												totalPages || savedPage!,
											),
										);
								if (targetPage <= 1 && !restoreLastPage)
									return;

								const dualMetrics = this.isDualPageMode()
									? getDualPageMetrics(scrollView)
									: null;
								const step = dualMetrics
									? dualMetrics.spreadStep
									: scrollView.clientWidth;
								const targetScroll = dualMetrics
									? Math.floor((targetPage - 1) / 2) * step
									: (targetPage - 1) * step;
								const maxScroll = Math.max(
									0,
									scrollView.scrollWidth -
										scrollView.clientWidth,
								);

								this.paginator.setCurrentPage(targetPage);
								scrollView.scrollLeft = Math.min(
									targetScroll,
									maxScroll,
								);
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
}
