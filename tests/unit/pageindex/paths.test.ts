import { describe, it, expect, beforeEach } from "vitest";
import * as path from "node:path";
import {
	setActivePluginId,
	getActivePluginId,
	getPageindexDir,
	PAGEINDEX_DIR,
	pageindexPaths,
	getPageindexRoot,
	getBookDir,
	getBookFile,
	getCatalogPath,
	getLastPagesPath,
} from "@/pageindex/paths";

describe("pageindex paths", () => {
	beforeEach(() => {
		setActivePluginId("deepreader");
	});

	it("should return default pluginId", () => {
		expect(getActivePluginId()).toBe("deepreader");
	});

	it("should set and get pluginId", () => {
		setActivePluginId("deepreader-dev");
		expect(getActivePluginId()).toBe("deepreader-dev");
	});

	it("should return correct pageindex dir", () => {
		expect(getPageindexDir()).toBe(".obsidian/plugins/deepreader/pageindex");
	});

	it("should return correct dir after changing pluginId", () => {
		setActivePluginId("deepreader-dev");
		expect(getPageindexDir()).toBe(".obsidian/plugins/deepreader-dev/pageindex");
	});

	it("should return correct rel path from pageindexPaths", () => {
		const paths = pageindexPaths("deepreader-dev");
		expect(paths.rel).toBe(".obsidian/plugins/deepreader-dev/pageindex");
	});

	it("should return correct catalog path", () => {
		const paths = pageindexPaths("deepreader");
		const catalog = paths.catalog("/vault");
		expect(catalog).toBe(path.join("/vault", ".obsidian/plugins/deepreader/pageindex/catalog.json"));
	});

	it("should return correct last pages path", () => {
		const paths = pageindexPaths("deepreader");
		const lp = paths.lastPages("/vault");
		expect(lp).toBe(path.join("/vault", ".obsidian/plugins/deepreader/pageindex/last-pages.json"));
	});

	it("should return correct root path", () => {
		const paths = pageindexPaths("deepreader");
		const root = paths.root("/vault");
		expect(root).toBe(path.join("/vault", ".obsidian/plugins/deepreader/pageindex"));
	});

	it("should return correct book dir", () => {
		const paths = pageindexPaths("deepreader-dev");
		const bookDir = paths.bookDir("/vault", "book-abc");
		expect(bookDir).toBe(path.join("/vault", ".obsidian/plugins/deepreader-dev/pageindex/book-abc"));
	});

	it("should return correct book file", () => {
		const paths = pageindexPaths("deepreader-dev");
		const bookFile = paths.bookFile("/vault", "book-abc", "tree.json");
		expect(bookFile).toBe(
			path.join("/vault", ".obsidian/plugins/deepreader-dev/pageindex/book-abc/tree.json"),
		);
	});

	it("PAGEINDEX_DIR should work with template literals", () => {
		const dir = `${PAGEINDEX_DIR}/book123`;
		expect(dir).toBe(".obsidian/plugins/deepreader/pageindex/book123");
	});

	it("PAGEINDEX_DIR should follow pluginId changes", () => {
		setActivePluginId("deepreader-dev");
		const dir = `${PAGEINDEX_DIR}/book123`;
		expect(dir).toBe(".obsidian/plugins/deepreader-dev/pageindex/book123");
	});
});

describe("fs absolute path functions", () => {
	beforeEach(() => {
		setActivePluginId("deepreader");
	});

	it("getPageindexRoot should return absolute path", () => {
		const root = getPageindexRoot("/vault");
		expect(root).toBe(path.join("/vault", ".obsidian/plugins/deepreader/pageindex"));
	});

	it("getBookDir should return absolute path with bookId", () => {
		const dir = getBookDir("/vault", "book-abc");
		expect(dir).toBe(path.join("/vault", ".obsidian/plugins/deepreader/pageindex/book-abc"));
	});

	it("getBookFile should return absolute path with filename", () => {
		const file = getBookFile("/vault", "book-abc", "tree.json");
		expect(file).toBe(path.join("/vault", ".obsidian/plugins/deepreader/pageindex/book-abc/tree.json"));
	});

	it("getCatalogPath should return catalog.json path", () => {
		const catalog = getCatalogPath("/vault");
		expect(catalog).toBe(path.join("/vault", ".obsidian/plugins/deepreader/pageindex/catalog.json"));
	});

	it("getLastPagesPath should return last-pages.json path", () => {
		const lp = getLastPagesPath("/vault");
		expect(lp).toBe(path.join("/vault", ".obsidian/plugins/deepreader/pageindex/last-pages.json"));
	});

	it("should follow pluginId changes", () => {
		setActivePluginId("deepreader-dev");
		const catalog = getCatalogPath("/vault");
		expect(catalog).toBe(path.join("/vault", ".obsidian/plugins/deepreader-dev/pageindex/catalog.json"));
	});
});
