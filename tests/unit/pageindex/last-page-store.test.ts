/**
 * last-page-store 单元测试
 *
 * 覆盖：
 * - loadLastPages：文件不存在 / 空文件 / v1 迁移 / v2 直读 / 字段类型校验
 * - saveLastPages：原子写入、容量截断、损坏检测
 * - lastReadAt 时间戳正确持久化
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import {
	loadLastPages,
	saveLastPages,
} from "@/pageindex/last-page-store";
import { getLastPagesPath, pageindexPaths } from "@/pageindex/paths.js";

const PLUGIN_ID = "deepreader";
const VAULT = "/tmp/deepreader-last-page-test";
const FILE = pageindexPaths(PLUGIN_ID).lastPages(VAULT);

async function rmrf(p: string) {
	try {
		await fs.rm(p, { recursive: true, force: true });
	} catch { /* ignore */ }
}

describe("last-page-store", () => {
	beforeEach(async () => {
		await rmrf(VAULT);
	});
	afterEach(async () => {
		await rmrf(VAULT);
	});

	describe("loadLastPages", () => {
		it("文件不存在时返回空 maps", async () => {
			const result = await loadLastPages(VAULT, PLUGIN_ID);
			expect(result.pages.size).toBe(0);
			expect(result.lastReadAt.size).toBe(0);
		});

		it("vaultPath 为空时返回空 maps", async () => {
			const result = await loadLastPages("", PLUGIN_ID);
			expect(result.pages.size).toBe(0);
			expect(result.lastReadAt.size).toBe(0);
		});

		it("v1 数据自动迁移为 v2（仅页码，无时间戳）", async () => {
			await fs.mkdir(path.dirname(FILE), { recursive: true });
			const v1 = {
				version: 1,
				entries: {
					"books/a.epub": 42,
					"books/b.epub": 17,
				},
			};
			await fs.writeFile(FILE, JSON.stringify(v1), "utf-8");

			const result = await loadLastPages(VAULT, PLUGIN_ID);
			expect(result.pages.get("books/a.epub")).toBe(42);
			expect(result.pages.get("books/b.epub")).toBe(17);
			// v1 无时间戳，迁移后 lastReadAt 全为 0
			expect(result.lastReadAt.get("books/a.epub")).toBe(0);
		});

		it("v2 数据直接读取（含时间戳）", async () => {
			await fs.mkdir(path.dirname(FILE), { recursive: true });
			const v2 = {
				version: 2,
				entries: {
					"books/a.epub": { page: 42, lastReadAt: 1717350000000 },
					"books/b.epub": { page: 17, lastReadAt: 1717350123000 },
				},
			};
			await fs.writeFile(FILE, JSON.stringify(v2), "utf-8");

			const result = await loadLastPages(VAULT, PLUGIN_ID);
			expect(result.pages.get("books/a.epub")).toBe(42);
			expect(result.lastReadAt.get("books/a.epub")).toBe(1717350000000);
			expect(result.lastReadAt.get("books/b.epub")).toBe(1717350123000);
		});

		it("JSON 损坏时降级为空 maps", async () => {
			await fs.mkdir(path.dirname(FILE), { recursive: true });
			await fs.writeFile(FILE, "this is not json", "utf-8");

			const result = await loadLastPages(VAULT, PLUGIN_ID);
			expect(result.pages.size).toBe(0);
			expect(result.lastReadAt.size).toBe(0);
		});

		it("字段类型非法时被丢弃（不影响其他有效条目）", async () => {
			await fs.mkdir(path.dirname(FILE), { recursive: true });
			const data = {
				version: 2,
				entries: {
					"books/valid.epub": { page: 5, lastReadAt: 1000 },
					"books/invalid-page.epub": { page: -1, lastReadAt: 2000 },
					"books/infinite-page.epub": { page: Infinity, lastReadAt: 3000 },
					"books/missing-page.epub": { lastReadAt: 4000 },
					"books/invalid-ts.epub": { page: 10, lastReadAt: "not-a-number" },
				},
			};
			await fs.writeFile(FILE, JSON.stringify(data), "utf-8");

			const result = await loadLastPages(VAULT, PLUGIN_ID);
			expect(result.pages.size).toBe(1);
			expect(result.pages.get("books/valid.epub")).toBe(5);
		});
	});

	describe("saveLastPages", () => {
		it("写入后再读数据一致", async () => {
			const pages = new Map([["a.md", 10], ["b.md", 20]]);
			const lastReadAt = new Map([["a.md", 1000], ["b.md", 2000]]);
			await saveLastPages(VAULT, pages, lastReadAt, PLUGIN_ID);

			const result = await loadLastPages(VAULT, PLUGIN_ID);
			expect(result.pages.get("a.md")).toBe(10);
			expect(result.pages.get("b.md")).toBe(20);
			expect(result.lastReadAt.get("a.md")).toBe(1000);
			expect(result.lastReadAt.get("b.md")).toBe(2000);
		});

		it("vaultPath 为空时不写入", async () => {
			const pages = new Map([["a.md", 10]]);
			// 不应抛错
			await saveLastPages("", pages, new Map(), PLUGIN_ID);
		});

		it("写入 v2 格式（顶层 version: 2）", async () => {
			const pages = new Map([["a.md", 5]]);
			const lastReadAt = new Map([["a.md", 999]]);
			await saveLastPages(VAULT, pages, lastReadAt, PLUGIN_ID);

			const raw = await fs.readFile(FILE, "utf-8");
			const parsed = JSON.parse(raw);
			expect(parsed.version).toBe(2);
			expect(parsed.entries["a.md"]).toEqual({ page: 5, lastReadAt: 999 });
		});

		it("lastReadAt 缺失时填 0", async () => {
			const pages = new Map([["a.md", 7]]);
			const lastReadAt = new Map<string, number>();  // 无 a.md
			await saveLastPages(VAULT, pages, lastReadAt, PLUGIN_ID);

			const result = await loadLastPages(VAULT, PLUGIN_ID);
			expect(result.pages.get("a.md")).toBe(7);
			expect(result.lastReadAt.get("a.md")).toBe(0);
		});

		it("超过 MAX_ENTRIES (500) 时丢弃最旧的（按 lastReadAt 升序）", async () => {
			const pages = new Map<string, number>();
			const lastReadAt = new Map<string, number>();
			// 写入 510 条，时间戳递增
			for (let i = 0; i < 510; i++) {
				pages.set(String(i), i + 1);
				lastReadAt.set(String(i), 1000 + i);
			}
			await saveLastPages(VAULT, pages, lastReadAt, PLUGIN_ID);

			const result = await loadLastPages(VAULT, PLUGIN_ID);
			expect(result.pages.size).toBe(500);
			// 最早 10 条被丢弃（i=0..9, lastReadAt=1000..1009）
			expect(result.pages.get("0")).toBeUndefined();
			expect(result.pages.get("9")).toBeUndefined();
			// 剩下的 10..509 保留
			expect(result.pages.get("10")).toBe(11);
			expect(result.pages.get("509")).toBe(510);
		});

		it("非法页码（< 1 / NaN / Infinity）写入时丢弃", async () => {
			const pages = new Map<string, number>([
				["valid.md", 5],
				["zero.md", 0],
				["negative.md", -3],
				["nan.md", NaN],
				["infinity.md", Infinity],
			]);
			await saveLastPages(VAULT, pages, new Map(), PLUGIN_ID);

			const result = await loadLastPages(VAULT, PLUGIN_ID);
			expect(result.pages.size).toBe(1);
			expect(result.pages.get("valid.md")).toBe(5);
		});
	});
});
