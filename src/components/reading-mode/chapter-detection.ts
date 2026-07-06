/**
 * 章节识别与导航信息计算（深模块）
 *
 * 把 ReadingModeService 中与"章节文件判定 / 书籍名提取 / 章节导航排序"相关的纯逻辑
 * 抽到本模块，使 Shell（ReadingModeService）退化为生命周期编排器。
 *
 * 依赖边界：
 * - 通过注入的 `app`（Obsidian API）读取 metadataCache 与父目录结构；
 * - 当前文件经 `getCurrentFile` 注入（解耦 Shell 的 currentFile 字段，便于单测）；
 * - 不持有 Paginator / DOM / 聊天态，保持单一职责、可独立单测。
 */

import type { App } from "obsidian";
import { TFile } from "obsidian";
import { serviceLog } from "../../utils/logger.js";

export interface ChapterNavigation {
	prev: TFile | null;
	next: TFile | null;
	current: TFile;
	total: number;
	currentIndex: number;
}

export class ChapterDetection {
	private app: App;
	private getCurrentFile: () => TFile | null;

	constructor(app: App, getCurrentFile: () => TFile | null) {
		this.app = app;
		this.getCurrentFile = getCurrentFile;
	}

	/**
	 * 判定是否为章节文件：
	 * 1. Markdown；2. 路径以 DeepReader/ 开头；3. frontmatter 含 source（书籍标识）；4. 排除 MOC。
	 */
	isChapterFile(file: TFile): boolean {
		if (file.extension !== "md") return false;
		if (!file.path.startsWith("DeepReader/")) return false;

		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		if (!frontmatter) {
			serviceLog("[ReadingMode] No frontmatter:", file.path);
			return false;
		}

		const isMoc = frontmatter.type === "pdf-moc" || frontmatter.type === "epub-moc";
		if (isMoc) return false;

		const hasSource = !!(
			frontmatter.source ||
			frontmatter.pdf_name ||
			frontmatter.book
		);
		if (!hasSource) {
			serviceLog("[ReadingMode] File missing source:", file.path, frontmatter);
			return false;
		}

		serviceLog("[ReadingMode] Chapter file detected:", file.path);
		return true;
	}

	/**
	 * 从文件中提取书籍名称（用于同书判断）
	 */
	getBookNameFromFile(file: TFile): string {
		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		const bookName =
			frontmatter?.pdf_name || frontmatter?.book || frontmatter?.source || "";
		if (bookName) return bookName;
		const pathParts = file.path.split("/");
		if (pathParts.length >= 2 && pathParts[0] === "DeepReader") {
			return pathParts[1];
		}
		return "";
	}

	/**
	 * 提取章节名称（去除编号前缀），如 "23 - 第十九章 ..." -> "第十九章 ..."
	 */
	extractChapterName(): string {
		const file = this.getCurrentFile();
		if (!file) return "";
		const basename = file.basename;
		const match = basename.match(/^\d+\s*[-–]\s*(.+)$/);
		return match ? match[1] : basename;
	}

	/**
	 * 获取章节导航信息：同文件夹下按编号排序的兄弟章节，给出 prev/next/current/total。
	 */
	getChapterNavigation(): ChapterNavigation | null {
		const current = this.getCurrentFile();
		if (!current) return null;
		const parent = current.parent;
		if (!parent) return null;

		const chapterFiles = parent.children
			.filter((child): child is TFile => {
				if (!(child instanceof TFile)) return false;
				if (child.extension !== "md") return false;
				return /^\d+/.test(child.basename);
			})
			.sort((a, b) =>
				a.basename.localeCompare(b.basename, undefined, { numeric: true }),
			);

		const currentIndex = chapterFiles.findIndex((f) => f.path === current.path);
		if (currentIndex === -1) return null;

		return {
			prev: currentIndex > 0 ? chapterFiles[currentIndex - 1] : null,
			next:
				currentIndex < chapterFiles.length - 1
					? chapterFiles[currentIndex + 1]
					: null,
			current,
			total: chapterFiles.length,
			currentIndex: currentIndex + 1,
		};
	}
}
