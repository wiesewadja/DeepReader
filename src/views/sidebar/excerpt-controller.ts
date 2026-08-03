/**
 * ExcerptController
 *
 * 摘录入口控制器，承接「阅读模式选区摘录」与「对话消息摘录」两条路径，
 * 把 ExcerptModal 的构造、书籍信息推断、blockId 解析、文本标记等逻辑从 SidebarView 剥离。
 */

import { type App, Notice } from "obsidian";
import { ExcerptModal } from "../../components/excerpt/excerpt-modal.js";
import type { ExcerptService } from "../../services/excerpt-service.js";
import type { ExcerptContent, ExcerptMetadata } from "../../types/excerpt.js";
import { findBlockIdFromRange } from "../../utils/block-utils.js";
import { uiLog as log } from "../../utils/logger.js";

export interface ExcerptControllerOptions {
	app: App;
	getExcerptService: () => ExcerptService | undefined;
	/** 取消息携带的书籍信息（用于把 chat 摘录归属到正确书籍） */
	getMessageBookName?: (messageId: string) => string | undefined;
}

export class ExcerptController {
	private app: App;
	private getExcerptService: () => ExcerptService | undefined;
	private getMessageBookName: (messageId: string) => string | undefined;

	constructor(options: ExcerptControllerOptions) {
		this.app = options.app;
		this.getExcerptService = options.getExcerptService;
		this.getMessageBookName = options.getMessageBookName ?? (() => undefined);
	}

	/**
	 * 处理阅读模式中的摘录选中文字
	 * 保存位置：书籍摘录/{书名}/摘录-{日期}.md
	 * 链接：链接到章节文件，精确到 block id
	 */
	handleSelection(text: string, range: Range): void {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			new Notice("没有打开的文件");
			return;
		}

		// 从文件的 frontmatter 或路径中提取书籍信息
		const cache = this.app.metadataCache.getFileCache(activeFile);
		let bookName = cache?.frontmatter?.pdf_name || "";
		const indexId = String(
			cache?.frontmatter?.index_id || cache?.frontmatter?.pdf_index_id || "",
		);

		// 如果没有从 frontmatter 获取到书名，从路径提取
		if (!bookName) {
			const pathParts = activeFile.path.split("/");
			// 假设路径格式是 DeepReader/{书名}/章节.md 或 {书名}/章节.md
			if (pathParts.length >= 2) {
				if (pathParts[0] === "DeepReader") {
					bookName = pathParts[1];
				} else {
					bookName = pathParts[0];
				}
			} else {
				bookName = activeFile.basename;
			}
		}

		// 获取选中文字所在的 block id
		const blockId = findBlockIdFromRange(range, activeFile.path, this.app);
		log("[DeepPDF] Found block id for excerpt:", blockId);

		// 构建元数据
		const metadata: ExcerptMetadata = {
			sourcePdf: bookName,
			createdAt: new Date().toISOString(),
			sourceType: "reading",
			chapterPath: activeFile.path,
			chapterName: activeFile.basename,
			blockId: blockId || undefined,
			excerptType: "excerpt",
		};

		const modal = new ExcerptModal({
			app: this.app,
			content: { text },
			metadata,
			excerptService: this.getExcerptService(),
			onSave: async (path: string) => {
				new Notice(`摘录已保存到 ${path}`);
				// 摘录成功后，在阅读界面标记文本（添加虚线下划线）
				this.markExcerptText(range);
			},
		});
		modal.open();
	}

	/**
	 * 处理对话消息的摘录（从消息气泡的摘录按钮触发）
	 */
	openChatExcerpt(
		messageId: string,
		content: ExcerptContent,
		metadata: ExcerptMetadata,
	): void {
		// 用消息携带的书名补全 sourcePdf
		const bookName = this.getMessageBookName(messageId);
		if (bookName) {
			metadata.sourcePdf = bookName;
		}
		metadata.sourceType = "chat";
		// chapterPath/chapterName 是 ExcerptMetadata 的可选属性，可直接 delete
		delete metadata.chapterPath;
		delete metadata.chapterName;

		const modal = new ExcerptModal({
			content,
			metadata,
			app: this.app,
			onSave: (path: string) => {
				new Notice(`摘录已保存到 ${path}`);
			},
		});
		modal.open();
	}

	/**
	 * 在阅读界面标记摘录文本（添加虚线下划线）
	 */
	private markExcerptText(range: Range): void {
		try {
			const excerptMark = document.createElement("mark");
			excerptMark.setAttribute("data-excerpt", "true");

			// 使用 extractContents 和 insertNode 来包装选中内容
			const fragment = range.extractContents();
			excerptMark.appendChild(fragment);
			range.insertNode(excerptMark);

			log("[DeepPDF] Marked excerpt text with dotted underline");
		} catch (err) {
			log("[DeepPDF] Failed to mark excerpt text:", err);
		}
	}
}
