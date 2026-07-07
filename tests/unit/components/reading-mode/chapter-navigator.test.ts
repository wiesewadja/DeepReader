import { describe, it, expect, vi, beforeEach } from "vitest";
import { TFile } from "obsidian";
import { ChapterNavigator } from "@/components/reading-mode/chapter-navigator.js";
import type { ChapterNavigation } from "@/components/reading-mode/chapter-detection.js";

function makeFile(path: string): TFile {
	return new TFile(path);
}

let app: { workspace: { getLeaf: ReturnType<typeof vi.fn> } };
let getChapterNavigation: ReturnType<typeof vi.fn>;
let onStopReadingTTS: ReturnType<typeof vi.fn>;
let openFile: ReturnType<typeof vi.fn>;
let setJumpToLastPage: ReturnType<typeof vi.fn>;
let navigator: ChapterNavigator;

function navWith(prev: TFile | null, next: TFile | null): ChapterNavigation {
	const current = makeFile("DeepReader/Book/02 - Middle.md");
	return { prev, next, current, total: 3, currentIndex: 2 };
}

beforeEach(() => {
	openFile = vi.fn().mockResolvedValue(undefined);
	app = {
		workspace: {
			getLeaf: vi.fn(() => ({ openFile })),
		},
	};
	getChapterNavigation = vi.fn(() => null);
	onStopReadingTTS = vi.fn();
	setJumpToLastPage = vi.fn();
	navigator = new ChapterNavigator({
		app: app as any,
		getChapterNavigation,
		onStopReadingTTS,
		setJumpToLastPage,
	});
});

describe("ChapterNavigator.navigateToPrev", () => {
	it("无章节导航信息时返回 false 且不做任何副作用", async () => {
		getChapterNavigation.mockReturnValue(null);
		const result = await navigator.navigateToPrev();
		expect(result).toBe(false);
		expect(openFile).not.toHaveBeenCalled();
		expect(onStopReadingTTS).not.toHaveBeenCalled();
		expect(setJumpToLastPage).not.toHaveBeenCalled();
	});

	it("当前为首章（prev 为 null）时返回 false", async () => {
		getChapterNavigation.mockReturnValue(navWith(null, makeFile("DeepReader/Book/03 - Next.md")));
		const result = await navigator.navigateToPrev();
		expect(result).toBe(false);
		expect(openFile).not.toHaveBeenCalled();
	});

	it("存在 prev 时：停止 TTS、置位 jumpToLastPage、打开 prev 文件并返回 true", async () => {
		const prev = makeFile("DeepReader/Book/01 - First.md");
		getChapterNavigation.mockReturnValue(navWith(prev, makeFile("DeepReader/Book/03 - Next.md")));

		const result = await navigator.navigateToPrev();

		expect(result).toBe(true);
		expect(onStopReadingTTS).toHaveBeenCalledTimes(1);
		expect(setJumpToLastPage).toHaveBeenCalledWith(true);
		expect(openFile).toHaveBeenCalledWith(prev, { active: true });
	});

	it("调用顺序：先停止 TTS 与置位标记，再打开文件", async () => {
		const prev = makeFile("DeepReader/Book/01 - First.md");
		getChapterNavigation.mockReturnValue(navWith(prev, makeFile("DeepReader/Book/03 - Next.md")));

		await navigator.navigateToPrev();

		// openFile 必须在 onStopReadingTTS / setJumpToLastPage 之后发生
		const openIdx = openFile.mock.invocationCallOrder[0];
		expect(onStopReadingTTS.mock.invocationCallOrder[0]).toBeLessThan(openIdx);
		expect(setJumpToLastPage.mock.invocationCallOrder[0]).toBeLessThan(openIdx);
	});
});

describe("ChapterNavigator.navigateToNext", () => {
	it("无章节导航信息时返回 false 且不做任何副作用", async () => {
		getChapterNavigation.mockReturnValue(null);
		const result = await navigator.navigateToNext();
		expect(result).toBe(false);
		expect(openFile).not.toHaveBeenCalled();
	});

	it("当前为末章（next 为 null）时返回 false", async () => {
		getChapterNavigation.mockReturnValue(navWith(makeFile("DeepReader/Book/01 - First.md"), null));
		const result = await navigator.navigateToNext();
		expect(result).toBe(false);
		expect(openFile).not.toHaveBeenCalled();
	});

	it("存在 next 时：停止 TTS、打开 next 文件、返回 true，且不置位 jumpToLastPage", async () => {
		const next = makeFile("DeepReader/Book/03 - Next.md");
		getChapterNavigation.mockReturnValue(navWith(makeFile("DeepReader/Book/01 - First.md"), next));

		const result = await navigator.navigateToNext();

		expect(result).toBe(true);
		expect(onStopReadingTTS).toHaveBeenCalledTimes(1);
		expect(openFile).toHaveBeenCalledWith(next, { active: true });
		expect(setJumpToLastPage).not.toHaveBeenCalled();
	});
});
