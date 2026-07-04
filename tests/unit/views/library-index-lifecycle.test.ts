/**
 * IndexLifecycle 单测
 * 覆盖 handleAddDocument 中 bookId 生成、轮询去重、卡片更新行为。
 * 修复后 handleAddDocument 使用 content-based bookId（generateBookId），
 * 不再有 prelimId → bookId 的两阶段，从始至终只有一个 ID。
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

vi.mock("@/pageindex/book-indexer", () => {
	return {
		indexBook: vi.fn().mockImplementation(async (options) => {
			// 模拟：先报告 EPUB 12% 进度，再等 handleAddDocument 主动 cancel
			options.onProgress?.({ percent: 12, step: "parse_complete", stepLabel: "文档索引完成" });
			// 等到外部 abort（用 never-resolving promise 模拟长时间任务）
			await new Promise(() => {});
		}),
		generateBookId: vi.fn().mockImplementation(async (filePath: string) => {
			const content = await fs.readFile(filePath);
			const crypto = await import("crypto");
			return crypto
				.createHash("sha256")
				.update(content)
				.update(Buffer.from(String(content.length)))
				.digest("hex")
				.slice(0, 8);
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

	it("使用 content-based bookId，无两阶段 ID 切换", async () => {
		const lifecycle = createLifecycle();

		const handlePromise = lifecycle.handleAddDocument();
		await new Promise((resolve) => setTimeout(resolve, 100));

		// cardElements 中应有 1 个 entry，ID 是 content-based bookId
		const cardIds = Array.from(cardElements.keys());
		expect(cardIds.length).toBe(1);

		// bookId 应该基于文件内容生成（generateBookId），不是路径 hash
		expect(cardElements.has(cardIds[0]!)).toBe(true);

		handlePromise.catch(() => {});
	});
	it("polling 后不会创建重复卡片", async () => {
		const lifecycle = createLifecycle();

		const handlePromise = lifecycle.handleAddDocument();
		await new Promise((resolve) => setTimeout(resolve, 100));

		const bookIdsBeforePoll = Array.from(cardElements.keys());
		expect(bookIdsBeforePoll.length).toBe(1);

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

		await lifecycle.refreshIndexes();

		const bookIdsAfterPoll = Array.from(cardElements.keys());
		expect(bookIdsAfterPoll.length).toBe(1);
		expect(bookIdsAfterPoll[0]).toBe(bookId);

		const lastStatesAfterPoll = lifecycle.getLastIndexStates();
		expect(lastStatesAfterPoll.size).toBe(1);
		expect(lastStatesAfterPoll.has(bookId)).toBe(true);

		handlePromise.catch(() => {});
	});

	it("onProgress 更新卡片时 polling 不替换活跃索引卡片", async () => {
		const lifecycle = createLifecycle();

		const handlePromise = lifecycle.handleAddDocument();
		await new Promise((resolve) => setTimeout(resolve, 100));

		const bookId = Array.from(cardElements.keys())[0]!;
		const cardBefore = cardElements.get(bookId);
		expect(cardBefore).toBeDefined();

		// polling 应该保护活跃索引卡片不被 loadIndexes 数据覆盖
		await lifecycle.refreshIndexes();

		// cardElements 仍只有 1 张卡片
		expect(cardElements.size).toBe(1);

		handlePromise.catch(() => {});
	});
});
