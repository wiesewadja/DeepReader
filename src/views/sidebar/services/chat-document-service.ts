/**
 * ChatDocumentService
 *
 * Manages Markdown documents attached to the current chat session.
 * Documents can be loaded from the active file, via explicit path, or via wikilink references.
 */

import { type App, TFile } from "obsidian";
import { EventBus } from "../event-bus.js";

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

export interface SidebarEventMap {
	"chat:documents-changed": { documents: LoadedDocument[] };
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
	 * Remove all loaded documents.
	 */
	clearAll(): void {
		if (this.loadedDocs.size === 0) return;
		this.loadedDocs.clear();
		this.notifyChange();
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
	 * Check whether any documents are loaded.
	 */
	hasDocuments(): boolean {
		return this.loadedDocs.size > 0;
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

	private notifyChange(): void {
		this.eventBus.emit("chat:documents-changed", {
			documents: this.getLoadedDocumentsArray(),
		});
	}
}
