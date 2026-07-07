import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TFile, App } from "obsidian";
import { PageMemoryStore } from "../../../../src/components/reading-mode/page-memory-store.js";

// 持久化与 vault 路径助手：解析到与实现相同的绝对模块，便于 vi.mock 拦截
// 用 importOriginal 穿透真实常量（如 MAX_ENTRIES），保持测试与实现单一事实源
vi.mock("../../../../src/pageindex/last-page-store.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../../src/pageindex/last-page-store.js")>();
	return {
		...actual,
		loadLastPages: vi.fn(),
		saveLastPages: vi.fn(),
	};
});
vi.mock("../../../../src/utils/mobile-fs.js", () => ({
	getVaultPath: vi.fn(),
}));

import { loadLastPages } from "../../../../src/pageindex/last-page-store.js";
import { getVaultPath } from "../../../../src/utils/mobile-fs.js";

const VL = vi.mocked(loadLastPages);
const GVP = vi.mocked(getVaultPath);
const SLP = vi.mocked((await import("../../../../src/pageindex/last-page-store.js")).saveLastPages);

function makeStore(totalPagesProvider: () => number | undefined = () => undefined): {
	store: PageMemoryStore;
	app: InstanceType<typeof App>;
} {
	const app = new App();
	const store = new PageMemoryStore(app as unknown as import("obsidian").App, "test-plugin", totalPagesProvider);
	return { store, app };
}

function fillMaps(store: PageMemoryStore, entries: Record<string, { page: number; time: number }>) {
	const s = store as unknown as {
		pageMemory: Map<string, number>;
		lastReadAt: Map<string, number>;
	};
	for (const [k, v] of Object.entries(entries)) {
		s.pageMemory.set(k, v.page);
		s.lastReadAt.set(k, v.time);
	}
}

beforeEach(() => {
	GVP.mockReturnValue("/fake/vault");
	VL.mockResolvedValue({ pages: new Map(), lastReadAt: new Map() });
	SLP.mockResolvedValue(undefined);
	vi.spyOn(Date, "now").mockReturnValue(1000);
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("PageMemoryStore.recordPage", () => {
	it("记录页码与最近阅读时间戳", () => {
		const { store } = makeStore();
		store.recordPage("DeepReader/book/a.md", 3);
		const s = store as unknown as { pageMemory: Map<string, number>; lastReadAt: Map<string, number> };
		expect(s.pageMemory.get("DeepReader/book/a.md")).toBe(3);
		expect(s.lastReadAt.get("DeepReader/book/a.md")).toBe(1000);
	});

	it("拒绝空路径 / 非有限页码 / 小于 1 / 负数", () => {
		const { store } = makeStore();
		store.recordPage("", 1);
		store.recordPage("x.md", NaN);
		store.recordPage("x.md", 0);
		store.recordPage("x.md", -3);
		const s = store as unknown as { pageMemory: Map<string, number> };
		expect(s.pageMemory.size).toBe(0);
	});

	it("页码超过总页数时拒绝（totalPagesProvider 生效）", () => {
		const { store } = makeStore(() => 10);
		store.recordPage("x.md", 11);
		const s = store as unknown as { pageMemory: Map<string, number> };
		expect(s.pageMemory.has("x.md")).toBe(false);
		store.recordPage("x.md", 10);
		expect(s.pageMemory.get("x.md")).toBe(10);
	});

	it("超过 500 条时按最旧时间淘汰", () => {
		const { store } = makeStore();
		const s = store as unknown as { pageMemory: Map<string, number>; lastReadAt: Map<string, number> };
		for (let i = 1; i <= 500; i++) {
			s.pageMemory.set(`f${i}.md`, i);
			s.lastReadAt.set(`f${i}.md`, i); // 时间 1..500
		}
		store.recordPage("new.md", 5); // 时间戳 = 1000（最新）
		expect(s.pageMemory.size).toBe(500);
		expect(s.pageMemory.has("f1.md")).toBe(false); // 时间 1 最旧被淘汰
		expect(s.pageMemory.has("new.md")).toBe(true);
	});
});

describe("PageMemoryStore.scheduleSave / flushSave", () => {
	it("翻页后 200ms debounce 触发 saveLastPages", async () => {
		const { store } = makeStore();
		store.recordPage("DeepReader/book/a.md", 2);
		await vi.advanceTimersByTimeAsync(200);
		expect(GVP).toHaveBeenCalled();
		expect(SLP).toHaveBeenCalledOnce();
		const [, pages, lastReadAt, pluginId] = SLP.mock.calls[0];
		expect(pluginId).toBe("test-plugin");
		expect(pages.get("DeepReader/book/a.md")).toBe(2);
		expect(lastReadAt.get("DeepReader/book/a.md")).toBe(1000);
	});

	it("pageMemory 为空时 flushSave 不写盘", async () => {
		const { store } = makeStore();
		await store.flushSave();
		expect(SLP).not.toHaveBeenCalled();
	});
});

describe("PageMemoryStore.loadLastPagesFromDisk", () => {
	it("从 loadLastPages 填充内存 map", async () => {
		const pages = new Map([["a.md", 7]]);
		const lastReadAt = new Map([["a.md", 99]]);
		VL.mockResolvedValue({ pages, lastReadAt });
		const { store } = makeStore();
		store.loadLastPagesFromDisk();
		// loadLastPages 是异步的；在 fake timers 下用 advanceTimersByTimeAsync 冲刷 microtask
		await vi.advanceTimersByTimeAsync(0);
		const s = store as unknown as { pageMemory: Map<string, number> };
		expect(s.pageMemory.get("a.md")).toBe(7);
	});

	it("vaultPath 为空时静默跳过", () => {
		GVP.mockReturnValue("");
		const { store } = makeStore();
		store.loadLastPagesFromDisk();
		expect(VL).not.toHaveBeenCalled();
	});
});

describe("PageMemoryStore 查询", () => {
	it("findMostRecentInFolder 返回文件夹下最近阅读路径", () => {
		const { store } = makeStore();
		fillMaps(store, {
			"DeepReader/book/ch1.md": { page: 1, time: 100 },
			"DeepReader/book/ch2.md": { page: 2, time: 300 },
			"DeepReader/other/x.md": { page: 1, time: 999 },
		});
		expect(store.findMostRecentInFolder("DeepReader/book")).toBe("DeepReader/book/ch2.md");
	});

	it("getBookLastReadTime 返回文件夹下最大时间戳（无记录为 0）", () => {
		const { store } = makeStore();
		fillMaps(store, {
			"DeepReader/book/ch1.md": { page: 1, time: 100 },
			"DeepReader/book/ch2.md": { page: 2, time: 300 },
		});
		expect(store.getBookLastReadTime("DeepReader/book")).toBe(300);
		expect(store.getBookLastReadTime("DeepReader/nope")).toBe(0);
	});
});

describe("PageMemoryStore.resolveMostRecentFile", () => {
	it("文件存在时返回 TFile", () => {
		const { store, app } = makeStore();
		fillMaps(store, { "DeepReader/book/ch2.md": { page: 2, time: 300 } });
		app.vault.getAbstractFileByPath.mockReturnValue(new TFile("DeepReader/book/ch2.md"));
		const file = store.resolveMostRecentFile();
		expect(file).toBeInstanceOf(TFile);
		expect(file?.path).toBe("DeepReader/book/ch2.md");
	});

	it("文件已删除时清理历史并返回 null", () => {
		const { store, app } = makeStore();
		fillMaps(store, { "DeepReader/book/gone.md": { page: 2, time: 300 } });
		app.vault.getAbstractFileByPath.mockReturnValue(undefined);
		const file = store.resolveMostRecentFile();
		expect(file).toBeNull();
		const s = store as unknown as { pageMemory: Map<string, number> };
		expect(s.pageMemory.has("DeepReader/book/gone.md")).toBe(false);
	});
});
