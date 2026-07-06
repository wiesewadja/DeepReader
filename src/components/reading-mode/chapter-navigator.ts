/**
 * 章节导航动作（深模块）
 *
 * 把 ReadingModeService 中与"上一章 / 下一章跳转"相关的动作逻辑抽到本模块，
 * 使 Shell（ReadingModeService）退化为生命周期编排器。
 *
 * 依赖边界（全部经构造函数注入，便于独立单测、解耦 Shell）：
 * - `getChapterNavigation`：纯读取，从 ChapterDetection 取导航信息；
 * - `onStopReadingTTS`：切章时停止原文朗读（注入闭包，读取 Shell 实时 callbacks）；
 * - `openFile`：打开目标章节文件（注入闭包，封装 app.workspace.getLeaf().openFile）；
 * - `setJumpToLastPage`：写入跨章回退标记（R2 共享状态——标记仍由 Shell 持有，
 *   waitForRenderAndInitPaginator 读取并复位，本模块只负责写入）。
 *
 * 不持有 Paginator / DOM / 聊天态，保持单一职责。
 */

import { TFile } from "obsidian";
import type { ChapterNavigation } from "./chapter-detection.js";

export interface ChapterNavigatorDeps {
	/** 读取当前章节导航信息（来自 ChapterDetection） */
	getChapterNavigation: () => ChapterNavigation | null;
	/** 切章时停止原文朗读（Shell 注入闭包，读取实时 callbacks） */
	onStopReadingTTS: () => void;
	/** 打开目标章节文件 */
	openFile: (file: TFile) => Promise<void>;
	/** 写入跨章回退标记（R2 共享状态，由 Shell 持有并复位） */
	setJumpToLastPage: (value: boolean) => void;
}

export class ChapterNavigator {
	private getChapterNavigation: () => ChapterNavigation | null;
	private onStopReadingTTS: () => void;
	private openFile: (file: TFile) => Promise<void>;
	private setJumpToLastPage: (value: boolean) => void;

	constructor(deps: ChapterNavigatorDeps) {
		this.getChapterNavigation = deps.getChapterNavigation;
		this.onStopReadingTTS = deps.onStopReadingTTS;
		this.openFile = deps.openFile;
		this.setJumpToLastPage = deps.setJumpToLastPage;
	}

	/**
	 * 跳转到上一章。
	 * 置位 _jumpToLastPage（跨章回退语义：前一章恢复到最后一页），由 Shell 在
	 * 重新初始化分页时读取并复位。
	 */
	async navigateToPrev(): Promise<boolean> {
		const nav = this.getChapterNavigation();
		if (nav?.prev) {
			this.onStopReadingTTS();
			this.setJumpToLastPage(true);
			await this.openFile(nav.prev);
			return true;
		}
		return false;
	}

	/**
	 * 跳转到下一章。
	 */
	async navigateToNext(): Promise<boolean> {
		const nav = this.getChapterNavigation();
		if (nav?.next) {
			this.onStopReadingTTS();
			await this.openFile(nav.next);
			return true;
		}
		return false;
	}
}
