import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { migratePageindexPath } from "../migration.js";
import { PAGEINDEX_DIR } from "../paths.js";

describe("migratePageindexPath", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "deepreader-migration-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("should return false when old dir does not exist (fresh install)", async () => {
		const result = await migratePageindexPath(tmpDir);
		expect(result).toBe(false);
	});

	it("should move old dir to new location", async () => {
		const oldDir = path.join(tmpDir, ".pageindex");
		const newDir = path.join(tmpDir, PAGEINDEX_DIR);

		await fs.mkdir(path.join(oldDir, "abc123"), { recursive: true });
		await fs.writeFile(path.join(oldDir, "abc123", "tree.json"), "{}");
		await fs.writeFile(path.join(oldDir, "catalog.json"), "{}");

		const result = await migratePageindexPath(tmpDir);

		expect(result).toBe(true);
		await expect(fs.access(oldDir)).rejects.toThrow();
		const content = await fs.readFile(path.join(newDir, "abc123", "tree.json"), "utf-8");
		expect(content).toBe("{}");
	});

	it("should merge when both old and new dirs exist", async () => {
		const oldDir = path.join(tmpDir, ".pageindex");
		const newDir = path.join(tmpDir, PAGEINDEX_DIR);

		await fs.mkdir(path.join(oldDir, "book-old"), { recursive: true });
		await fs.writeFile(path.join(oldDir, "book-old", "tree.json"), "old");

		await fs.mkdir(path.join(newDir, "book-new"), { recursive: true });
		await fs.writeFile(path.join(newDir, "book-new", "tree.json"), "new");

		const result = await migratePageindexPath(tmpDir);

		expect(result).toBe(true);
		await expect(fs.readFile(path.join(newDir, "book-old", "tree.json"), "utf-8"))
			.resolves.toBe("old");
		await expect(fs.readFile(path.join(newDir, "book-new", "tree.json"), "utf-8"))
			.resolves.toBe("new");
		await expect(fs.access(oldDir)).rejects.toThrow();
	});

	it("should be idempotent (skip on second run)", async () => {
		const oldDir = path.join(tmpDir, ".pageindex");
		await fs.mkdir(path.join(oldDir, "test"), { recursive: true });

		// 第一次迁移
		await migratePageindexPath(tmpDir);
		// 旧目录已消失，第二次调用应该返回 false
		const result = await migratePageindexPath(tmpDir);
		expect(result).toBe(false);
	});
});
