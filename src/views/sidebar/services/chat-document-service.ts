/**
 * ChatDocumentService
 *
 * Manages Markdown documents attached to the current chat session.
 * Documents can be loaded from the active file, via explicit path, or via wikilink references.
 */

import { type App, TFile } from "obsidian";
import { EventBus } from "../event-bus.js";
import type { SidebarEventMap } from "../events.js";
import { uiLog as log } from "../../../utils/logger.js";

export interface LoadedDocument {
	/** File path */
	path: string;
	/** Display name */
	name: string;
	/** File content */
	content: string;
	/** Character count */
	charCount: number;
	/** How the document was loaded */
	source: "current" | "mention" | "wikilink";
	/** Load timestamp */
	loadedAt: Date;
}

export interface ChatDocumentServiceOptions {
	app: App;
	eventBus: EventBus<SidebarEventMap>;
}

export class ChatDocumentService {
	private app: App;
	private eventBus: EventBus<SidebarEventMap>;
	private loadedDocs: Map<string, LoadedDocument> = new Map();

	constructor(options: ChatDocumentServiceOptions) {
		this.app = options.app;
		this.eventBus = options.eventBus;
	}

	/**
	 * Load the currently active Markdown file into the chat context.
	 */
	async loadCurrentDocument(): Promise<LoadedDocument | null> {
		const activeFile = this.app.workspace.getActiveFile();

		if (!activeFile) {
			return null;
		}

		if (activeFile.extension !== "md") {
			return null;
		}

		return await this.loadByPath(activeFile.path, "current");
	}

	/**
	 * Load a document by path.
	 */
	async loadByPath(
		path: string,
		source: "current" | "mention" | "wikilink" = "mention",
	): Promise<LoadedDocument | null> {
		if (this.loadedDocs.has(path)) {
			return this.loadedDocs.get(path)!;
		}

		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return null;
		}

		const content = await this.app.vault.read(file);
		const doc: LoadedDocument = {
			path,
			name: file.basename,
			content,
			charCount: content.length,
			source,
			loadedAt: new Date(),
		};

		this.loadedDocs.set(path, doc);
		this.notifyChange();
		return doc;
	}

	/**
	 * Remove a loaded document.
	 */
	removeDocument(path: string): void {
		if (this.loadedDocs.has(path)) {
			this.loadedDocs.delete(path);
			this.notifyChange();
		}
	}

	/**
	 * Get all loaded documents as a map.
	 */
	getLoadedDocuments(): Map<string, LoadedDocument> {
		return new Map(this.loadedDocs);
	}

	/**
	 * Get all loaded documents as an array.
	 */
	getLoadedDocumentsArray(): LoadedDocument[] {
		return Array.from(this.loadedDocs.values());
	}

	/**
	 * Check whether a document is loaded.
	 */
	hasDocument(path: string): boolean {
		return this.loadedDocs.has(path);
	}

	/**
	 * Get the total character count of all loaded documents.
	 */
	getTotalCharCount(): number {
		let total = 0;
		for (const doc of this.loadedDocs.values()) {
			total += doc.charCount;
		}
		return total;
	}

	/**
	 * Get the combined context string for inclusion in an agent request.
	 */
	getCombinedContext(): string {
		if (this.loadedDocs.size === 0) {
			return "";
		}

		const parts: string[] = [];
		for (const doc of this.loadedDocs.values()) {
			parts.push(`---\n文档: ${doc.name}\n路径: ${doc.path}\n---\n${doc.content}`);
		}
		return parts.join("\n\n");
	}

	/**
	 * 自动同步当前章节到上下文
	 *
	 * 默认行为：
	 * - 首次打开章节时，自动加载到上下文
	 * - 切换章节时，自动更新为新章节
	 * - 只有用户手动点击按钮才能卸载文档
	 */
	async syncCurrentChapter(currentPdfName: string | null): Promise<void> {
		if (!currentPdfName) return;

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== "md") return;

		// 检查当前文件是否属于正在阅读的书籍
		const bookPath = `DeepReader/${currentPdfName}/`;
		if (!activeFile.path.startsWith(bookPath)) return;

		// 排除书籍主文件（只加载章节文件）
		if (activeFile.path === `${bookPath}${currentPdfName}.md`) return;

		// 检查当前章节是否已在上下文中
		if (this.hasDocument(activeFile.path)) return;

		// 找到当前书籍的章节文档（source === 'current' 的文档）
		const docs = this.getLoadedDocuments();
		const currentChapterDoc = Array.from(docs.values()).find(
			(doc) => doc.source === "current" && doc.path.startsWith(bookPath),
		);

		if (currentChapterDoc) {
			// 卸载旧的章节
			this.removeDocument(currentChapterDoc.path);
			log(`[DeepPDF] 自动卸载旧章节: ${currentChapterDoc.name}`);
		}

		// 加载新的章节到上下文
		await this.loadByPath(activeFile.path, "current");
		log(`[DeepPDF] 自动加载章节: ${activeFile.basename}`);
	}

	private notifyChange(): void {
		this.eventBus.emit("chat:documents-changed", {
			documents: this.getLoadedDocumentsArray(),
		});
	}
}
