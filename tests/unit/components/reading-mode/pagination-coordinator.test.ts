import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 在导入 coordinator 前 mock PagePaginator，避免拉入 839 行分页器实现（且便于断言构造参数）
const paginatorInstance = {
	isActive: vi.fn(() => true),
	getCurrentPage: vi.fn(() => 3),
	getCurrentPageText: vi.fn(() => "text"),
	getPageParagraphs: vi.fn(() => []),
	highlightElement: vi.fn(),
	clearHighlight: vi.fn(),
	isDualPageMode: false as boolean,
	updateLayout: vi.fn(),
	setCurrentPage: vi.fn(),
	getTotalPages: vi.fn(() => 10),
	paginateAndShow: vi.fn(),
	destroy: vi.fn(),
};
let capturedOpts: any = null;
vi.mock("@/components/reading-mode/page-paginator.js", () => ({
	PagePaginator: vi.fn((opts: any) => {
		capturedOpts = opts;
		return paginatorInstance;
	}),
}));

import { PaginationCoordinator } from "@/components/reading-mode/pagination-coordinator.js";

function makeDeps(overrides: any = {}) {
	return {
		getActiveContainerEl: vi.fn(() => null),
		getCurrentFile: vi.fn(() => null),
		getBookName: vi.fn(() => "Book"),
		isActive: vi.fn(() => true),
		extractChapterName: vi.fn(() => "Ch"),
		navigateToPrev: vi.fn(async () => true),
		navigateToNext: vi.fn(async () => true),
		getChapterNavigation: vi.fn(() => null),
		recordPage: vi.fn(),
		getSavedPage: vi.fn(() => undefined),
		getPluginSettings: vi.fn(() => ({ autoDualPage: true })),
		onStopReadingTTS: vi.fn(),
		getJumpToLastPage: vi.fn(() => false),
		clearJumpToLastPage: vi.fn(),
		...overrides,
	};
}

// 同步 rAF：让 scrollToElementInColumn / initPaginator 的恢复逻辑同步跑完
function stubRaf() {
	vi.stubGlobal("requestAnimationFrame", (cb: any) => {
		cb(0);
		return 0;
	});
}

describe("PaginationCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// 重新套用 paginatorInstance 的方法实现（vi.clearAllMocks 会清空实现）
		Object.assign(paginatorInstance, {
			isActive: vi.fn(() => true),
			getCurrentPage: vi.fn(() => 3),
			getCurrentPageText: vi.fn(() => "text"),
			getPageParagraphs: vi.fn(() => []),
			highlightElement: vi.fn(),
			clearHighlight: vi.fn(),
			isDualPageMode: false as boolean,
			updateLayout: vi.fn(),
			setCurrentPage: vi.fn(),
			getTotalPages: vi.fn(() => 10),
			paginateAndShow: vi.fn(),
			destroy: vi.fn(),
			nextPage: vi.fn(() => true),
		});
		capturedOpts = null;
		paginatorInstance.isDualPageMode = false;
		stubRaf();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	// ── 委托类（paginated 分支） ──
	it("nextPage 委托给 paginator", () => {
		const c = new PaginationCoordinator(makeDeps());
		(c as any).paginator = paginatorInstance;
		expect(c.nextPage()).toBe(true);
		expect(paginatorInstance.nextPage).toHaveBeenCalled();
	});

	it("isDualPageMode 反映 paginator", () => {
		const c = new PaginationCoordinator(makeDeps());
		(c as any).paginator = paginatorInstance;
		expect(c.isDualPageMode()).toBe(false);
		paginatorInstance.isDualPageMode = true;
		expect(c.isDualPageMode()).toBe(true);
	});

	it("getPaginator 返回内部 paginator 实例", () => {
		const c = new PaginationCoordinator(makeDeps());
		(c as any).paginator = paginatorInstance;
		expect(c.getPaginator()).toBe(paginatorInstance);
	});

	it("getPageParagraphs 分页模式委托 paginator", () => {
		const c = new PaginationCoordinator(makeDeps());
		(c as any).paginator = paginatorInstance;
		paginatorInstance.getPageParagraphs.mockReturnValue([{ element: document.createElement("p"), text: "x" }]);
		const r = c.getPageParagraphs(2);
		expect(paginatorInstance.getPageParagraphs).toHaveBeenCalledWith(2);
		expect(r).toHaveLength(1);
	});

	it("highlightElement 分页模式委托 paginator", () => {
		const c = new PaginationCoordinator(makeDeps());
		(c as any).paginator = paginatorInstance;
		const el = document.createElement("p");
		c.highlightElement(el);
		expect(paginatorInstance.highlightElement).toHaveBeenCalledWith(el);
	});

	it("clearHighlight 分页模式委托 paginator", () => {
		const c = new PaginationCoordinator(makeDeps());
		(c as any).paginator = paginatorInstance;
		c.clearHighlight();
		expect(paginatorInstance.clearHighlight).toHaveBeenCalled();
	});

	it("updateLayout 委托 paginator.updateLayout", () => {
		const c = new PaginationCoordinator(makeDeps());
		(c as any).paginator = paginatorInstance;
		c.updateLayout();
		expect(paginatorInstance.updateLayout).toHaveBeenCalled();
	});

	// ── scrolling 降级分支 ──
	it("getPageParagraphs 滚动模式：取视口内可见段落", () => {
		const container = document.createElement("div");
		const sizer = document.createElement("div");
		sizer.className = "markdown-preview-sizer";
		const p1 = document.createElement("p");
		p1.textContent = "hello";
		p1.getBoundingClientRect = () => ({ top: 10, bottom: 30 } as DOMRect);
		const p2 = document.createElement("p");
		p2.textContent = "world";
		p2.getBoundingClientRect = () => ({ top: 10, bottom: 30 } as DOMRect);
		sizer.appendChild(p1);
		sizer.appendChild(p2);
		container.appendChild(sizer);
		const deps = makeDeps({ getActiveContainerEl: () => container });
		const c = new PaginationCoordinator(deps);
		(c as any).paginator = { isActive: () => false } as any;
		const r = c.getPageParagraphs();
		expect(r).toHaveLength(2);
		expect(r[0].text).toBe("hello");
	});

	it("highlightElement 滚动模式：清旧高亮 + 加新高亮 + scrollIntoView", () => {
		const container = document.createElement("div");
		const el = document.createElement("p");
		const deps = makeDeps({ getActiveContainerEl: () => container });
		const c = new PaginationCoordinator(deps);
		(c as any).paginator = { isActive: () => false } as any;
		c.highlightElement(el);
		expect(el.classList.contains("deeppdf-tts-reading-paragraph")).toBe(true);
		expect(el.scrollIntoView).toBeDefined();
	});

	it("clearHighlight 滚动模式：移除容器内高亮 class", () => {
		const container = document.createElement("div");
		const marked = document.createElement("p");
		marked.classList.add("deeppdf-tts-reading-paragraph");
		container.appendChild(marked);
		const deps = makeDeps({ getActiveContainerEl: () => container });
		const c = new PaginationCoordinator(deps);
		(c as any).paginator = { isActive: () => false } as any;
		c.clearHighlight();
		expect(marked.classList.contains("deeppdf-tts-reading-paragraph")).toBe(false);
	});

	// ── blockId 跳转数学 ──
	it("scrollToElementInColumn 计算横向页并驱动 paginator.setCurrentPage", () => {
		const element = document.createElement("div");
		element.getBoundingClientRect = () =>
			({ left: 900, top: 0, bottom: 20, right: 1100 } as DOMRect);
		const scrollView = document.createElement("div");
		scrollView.getBoundingClientRect = () =>
			({ left: 0, top: 0, bottom: 600, right: 800 } as DOMRect);
		Object.defineProperty(scrollView, "clientWidth", { value: 800, configurable: true });
		(scrollView as any).scrollTo = vi.fn();
		const c = new PaginationCoordinator(makeDeps());
		(c as any).paginator = paginatorInstance;
		c.scrollToElementInColumn(element, scrollView);
		expect(paginatorInstance.setCurrentPage).toHaveBeenCalledWith(2);
		expect(scrollView.scrollTo).toHaveBeenCalledWith({ left: 800, behavior: "smooth" });
	});

	// ── hashchange 双重保险 ──
	it("hashchange 命中 #^blockId 经 jumpToBlockId 触发跳转", () => {
		const scrollView = document.createElement("div");
		scrollView.className = "markdown-preview-view";
		scrollView.getBoundingClientRect = () =>
			({ left: 0, top: 0, bottom: 600, right: 800 } as DOMRect);
		Object.defineProperty(scrollView, "clientWidth", { value: 800, configurable: true });
		(scrollView as any).scrollTo = vi.fn();
		const target = document.createElement("div");
		target.id = "abc";
		target.getBoundingClientRect = () =>
			({ left: 900, top: 0, bottom: 20, right: 1100 } as DOMRect);
		const root = document.createElement("div");
		root.className = "deeppdf-reading-mode";
		root.appendChild(scrollView);
		scrollView.appendChild(target);
		document.body.appendChild(root);

		const c = new PaginationCoordinator(makeDeps());
		(c as any).paginator = paginatorInstance;
		c.setupHashChangeHandler();
		window.location.hash = "#^abc";
		window.dispatchEvent(new Event("hashchange"));
		expect(paginatorInstance.setCurrentPage).toHaveBeenCalled();
		c.teardownHashChangeHandler();
		document.body.removeChild(root);
	});

	// ── 生命周期 ──
	it("recordCurrentPage 经 deps.recordPage 写入当前文件 + 当前页", () => {
		const deps = makeDeps({
			getCurrentFile: () => ({ path: "a.md" }) as any,
		});
		const c = new PaginationCoordinator(deps);
		(c as any).paginator = paginatorInstance;
		c.recordCurrentPage();
		expect(deps.recordPage).toHaveBeenCalledWith("a.md", 3);
	});

	it("destroyPaginator 调 paginator.destroy 并置空", () => {
		const c = new PaginationCoordinator(makeDeps());
		(c as any).paginator = paginatorInstance;
		c.destroyPaginator();
		expect(paginatorInstance.destroy).toHaveBeenCalled();
		expect((c as any).paginator).toBeNull();
	});

	// ── initPaginator 接线 ──
	it("initPaginator 成功路径：构造 PagePaginator 并接线回调 + 恢复页码", () => {
		const container = document.createElement("div");
		const sizer = document.createElement("div");
		sizer.className = "markdown-preview-sizer";
		sizer.appendChild(document.createElement("p"));
		sizer.appendChild(document.createElement("p"));
		const preview = document.createElement("div");
		preview.className = "markdown-preview-view";
		Object.defineProperty(preview, "clientWidth", { value: 800, configurable: true });
		Object.defineProperty(preview, "scrollWidth", { value: 1600, configurable: true });
		container.appendChild(sizer);
		container.appendChild(preview);

		const deps = makeDeps({
			getActiveContainerEl: () => container,
			getCurrentFile: () => ({ path: "a.md" }) as any,
			getSavedPage: () => 4,
		});
		const c = new PaginationCoordinator(deps);
		c.initPaginator();

		expect(capturedOpts).not.toBeNull();
		expect(capturedOpts.container).toBe(sizer);
		expect(capturedOpts.bookName).toBe("Book");
		expect(capturedOpts.chapterName).toBe("Ch");
		expect(capturedOpts.autoDualPage).toBe(true);

		// 翻页回调
		capturedOpts.onPageChange(5);
		expect(deps.recordPage).toHaveBeenCalledWith("a.md", 5);
		expect(deps.onStopReadingTTS).toHaveBeenCalled();
		capturedOpts.onNavigatePrev();
		expect(deps.navigateToPrev).toHaveBeenCalled();
		expect(capturedOpts.hasPrevChapter()).toBe(
			deps.getChapterNavigation()?.prev != null,
		);

		// 恢复页码（savedPage=4 → setCurrentPage(4)）
		expect(paginatorInstance.setCurrentPage).toHaveBeenCalledWith(4);
	});

	it("initPaginator：_jumpToLastPage 置位时恢复到末页并清除标记", () => {
		const container = document.createElement("div");
		const sizer = document.createElement("div");
		sizer.className = "markdown-preview-sizer";
		sizer.appendChild(document.createElement("p"));
		sizer.appendChild(document.createElement("p"));
		const preview = document.createElement("div");
		preview.className = "markdown-preview-view";
		Object.defineProperty(preview, "clientWidth", { value: 800, configurable: true });
		Object.defineProperty(preview, "scrollWidth", { value: 1600, configurable: true });
		container.appendChild(sizer);
		container.appendChild(preview);

		const deps = makeDeps({
			getActiveContainerEl: () => container,
			getCurrentFile: () => ({ path: "a.md" }) as any,
			getJumpToLastPage: () => true,
		});
		const c = new PaginationCoordinator(deps);
		c.initPaginator();
		expect(deps.clearJumpToLastPage).toHaveBeenCalled();
		// totalPages=10 → 恢复到第 10 页
		expect(paginatorInstance.setCurrentPage).toHaveBeenCalledWith(10);
	});
});
