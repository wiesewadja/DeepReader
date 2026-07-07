import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, TFile, TFolder } from "obsidian";
import { ChapterDetection } from "@/components/reading-mode/chapter-detection.js";
import type { ChapterNavigation } from "@/components/reading-mode/chapter-detection.js";

type FakeApp = App & { metadataCache: { getFileCache: ReturnType<typeof vi.fn> } };

const app = new App() as FakeApp;
const fm = new Map<TFile, any>();
app.metadataCache.getFileCache = vi.fn((f: TFile) => fm.get(f) ?? null);

function makeFile(path: string, frontmatter?: Record<string, any>): TFile {
	const f = new TFile(path);
	if (frontmatter) fm.set(f, { frontmatter });
	return f;
}

function makeFolder(path: string, children: TFile[]): TFolder {
	const folder = new TFolder(path);
	folder.children = children;
	children.forEach((c) => (c.parent = folder));
	return folder;
}

let getCurrentFile: ReturnType<typeof vi.fn>;
let detection: ChapterDetection;

beforeEach(() => {
	fm.clear();
	getCurrentFile = vi.fn(() => null);
	detection = new ChapterDetection(app, getCurrentFile);
});

describe("ChapterDetection.isChapterFile", () => {
	it("非 md 文件返回 false", () => {
		expect(detection.isChapterFile(makeFile("DeepReader/Book/note.pdf"))).toBe(false);
	});

	it("路径不以 DeepReader/ 开头返回 false", () => {
		expect(detection.isChapterFile(makeFile("Other/Book/01 - A.md", { source: "x" }))).toBe(false);
	});

	it("无 frontmatter 返回 false", () => {
		expect(detection.isChapterFile(makeFile("DeepReader/Book/01 - A.md"))).toBe(false);
	});

	it("MOC 文件（pdf-moc / epub-moc）返回 false", () => {
		expect(detection.isChapterFile(makeFile("DeepReader/Book/moc.md", { type: "pdf-moc" }))).toBe(false);
		expect(detection.isChapterFile(makeFile("DeepReader/Book/moc2.md", { type: "epub-moc" }))).toBe(false);
	});

	it("缺少 source/book/pdf_name 返回 false", () => {
		expect(detection.isChapterFile(makeFile("DeepReader/Book/01 - A.md", { type: "normal" }))).toBe(false);
	});

	it("合法章节文件返回 true", () => {
		expect(detection.isChapterFile(makeFile("DeepReader/Book/01 - A.md", { source: "book-x" }))).toBe(true);
	});
});

describe("ChapterDetection.getBookNameFromFile", () => {
	it("优先取 pdf_name", () => {
		expect(detection.getBookNameFromFile(makeFile("DeepReader/MyBook/01 - A.md", { pdf_name: "MyBook" }))).toBe("MyBook");
	});

	it("无 frontmatter 书籍字段时回退到路径第二段", () => {
		expect(detection.getBookNameFromFile(makeFile("DeepReader/MyBook/01 - A.md"))).toBe("MyBook");
	});
});

describe("ChapterDetection.extractChapterName", () => {
	it("去除编号前缀 '23 - '", () => {
		getCurrentFile.mockReturnValue(makeFile("DeepReader/MyBook/23 - 第十九章 如何阅读社会科学.md"));
		expect(detection.extractChapterName()).toBe("第十九章 如何阅读社会科学");
	});

	it("无编号时返回 basename", () => {
		getCurrentFile.mockReturnValue(makeFile("DeepReader/MyBook/前言.md"));
		expect(detection.extractChapterName()).toBe("前言");
	});
});

describe("ChapterDetection.getChapterNavigation", () => {
	function buildBook(currentPath: string) {
		const a = makeFile("DeepReader/MyBook/01 - First.md", { source: "b" });
		const b = makeFile("DeepReader/MyBook/02 - Second.md", { source: "b" });
		const c = makeFile("DeepReader/MyBook/10 - Tenth.md", { source: "b" });
		const notes = makeFile("DeepReader/MyBook/notes.md", { source: "b" });
		const sub = new TFolder("DeepReader/MyBook/sub");
		makeFolder("DeepReader/MyBook", [a, b, c, notes, sub as any]);
		const current = [a, b, c].find((f) => f.path === currentPath)!;
		getCurrentFile.mockReturnValue(current);
		return { a, b, c };
	}

	it("无当前文件返回 null", () => {
		getCurrentFile.mockReturnValue(null);
		expect(detection.getChapterNavigation()).toBeNull();
	});

	it("当前文件无父目录返回 null", () => {
		const f = makeFile("DeepReader/MyBook/02 - Second.md");
		f.parent = null;
		getCurrentFile.mockReturnValue(f);
		expect(detection.getChapterNavigation()).toBeNull();
	});

	it("中间章：prev/next/total/currentIndex 正确且 numeric 排序", () => {
		const { a, b, c } = buildBook("DeepReader/MyBook/02 - Second.md");
		const nav: ChapterNavigation = detection.getChapterNavigation()!;
		expect(nav.prev?.path).toBe(a.path);
		expect(nav.next?.path).toBe(c.path);
		expect(nav.current.path).toBe(b.path);
		expect(nav.total).toBe(3);
		expect(nav.currentIndex).toBe(2);
	});

	it("首章：prev 为 null", () => {
		buildBook("DeepReader/MyBook/01 - First.md");
		const nav = detection.getChapterNavigation()!;
		expect(nav.prev).toBeNull();
		expect(nav.next).not.toBeNull();
	});

	it("末章：next 为 null", () => {
		buildBook("DeepReader/MyBook/10 - Tenth.md");
		const nav = detection.getChapterNavigation()!;
		expect(nav.next).toBeNull();
		expect(nav.prev).not.toBeNull();
	});
});
