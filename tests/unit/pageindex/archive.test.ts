/**
 * Archive 模块单元测试
 *
 * 覆盖：
 * - loadArchivedBookIds：catalog 不存在 / 空 / 有归档
 * - toggleArchive：切换状态、bookId 不存在时创建占位条目
 * - batchToggleArchive：批量归档 / 取消归档、跳过缺失条目
 * - removeFromCatalog：清理条目、catalog 不存在时降级
 * - 原子写入：损坏检测、临时文件清理
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import {
	loadArchivedBookIds,
	toggleArchive,
	batchToggleArchive,
	removeFromCatalog,
} from "@/pageindex/archive";
import type { CatalogMeta } from "@/pageindex/vault/types";
import { getCatalogPath } from "@/pageindex/paths.js";

const VAULT = "/tmp/deepreader-archive-test";
const CATALOG_PATH = getCatalogPath(VAULT);

function makeCatalog(books: Record<string, Partial<CatalogMeta["books"][string]>> = {}): CatalogMeta {
	const out: CatalogMeta = { version: 1, books: {} };
	for (const [id, entry] of Object.entries(books)) {
		out.books[id] = {
			title: entry.title ?? `Book ${id}`,
			vectorModel: entry.vectorModel ?? "test-model",
			dimensions: entry.dimensions ?? 1024,
			nodeCount: entry.nodeCount ?? 0,
			hasPropositions: entry.hasPropositions ?? false,
			indexedAt: entry.indexedAt ?? new Date().toISOString(),
			archived: entry.archived,
		};
	}
	return out;
}

async function writeCatalogFile(catalog: CatalogMeta): Promise<void> {
	await fs.mkdir(path.dirname(CATALOG_PATH), { recursive: true });
	await fs.writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2), "utf-8");
}

async function readCatalogFile(): Promise<CatalogMeta | null> {
	try {
		const content = await fs.readFile(CATALOG_PATH, "utf-8");
		return JSON.parse(content);
	} catch {
		return null;
	}
}

describe("archive module", () => {
	beforeEach(async () => {
		await fs.rm(VAULT, { recursive: true, force: true });
	});

	afterEach(async () => {
		await fs.rm(VAULT, { recursive: true, force: true });
	});

	// ════════════════════════════════════════
	// loadArchivedBookIds
	// ════════════════════════════════════════

	describe("loadArchivedBookIds", () => {
		it("returns empty Set when catalog doesn't exist", async () => {
			const result = await loadArchivedBookIds(VAULT);
			expect(result).toBeInstanceOf(Set);
			expect(result.size).toBe(0);
		});

		it("returns empty Set when catalog is malformed JSON", async () => {
			await fs.mkdir(path.dirname(CATALOG_PATH), { recursive: true });
			await fs.writeFile(CATALOG_PATH, "not valid json{", "utf-8");
			const result = await loadArchivedBookIds(VAULT);
			expect(result.size).toBe(0);
		});

		it("returns empty Set when no books are archived", async () => {
			await writeCatalogFile(makeCatalog({ a: {}, b: {} }));
			const result = await loadArchivedBookIds(VAULT);
			expect(result.size).toBe(0);
		});

		it("returns only archived bookIds", async () => {
			await writeCatalogFile(
				makeCatalog({
					a: { archived: true },
					b: { archived: false },
					c: {}, // 未设置 = 未归档
					d: { archived: true },
				}),
			);
			const result = await loadArchivedBookIds(VAULT);
			expect(result.size).toBe(2);
			expect(result.has("a")).toBe(true);
			expect(result.has("d")).toBe(true);
			expect(result.has("b")).toBe(false);
			expect(result.has("c")).toBe(false);
		});
	});

	// ════════════════════════════════════════
	// toggleArchive
	// ════════════════════════════════════════

	describe("toggleArchive", () => {
		it("archives an existing book and returns true", async () => {
			await writeCatalogFile(makeCatalog({ book1: {} }));
			const result = await toggleArchive(VAULT, "book1");
			expect(result).toBe(true);

			const catalog = await readCatalogFile();
			expect(catalog?.books["book1"].archived).toBe(true);
		});

		it("unarchives an archived book and returns false", async () => {
			await writeCatalogFile(makeCatalog({ book1: { archived: true } }));
			const result = await toggleArchive(VAULT, "book1");
			expect(result).toBe(false);

			const catalog = await readCatalogFile();
			expect(catalog?.books["book1"].archived).toBe(false);
		});

		it("creates placeholder entry when bookId doesn't exist in catalog", async () => {
			const result = await toggleArchive(VAULT, "ghost-book");
			expect(result).toBe(true);

			const catalog = await readCatalogFile();
			expect(catalog).not.toBeNull();
			expect(catalog?.books["ghost-book"]).toBeDefined();
			expect(catalog?.books["ghost-book"].archived).toBe(true);
		});

		it("initializes catalog when file doesn't exist", async () => {
			const result = await toggleArchive(VAULT, "first-book");
			expect(result).toBe(true);

			const catalog = await readCatalogFile();
			expect(catalog?.version).toBe(1);
			expect(catalog?.books["first-book"].archived).toBe(true);
		});

		it("preserves other book fields when toggling", async () => {
			await writeCatalogFile(
				makeCatalog({ book1: { title: "My Book", nodeCount: 42, archived: false } }),
			);
			await toggleArchive(VAULT, "book1");

			const catalog = await readCatalogFile();
			const entry = catalog?.books["book1"];
			expect(entry?.title).toBe("My Book");
			expect(entry?.nodeCount).toBe(42);
			expect(entry?.archived).toBe(true);
		});
	});

	// ════════════════════════════════════════
	// batchToggleArchive
	// ════════════════════════════════════════

	describe("batchToggleArchive", () => {
		it("archives multiple books in one write", async () => {
			await writeCatalogFile(makeCatalog({ a: {}, b: {}, c: {} }));
			const count = await batchToggleArchive(VAULT, ["a", "b"], true);
			expect(count).toBe(2);

			const catalog = await readCatalogFile();
			expect(catalog?.books["a"].archived).toBe(true);
			expect(catalog?.books["b"].archived).toBe(true);
			expect(catalog?.books["c"].archived).toBeUndefined();
		});

		it("unarchives multiple books in one write", async () => {
			await writeCatalogFile(
				makeCatalog({ a: { archived: true }, b: { archived: true } }),
			);
			const count = await batchToggleArchive(VAULT, ["a", "b"], false);
			expect(count).toBe(2);

			const catalog = await readCatalogFile();
			expect(catalog?.books["a"].archived).toBe(false);
			expect(catalog?.books["b"].archived).toBe(false);
		});

		it("skips bookIds not in catalog", async () => {
			await writeCatalogFile(makeCatalog({ a: {} }));
			const count = await batchToggleArchive(VAULT, ["a", "ghost1", "ghost2"], true);
			expect(count).toBe(1);

			const catalog = await readCatalogFile();
			expect(catalog?.books["a"].archived).toBe(true);
			expect(catalog?.books["ghost1"]).toBeUndefined();
		});

		it("returns 0 when target state already matches", async () => {
			await writeCatalogFile(makeCatalog({ a: { archived: true } }));
			const count = await batchToggleArchive(VAULT, ["a"], true);
			expect(count).toBe(0);
		});

		it("returns 0 for empty bookIds array", async () => {
			await writeCatalogFile(makeCatalog({ a: {} }));
			const count = await batchToggleArchive(VAULT, [], true);
			expect(count).toBe(0);
		});

		it("skips write entirely when no state changes", async () => {
			await writeCatalogFile(makeCatalog({ a: { archived: true } }));
			const stat1 = await fs.stat(CATALOG_PATH);
			const mtime1 = stat1.mtimeMs;

			// 等一下确保 mtime 不同
			await new Promise((r) => setTimeout(r, 50));

			const count = await batchToggleArchive(VAULT, ["a"], true);
			expect(count).toBe(0);

			const stat2 = await fs.stat(CATALOG_PATH);
			// mtime 应该没变（因为没写入）
			expect(stat2.mtimeMs).toBe(mtime1);
		});

		it("does not create empty catalog when no books exist", async () => {
			// 优化行为：count === 0 时跳过写入，不创建空 catalog
			const count = await batchToggleArchive(VAULT, ["x", "y"], true);
			expect(count).toBe(0);
			const catalog = await readCatalogFile();
			expect(catalog).toBeNull();
		});
	});

	// ════════════════════════════════════════
	// removeFromCatalog
	// ════════════════════════════════════════

	describe("removeFromCatalog", () => {
		it("removes the entry", async () => {
			await writeCatalogFile(makeCatalog({ a: {}, b: {} }));
			await removeFromCatalog(VAULT, "a");
			const catalog = await readCatalogFile();
			expect(catalog?.books["a"]).toBeUndefined();
			expect(catalog?.books["b"]).toBeDefined();
		});

		it("does nothing when catalog doesn't exist", async () => {
			await expect(removeFromCatalog(VAULT, "any-id")).resolves.toBeUndefined();
		});

		it("does nothing when bookId doesn't exist in catalog", async () => {
			await writeCatalogFile(makeCatalog({ a: {} }));
			await removeFromCatalog(VAULT, "ghost");
			const catalog = await readCatalogFile();
			expect(catalog?.books["a"]).toBeDefined();
		});

		it("handles malformed JSON gracefully", async () => {
			await fs.mkdir(path.dirname(CATALOG_PATH), { recursive: true });
			await fs.writeFile(CATALOG_PATH, "{broken", "utf-8");
			await expect(removeFromCatalog(VAULT, "any")).resolves.toBeUndefined();
		});
	});

	// ════════════════════════════════════════
	// 原子写入行为
	// ════════════════════════════════════════

	describe("atomic write behavior", () => {
		it("does not leave .tmp files on successful write", async () => {
			await toggleArchive(VAULT, "book1");
			const dir = path.dirname(CATALOG_PATH);
			const entries = await fs.readdir(dir);
			const tmpFiles = entries.filter((e) => e.includes(".tmp."));
			expect(tmpFiles).toEqual([]);
		});

		it("writes valid JSON that can be re-read", async () => {
			await toggleArchive(VAULT, "book1");
			await toggleArchive(VAULT, "book2");
			await batchToggleArchive(VAULT, ["book1"], false);

			const ids = await loadArchivedBookIds(VAULT);
			expect(ids.has("book1")).toBe(false);
			expect(ids.has("book2")).toBe(true);
		});
	});
});
