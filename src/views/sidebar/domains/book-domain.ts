/**
 * BookDomain
 *
 * Sidebar book-state boundary. Wraps BookManager and publishes `book:changed`
 * whenever the current book / booklist mutates. UI/session side effects remain
 * inside BookManager during this incremental refactor; the domain only adds the
 * event seam so SidebarView can react without directly touching BookManager.
 */

import type { App } from "obsidian";
import type { DeepReaderPluginInterface } from "../../../agent/tools/context/vault.js";
import type { IndexListItem, Booklist } from "../../../types/index.js";
import type { BookManager } from "../book-manager.js";
import { EventBus } from "../event-bus.js";
import type { SidebarEventMap } from "../events.js";

export interface BookContext {
	indexId: string | null;
	pdfName: string | null;
	docDescription: string | null;
	bookCoverUrl: string | null;
	bookAuthor: string | null;
	currentBooklistBookIds: string[] | null;
}

export interface BookDomainOptions {
	app: App;
	plugin: DeepReaderPluginInterface;
	eventBus: EventBus<SidebarEventMap>;
	bookManager: BookManager;
}

export class BookDomain {
	private bookManager: BookManager;
	private eventBus: EventBus<SidebarEventMap>;

	constructor(options: BookDomainOptions) {
		this.bookManager = options.bookManager;
		this.eventBus = options.eventBus;
	}

	// ── State accessors (proxy to BookManager) ──

	get currentIndexId(): string | null {
		return this.bookManager.currentIndexId;
	}

	get currentPdfName(): string | null {
		return this.bookManager.currentPdfName;
	}

	get currentBookCoverUrl(): string | null {
		return this.bookManager.currentBookCoverUrl;
	}

	get currentBookAuthor(): string | null {
		return this.bookManager.currentBookAuthor;
	}

	get currentDocDescription(): string | null {
		return this.bookManager.currentDocDescription;
	}

	get indexes(): IndexListItem[] {
		return this.bookManager.indexes;
	}

	get currentBooklist(): Booklist | null {
		return this.bookManager.currentBooklist;
	}

	get currentBooklistBookIds(): string[] | null {
		return this.bookManager.currentBooklistBookIds;
	}

	// ── Helpers (proxy to BookManager) ──

	getDisplayName(pdfName: string): string {
		return this.bookManager.getDisplayName(pdfName);
	}

	// ── Library ──

	async openLibrary(): Promise<void> {
		await this.bookManager.openLibrary();
		this.emitChanged();
	}

	// ── Bookshelf summary ──

	getBookshelfSummary(): string {
		return this.bookManager.buildBookshelfSummary();
	}

	getCurrentBookContext(): BookContext {
		return {
			indexId: this.currentIndexId,
			pdfName: this.currentPdfName,
			docDescription: this.currentDocDescription,
			bookCoverUrl: this.currentBookCoverUrl,
			bookAuthor: this.currentBookAuthor,
			currentBooklistBookIds: this.currentBooklistBookIds,
		};
	}

	getCurrentBookInfo(): { title: string | null; page_count: number; docDescription: string | null } {
		return this.bookManager.getCurrentBookInfo();
	}

	// ── Index loading ──

	async loadIndexes(): Promise<void> {
		await this.bookManager.loadIndexes();
		this.emitChanged();
	}

	async refreshIndexes(): Promise<void> {
		await this.loadIndexes();
	}

	// ── Book selection ──

	async selectIndex(indexId: string): Promise<void> {
		await this.bookManager.selectIndex(indexId);
		this.emitChanged();
	}

	async selectBookByName(bookName: string): Promise<void> {
		await this.bookManager.selectBookByName(bookName);
		this.emitChanged();
	}

	// ── Vault scanning ──

	async findBookDirectoryByIndexId(
		indexId: string,
	): Promise<{ dirName: string; author?: string; bookName?: string } | null> {
		return this.bookManager.findBookDirectoryByIndexId(indexId);
	}

	async checkBookChaptersExist(pdfName: string): Promise<boolean> {
		return this.bookManager.checkBookChaptersExist(pdfName);
	}

	// ── Index deletion ──

	async deleteIndex(indexId: string): Promise<void> {
		await this.bookManager.handleDeleteIndex(indexId);
		this.emitChanged();
	}

	// ── Booklist ──

	async selectBooklist(booklist: Booklist): Promise<void> {
		await this.bookManager.selectBooklist(booklist);
		this.emitChanged();
	}

	restoreBooklist(booklist: Booklist): void {
		this.bookManager.restoreBooklist(booklist);
		this.emitChanged();
	}

	clearBooklist(): void {
		this.bookManager.clearBooklist();
		this.emitChanged();
	}

	renameBooklist(newName: string): void {
		this.bookManager.renameBooklist(newName);
		this.emitChanged();
	}

	// ── Event helpers ──

	private emitChanged(): void {
		this.eventBus.emit("book:changed", this.getCurrentBookContext());
	}
}
