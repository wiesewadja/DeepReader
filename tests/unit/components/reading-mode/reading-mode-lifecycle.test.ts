/**
 * ReadingModeLifecycle 单元测试
 * 验证生命周期深模块（activate/deactivate/start/stop/openMostRecent）在抽出后行为等价：
 * - 状态（isActive/currentFile/activeContainerEl）正确翻转
 * - 对 5 个 coordinator 的委托调用正确
 * - ScrollPatchService 契约：installScrollPatch 作用在 Shell 实例（getScrollPatchTarget）上
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TFile } from "obsidian";
import type { ReadingModeLifecycle } from "@/components/reading-mode/reading-mode-lifecycle.js";
import type { ReadingModeLifecycleDeps } from "@/components/reading-mode/reading-mode-lifecycle.js";

// 仅 mock 会在 lifecycle 内 `new` 的 UI 组件，避免触碰真实 DOM 构造
vi.mock("@/components/reading-mode/chapter-nav.js", () => ({
	ChapterNav: vi.fn(() => ({
		init: vi.fn(),
		hide: vi.fn(),
		destroy: vi.fn(),
	})),
}));
vi.mock("@/components/reading-mode/selection-toolbar.js", () => ({
	SelectionToolbar: vi.fn(() => ({
		init: vi.fn(),
		destroy: vi.fn(),
	})),
}));
vi.mock("@/components/reading-mode/scroll-patch.js", () => ({
	installScrollPatch: vi.fn(),
	uninstallScrollPatch: vi.fn(),
}));

import { ReadingModeLifecycle } from "@/components/reading-mode/reading-mode-lifecycle.js";
import { installScrollPatch, uninstallScrollPatch } from "@/components/reading-mode/scroll-patch.js";

function makeFile(path: string): TFile {
	return { path, extension: "md" } as unknown as TFile;
}

function makeDeps(overrides: Partial<ReadingModeLifecycleDeps> = {}) {
	const containerEl = document.createElement("div");
	const view = { file: { path: "DeepReader/Book/ch.md" }, containerEl, getMode: () => "preview", setState: vi.fn() };
	const leaf = { view };
	const fakeApp: any = {
		workspace: {
			getLeavesOfType: vi.fn(() => [leaf]),
			setActiveLeaf: vi.fn(),
			getActiveViewOfType: vi.fn(() => view),
			on: vi.fn(() => "event-ref"),
			offref: vi.fn(),
			onLayoutReady: vi.fn((cb: () => void) => cb()),
			getActiveFile: vi.fn(() => makeFile("DeepReader/Book/ch.md")),
			layoutReady: true,
			getLeaf: vi.fn(() => ({ openFile: vi.fn() })),
		},
		metadataCache: {
			getFileCache: vi.fn(() => ({ frontmatter: { index_id: "idx1" } })),
			on: vi.fn(() => "mc-ref"),
		},
		plugins: { plugins: { "deepreader-dev": { settings: {} } } },
	};

	const callbacks = {
		onBookDetected: vi.fn(),
		onStopReadingTTS: vi.fn(),
		onDeactivate: vi.fn(),
	};

	const chapterDetection: any = {
		isChapterFile: vi.fn(() => true),
		getBookNameFromFile: vi.fn(() => "Book"),
		getChapterNavigation: vi.fn(() => null),
		extractChapterName: vi.fn(() => "Chapter"),
	};
	const chapterNavigator: any = {
		navigateToPrev: vi.fn(async () => true),
		navigateToNext: vi.fn(async () => true),
	};
	const paginationCoordinator: any = {
		destroyPaginator: vi.fn(),
		initPaginator: vi.fn(),
		setupHashChangeHandler: vi.fn(),
		teardownHashChangeHandler: vi.fn(),
		recordCurrentPage: vi.fn(),
		getPaginator: vi.fn(() => null),
		updateLayout: vi.fn(),
	};
	const chatWidget: any = {
		initMobileFab: vi.fn(),
		updateVisibility: vi.fn(),
		toggleMobileNavbar: vi.fn(),
		destroy: vi.fn(),
		notifyChatStarted: vi.fn(),
		notifyChatReplyReceived: vi.fn(),
		clearChatThinking: vi.fn(),
		setXitongReading: vi.fn(),
	};
	const pageMemoryStore: any = {
		loadLastPagesFromDisk: vi.fn(),
		recordPage: vi.fn(),
		flushSave: vi.fn(async () => {}),
		findMostRecentInFolder: vi.fn(() => null),
		getBookLastReadTime: vi.fn(() => 0),
		resolveMostRecentFile: vi.fn(() => null),
		getPage: vi.fn(() => 1),
	};

	const scrollPatchTarget = { isActive: false, activeContainerEl: null, scrollToElementInColumn: vi.fn() };

	return {
		deps: {
			app: fakeApp,
			pluginId: "deepreader-dev",
			chapterDetection,
			chapterNavigator,
			paginationCoordinator,
			chatWidget,
			pageMemoryStore,
			getCallbacks: () => callbacks,
			getStyle: () => "paginated" as const,
			getAutoEnable: () => true,
			getScrollPatchTarget: () => scrollPatchTarget,
			...overrides,
		},
		callbacks,
		chapterDetection,
		chapterNavigator,
		paginationCoordinator,
		chatWidget,
		pageMemoryStore,
		scrollPatchTarget,
		view,
	};
}

describe("ReadingModeLifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("构造后处于未激活态，关键状态为 null", () => {
		const { deps } = makeDeps();
		const lc = new ReadingModeLifecycle(deps);
		expect(lc.isActive).toBe(false);
		expect(lc.activeContainerEl).toBeNull();
		expect(lc.currentFile).toBeNull();
	});

	it("activate 设置状态并委托 coordinator（paginated 模式）", () => {
		const { deps, paginationCoordinator, chatWidget, scrollPatchTarget } = makeDeps();
		const lc = new ReadingModeLifecycle(deps);
		const file = makeFile("DeepReader/Book/ch.md");

		lc.activate(file);
		// activate 同步部分
		expect(lc.isActive).toBe(true);
		expect(lc.currentFile).toBe(file);
		expect(lc.activeContainerEl).toBe(deps.app.workspace.getLeavesOfType()[0].view.containerEl);
		// 立即销毁旧分页器
		expect(paginationCoordinator.destroyPaginator).toHaveBeenCalled();

		// paginated 模式下 initPaginator / installScrollPatch / setupHashChangeHandler 在 setTimeout(200) 内
		vi.advanceTimersByTime(200);
		expect(paginationCoordinator.initPaginator).toHaveBeenCalled();
		expect(chatWidget.initMobileFab).toHaveBeenCalled();
		expect(chatWidget.updateVisibility).toHaveBeenCalled();
		expect(chatWidget.toggleMobileNavbar).toHaveBeenCalledWith(false);
		// CRITICAL: ScrollPatchService 契约作用在 Shell 实例上
		expect(installScrollPatch).toHaveBeenCalledWith(scrollPatchTarget);
		expect(paginationCoordinator.setupHashChangeHandler).toHaveBeenCalled();
	});

	it("deactivate 复位状态并清理 coordinator", () => {
		const { deps, paginationCoordinator, chatWidget, pageMemoryStore, scrollPatchTarget } = makeDeps();
		const lc = new ReadingModeLifecycle(deps);
		lc.activate(makeFile("DeepReader/Book/ch.md"));
		vi.advanceTimersByTime(200);

		lc.deactivate();
		expect(lc.isActive).toBe(false);
		expect(lc.currentFile).toBeNull();
		expect(lc.activeContainerEl).toBeNull();
		expect(paginationCoordinator.recordCurrentPage).toHaveBeenCalled();
		expect(chatWidget.destroy).toHaveBeenCalled();
		expect(paginationCoordinator.destroyPaginator).toHaveBeenCalled();
		expect(uninstallScrollPatch).toHaveBeenCalledWith(scrollPatchTarget);
		expect(paginationCoordinator.teardownHashChangeHandler).toHaveBeenCalled();
		expect(chatWidget.toggleMobileNavbar).toHaveBeenCalledWith(true);
	});

	it("start 注册事件并初始化导航/工具栏", () => {
		const { deps, pageMemoryStore, chapterDetection } = makeDeps();
		const lc = new ReadingModeLifecycle(deps);
		lc.start();
		expect(pageMemoryStore.loadLastPagesFromDisk).toHaveBeenCalled();
		// 事件注册
		const on = deps.app.workspace.on as ReturnType<typeof vi.fn>;
		expect(on).toHaveBeenCalledWith("layout-change", expect.any(Function));
		expect(on).toHaveBeenCalledWith("resize", expect.any(Function));
		expect(on).toHaveBeenCalledWith("file-open", expect.any(Function));
		expect(deps.app.metadataCache.on).toHaveBeenCalledWith("resolved", expect.any(Function));
		// onLayoutReady 已被同步触发（layoutReady=true）
		expect(deps.app.workspace.onLayoutReady).toHaveBeenCalled();
		void chapterDetection;
	});

	it("stop 清理所有事件监听与组件", () => {
		const { deps, paginationCoordinator, pageMemoryStore } = makeDeps();
		const lc = new ReadingModeLifecycle(deps);
		lc.start();
		lc.stop();
		expect(paginationCoordinator.destroyPaginator).toHaveBeenCalled();
		expect(deps.app.workspace.offref).toHaveBeenCalled();
		expect(pageMemoryStore.flushSave).toHaveBeenCalled();
	});

	it("openMostRecent 解析到文件后激活", async () => {
		const { deps, pageMemoryStore } = makeDeps();
		pageMemoryStore.resolveMostRecentFile.mockReturnValue(makeFile("DeepReader/Book/ch.md"));
		const lc = new ReadingModeLifecycle(deps);
		const result = await lc.openMostRecent();
		expect(result).toBe(true);
		// 激活后状态翻转（activate 同步设置 isActive）
		expect(lc.isActive).toBe(true);
	});

	it("openMostRecent 无历史时返回 false", async () => {
		const { deps, pageMemoryStore } = makeDeps();
		pageMemoryStore.resolveMostRecentFile.mockReturnValue(null);
		const lc = new ReadingModeLifecycle(deps);
		const result = await lc.openMostRecent();
		expect(result).toBe(false);
	});
});
