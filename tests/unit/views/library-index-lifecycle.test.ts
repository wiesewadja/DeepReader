/**
 * IndexLifecycle 单测
 * 覆盖 handleAddDocument 中 bookId 替换 prelimId 时的 lastIndexStates re-key 行为，
 * 防止 polling 把 bookId 当作新索引导致 addNewCards 追加重复卡片、原卡片冻结。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";

// 关键：在导入 IndexLifecycle 前 mock 依赖
vi.mock("@/ui/pdf-file-selector.js", () => {
	return {
		PDFFileSelectorModal: vi.fn().mockImplementation((_app, onSelect) => ({
			open: () => {
				// 同步触发选择回调，模拟用户选了一个 vault 里的 EPUB
				onSelect({
					name: "test.epub",
					path: "/tmp/deepreader-test-vault/test.epub",
					size: 1024,
					sizeFormatted: "1 KB",
					folder: "",
					docType: "epub",
				});
			},
		})),
		isSystemFileInfo: vi.fn(() => false),
	};
});

vi.mock("@/pageindex/book-indexer.js", () => {
	return {
		indexBook: vi.fn().mockImplementation(async (options) => {
			// 模拟：先报告 EPUB 12% 进度，再等 handleAddDocument 主动 cancel
			options.onProgress?.({ percent: 12, step: "parse_complete", stepLabel: "文档索引完成" });
			// 等到外部 abort（用 never-resolving promise 模拟长时间任务）
			await new Promise(() => {});
		}),
		generateBookId: vi.fn().mockImplementation(async (filePath: string) => {
			// 用文件内容 hash（与生产实现相同）— 必然与 generateBookIdFromPath 不同
			const content = await fs.readFile(filePath);
			const crypto = await import("crypto");
			return crypto
				.createHash("sha256")
				.update(content)
				.update(Buffer.from(String(content.length)))
				.digest("hex")
				.slice(0, 8);
		}),
		generateBookIdFromPath: vi.fn().mockImplementation((filePath: string) => {
			const crypto = require("crypto");
			return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 8);
		}),
	};
});

vi.mock("@/config/providers.js", () => ({
	resolveRoleConfig: vi.fn(() => ({ apiKey: "test-key", model: "gpt-4o-mini" })),
}));

vi.mock("@/config/role-adapters.js", () => ({
	toEmbeddingOptions: vi.fn(() => undefined),
	toPropositionConfig: vi.fn(() => undefined),
}));

vi.mock("@/utils/mobile-fs.js", () => ({
	getVaultPath: vi.fn(() => "/tmp/deepreader-test-vault"),
}));

import { IndexLifecycle } from "@/views/library/library-index-lifecycle.js";
import type { IndexListItem } from "@/types/index.js";

describe("IndexLifecycle.handleAddDocument — lastIndexStates re-key", () => {
	const testVaultPath = "/tmp/deepreader-test-vault";
	let cardElements: Map<string, HTMLElement>;
	let indexes: IndexListItem[];
	let newCardsCreated: HTMLElement[];
	let renderedIndexes: IndexListItem[];

	beforeEach(async () => {
		// 准备测试 vault + 文件
		await fs.mkdir(testVaultPath, { recursive: true });
		await fs.writeFile(path.join(testVaultPath, "test.epub"), "EPUB test content for hash");
		await fs.mkdir(path.join(testVaultPath, ".obsidian/plugins/deepreader"), { recursive: true });

		cardElements = new Map();
		indexes = [];
		newCardsCreated = [];
		renderedIndexes = [];

		vi.clearAllMocks();
	});

	afterEach(async () => {
		await fs.rm(testVaultPath, { recursive: true, force: true });
	});

	function createLifecycle() {
		const callbacks = {
			app: { vault: {} } as any,
			plugin: {
				settings: {
					ifAddNodeSummary: true,
					providers: {},
				},
			},
			getIndexes: () => indexes,
			setIndexes: (next: IndexListItem[]) => {
				indexes = next;
			},
			getCardElements: () => cardElements,
			getDisplayName: (name: string) => name.replace(/\.[^.]+$/, ""),
			onRenderGrid: () => {
				// 模拟 library-view renderGrid：清空 cardElements，按 indexes 顺序创建 card
				cardElements.clear();
				for (const idx of indexes) {
					const card = document.createElement("div");
					card.dataset.bookId = idx.id;
					cardElements.set(idx.id, card);
					renderedIndexes.push(idx);
				}
			},
			onCreateBookCard: (index: IndexListItem) => {
				const card = document.createElement("div");
				card.dataset.bookId = index.id;
				newCardsCreated.push(card);
				return card;
			},
			onRefreshIndexes: vi.fn(async () => {
				// 模拟 sidebar loadIndexes：从文件读取
				const PAGEINDEX_DIR = ".obsidian/plugins/deepreader/pageindex";
				try {
					const folders = await fs.readdir(path.join(testVaultPath, PAGEINDEX_DIR));
					const result: IndexListItem[] = [];
					for (const folder of folders) {
						try {
							const statusContent = await fs.readFile(
								path.join(testVaultPath, PAGEINDEX_DIR, folder, ".indexing.json"),
								"utf-8"
							);
							const status = JSON.parse(statusContent);
							if (status.step !== "complete") {
								result.push({
									id: status.bookId || folder,
									pdf_name: status.title || folder,
									fileType: status.fileType,
									node_count: 0,
									created_at: new Date().toISOString(),
									status: "processing",
									progress_percent: status.percent || 0,
									message: status.stepLabel,
								});
							}
						} catch { /* skip */ }
					}
					return result;
				} catch {
					return [];
				}
			}),
			onRefreshExternal: vi.fn(async () => []),
			externalIndexes: [],
			coverManager: { getCache: () => new Map(), getLoadingCovers: () => new Set() } as any,
			gridEl: document.createElement("div"),
			options: {},
		};

		return new IndexLifecycle(callbacks);
	}

	it("re-keys lastIndexStates from prelimId to bookId when they differ", async () => {
		const lifecycle = createLifecycle();

		// 不 await — indexBook mock 会永远 pending，我们只要拿到 re-key 后的状态
		const handlePromise = lifecycle.handleAddDocument();

		// 等 handleAddDocument 走完 prelimId 渲染和 bookId 生成
		await new Promise((resolve) => setTimeout(resolve, 100));

		// 此时 handleAddDocument 已经 re-key，但 indexBook 还在等
		const lastStates = lifecycle.getLastIndexStates();
		const cardElems = cardElements;

		// 找到当前唯一的 book id
		const bookIds = Array.from(lastStates.keys());
		expect(bookIds.length).toBe(1);

		const onlyId = bookIds[0]!;
		// 这个 id 不应该是 prelimId — 应该是基于内容的 bookId
		// prelimId = sha256("/tmp/deepreader-test-vault/test.epub").slice(0,8)
		// bookId   = sha256(fileContent + size).slice(0,8)
		const crypto = await import("crypto");
		const expectedPrelimId = crypto
			.createHash("sha256")
			.update("/tmp/deepreader-test-vault/test.epub")
			.digest("hex")
			.slice(0, 8);
		expect(onlyId).not.toBe(expectedPrelimId);

		// 关键断言：cardElements 也只用一个 id
		expect(cardElems.has(expectedPrelimId)).toBe(false);
		expect(cardElems.has(onlyId)).toBe(true);

		// 关键断言：lastIndexStates 只有 bookId（re-key 成功）
		expect(lastStates.has(expectedPrelimId)).toBe(false);
		expect(lastStates.has(onlyId)).toBe(true);

		// 清理：手动 abort
		handlePromise.catch(() => {});
	});

	it("polling 后不会创建重复卡片（修复前会创建）", async () => {
		const lifecycle = createLifecycle();

		const handlePromise = lifecycle.handleAddDocument();
		await new Promise((resolve) => setTimeout(resolve, 100));

		const bookIdsBeforePoll = Array.from(cardElements.keys());
		expect(bookIdsBeforePoll.length).toBe(1);

		// 模拟文件里 .indexing.json 已存在（indexBook 的 reportProgress 会写）
		const bookId = bookIdsBeforePoll[0]!;
		const PAGEINDEX_DIR = ".obsidian/plugins/deepreader/pageindex";
		const indexDir = path.join(testVaultPath, PAGEINDEX_DIR, bookId);
		await fs.mkdir(indexDir, { recursive: true });
		await fs.writeFile(
			path.join(indexDir, ".indexing.json"),
			JSON.stringify({
				bookId,
				filePath: "/tmp/deepreader-test-vault/test.epub",
				fileType: "epub",
				title: "test",
				percent: 12,
				step: "parse_complete",
				stepLabel: "文档索引完成",
			})
		);

		// 触发 polling 一次
		await lifecycle.refreshIndexes();

		// 关键断言：polling 后 cardElements 仍然只有 1 个 entry（不重复）
		const bookIdsAfterPoll = Array.from(cardElements.keys());
		expect(bookIdsAfterPoll.length).toBe(1);
		expect(bookIdsAfterPoll[0]).toBe(bookId);

		// 关键断言：grid 中只有 1 张卡片（不重复）
		const cardsInGrid = cardElements.size;
		expect(cardsInGrid).toBe(1);

		// 关键断言：lastIndexStates 中只有 1 个 entry
		const lastStatesAfterPoll = lifecycle.getLastIndexStates();
		expect(lastStatesAfterPoll.size).toBe(1);
		expect(lastStatesAfterPoll.has(bookId)).toBe(true);

		// 清理
		handlePromise.catch(() => {});
	});

	it("onProgress 通过 cardElements[bookId] 更新同一卡片（不会创建新卡片）", async () => {
		const lifecycle = createLifecycle();

		const handlePromise = lifecycle.handleAddDocument();
		await new Promise((resolve) => setTimeout(resolve, 100));

		const bookId = Array.from(cardElements.keys())[0]!;
		const cardBefore = cardElements.get(bookId);

		expect(cardBefore).toBeDefined();

		// 模拟 polling 后再调一次 onProgress
		await lifecycle.refreshIndexes();

		// cardElements[bookId] 应该是同一个 DOM 元素
		const cardAfter = cardElements.get(bookId);
		expect(cardAfter).toBe(cardBefore); // 同一引用

		// DOM 中不应该出现第二张卡片
		expect(cardElements.size).toBe(1);

		// 清理
		handlePromise.catch(() => {});
	});
});
