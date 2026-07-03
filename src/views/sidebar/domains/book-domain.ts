import { App, TFile } from "obsidian";
import type { DeepReaderPluginInterface } from "../../../agent/tools/context/vault.js";
import { removeFromCatalog } from "../../../pageindex/archive.js";
import { PAGEINDEX_DIR, getPageindexDir } from "../../../pageindex/paths.js";
import { stripFileExtension, type IndexListItem, type Booklist } from "../../../types/index.js";
import { uiLog as log, error as logError } from "../../../utils/logger.js";
import {
	vaultRead,
	vaultExists,
	vaultList,
	vaultRemove,
	vaultRmdir,
	getVaultPath,
} from "../../../utils/mobile-fs.js";
const LIBRARY_VIEW_TYPE = "deeppdf-library-view";
import { EventBus } from "../event-bus.js";
import type { SidebarEventMap } from "../events.js";

const GENERAL_MODE_INDEX_ID = "weread-bookshelf-general-mode-id";

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
	
	// Delegations
	startNewSession(indexId: string): Promise<void>;
	restoreFromSessionStore(sessionId: string): Promise<boolean>;
	getSessionId(): string | null;
	setSessionId(id: string | null): void;
	getSessionStore(): any;
	ensureSessionStore(): Promise<void>;
	cancelActiveStream(): void;
}

export class BookDomain {
	private app: App;
	private plugin: DeepReaderPluginInterface;
	private eventBus: EventBus<SidebarEventMap>;
	private options: BookDomainOptions;

	private _currentIndexId: string | null = null;
	private _currentPdfName: string | null = null;
	private _currentBookCoverUrl: string | null = null;
	private _currentBookAuthor: string | null = null;
	private _currentDocDescription: string | null = null;
	private _indexes: IndexListItem[] = [];
	private _bookshelfSummary: string | null = null;
	private _currentBooklist: Booklist | null = null;
	private _booklistCovers?: { id: string; name: string; coverUrl?: string }[] = [];

	constructor(options: BookDomainOptions) {
		this.app = options.app;
		this.plugin = options.plugin;
		this.eventBus = options.eventBus;
		this.options = options;
	}

	// ── State accessors ──

	get currentIndexId(): string | null {
		return this._currentIndexId;
	}

	get currentPdfName(): string | null {
		return this._currentPdfName;
	}

	get currentBookCoverUrl(): string | null {
		return this._currentBookCoverUrl;
	}

	get currentBookAuthor(): string | null {
		return this._currentBookAuthor;
	}

	get currentDocDescription(): string | null {
		return this._currentDocDescription;
	}

	get indexes(): IndexListItem[] {
		return this._indexes;
	}

	get currentBooklist(): Booklist | null {
		return this._currentBooklist;
	}

	get currentBooklistBookIds(): string[] | null {
		return this._currentBooklist?.bookIds ?? null;
	}

	// ── Static Helper Methods for main.ts ──

	static async loadIndexesOnly(app: App, plugin: DeepReaderPluginInterface): Promise<IndexListItem[]> {
		try {
			log("[BookDomain.loadIndexesOnly] Scanning PAGEINDEX_DIR:", PAGEINDEX_DIR);
			if (!(await vaultExists(app, getPageindexDir()))) {
				return [];
			}
			const { folders } = await vaultList(app, getPageindexDir());
			const indexes: IndexListItem[] = [];

			for (const folder of folders) {
				const bookId = folder.split("/").pop() || folder;
				try {
					const statusContent = await vaultRead(app, `${PAGEINDEX_DIR}/${bookId}/.indexing.json`);
					const status = JSON.parse(statusContent);
					const isFailed = status.step === "failed";

					const fileStat = await app.vault.adapter.stat(`${getPageindexDir()}/${bookId}/.indexing.json`);
					const fileAge = fileStat ? Date.now() - fileStat.mtime : 0;
					const isStale = fileAge > 30 * 60 * 1000;

					if (isStale && !isFailed) {
						indexes.push({
							id: status.bookId || bookId,
							pdf_name: status.title || bookId,
							node_count: 0,
							created_at: new Date().toISOString(),
							fileType: status.fileType,
							status: "failed",
							progress_percent: status.percent || 0,
							message: `索引中断: ${status.stepLabel || "处理中"}（超时）`,
						});
						continue;
					} else {
						indexes.push({
							id: status.bookId || bookId,
							pdf_name: status.title || bookId,
							node_count: 0,
							created_at: new Date().toISOString(),
							fileType: status.fileType,
							status: isFailed ? "failed" : "processing",
							progress_percent: status.percent || 0,
							message: isFailed ? `索引失败: ${status.error || ""}` : status.stepLabel,
						});
						continue;
					}
				} catch {
					// Fall through to book-meta.json
				}

				try {
					const content = await vaultRead(app, `${PAGEINDEX_DIR}/${bookId}/book-meta.json`);
					const meta = JSON.parse(content);
					const metaStatus = meta.status === "indexing" ? "ready" : (meta.status || "ready");
					indexes.push({
						id: meta.bookId || bookId,
						pdf_name: meta.title || bookId,
						author: meta.author,
						description: meta.description,
						fileType: meta.fileType,
						node_count: meta.chapters?.length || 0,
						created_at: meta.indexedAt || new Date().toISOString(),
						status: metaStatus,
					});
				} catch {
					// Skip
				}
			}

			// Add WeRead synchronized books
			try {
				const stateRaw = await vaultRead(app, `${PAGEINDEX_DIR}/weread/sync-state.json`);
				const state = JSON.parse(stateRaw);
				const syncedBooks = state.syncedBooks || {};
				const localIds = new Set(indexes.map((i) => i.id));

				const linkedWereadIds = new Set<string>();
				try {
					const mappingRaw = await vaultRead(app, `${PAGEINDEX_DIR}/weread/mapping.json`);
					const parsed = JSON.parse(mappingRaw);
					const mapping = parsed.mappings || parsed;
					for (const [wereadId, info] of Object.entries(mapping) as any[]) {
						if (info?.deepReaderBookId && localIds.has(info.deepReaderBookId)) {
							linkedWereadIds.add(wereadId);
						}
					}
				} catch { /* ignored */ }

				for (const entry of Object.values(syncedBooks) as any[]) {
					if (linkedWereadIds.has(entry.bookId)) continue;
					indexes.push({
						id: entry.bookId,
						pdf_name: entry.title,
						author: entry.author,
						fileType: "weread",
						node_count: (entry.noteCount || 0) + (entry.reviewCount || 0),
						created_at: entry.lastSyncTime ? new Date(entry.lastSyncTime).toISOString() : "",
						status: "ready",
					});
				}
			} catch { /* ignored */ }

			return indexes;
		} catch {
			return [];
		}
	}

	static getDisplayName(pdfName: string): string {
		let name = pdfName;
		const separators = ["_", "-"];
		for (const sep of separators) {
			if (name.includes(sep)) {
				name = name.split(sep)[0].trim();
				break;
			}
		}
		return name;
	}

	static async deleteIndexOnly(app: App, plugin: DeepReaderPluginInterface, indexId: string): Promise<IndexListItem[]> {
		try {
			const indexDir = `${PAGEINDEX_DIR}/${indexId}`;
			let exportName: string | null = null;
			try {
				const metaRaw = await vaultRead(app, `${indexDir}/book-meta.json`);
				const meta = JSON.parse(metaRaw);
				exportName = meta.exportName || null;
			} catch { /* meta file may not exist */ }

			await vaultRmdir(app, indexDir);

			const indexes = await BookDomain.loadIndexesOnly(app, plugin);
			const index = indexes.find((idx) => idx.id === indexId);

			if (index && exportName) {
				await vaultRmdir(app, `DeepReader/${exportName}`);
				for (const ext of ["png", "jpg", "jpeg", "webp", "gif", "svg"]) {
					try {
						await vaultRemove(app, `DeepReader/covers/${exportName}.${ext}`);
					} catch { /* not found */ }
				}
			} else if (index) {
				const displayName = BookDomain.getDisplayName(index.pdf_name);
				await vaultRmdir(app, `DeepReader/${displayName}`);
				for (const ext of ["png", "jpg", "jpeg", "webp", "gif", "svg"]) {
					try {
						await vaultRemove(app, `DeepReader/covers/${displayName}.${ext}`);
					} catch { /* not found */ }
				}
			}

			// Clear catalog.json entry
			try {
				await removeFromCatalog(getVaultPath(app), indexId);
			} catch (e) {
				logError(`[BookDomain] removeFromCatalog failed (bookId=${indexId}):`, e);
			}

			return indexes.filter((idx) => idx.id !== indexId);
		} catch (error) {
			logError("[BookDomain] Delete index failed:", error);
			throw error;
		}
	}

	// ── Display Name ──

	getDisplayName(pdfName: string): string {
		return BookDomain.getDisplayName(pdfName);
	}

	// ── Library View Interaction ──

	async openLibrary(): Promise<void> {
		await this.loadIndexes();

		const existingLeaves = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
		if (existingLeaves.length > 0) {
			this.app.workspace.revealLeaf(existingLeaves[0]);
			return;
		}

		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({
			type: LIBRARY_VIEW_TYPE,
			state: {
				indexes: this._indexes,
				selectedIndexId: this._currentBooklist ? null : this._currentIndexId,
				selectedBooklistId: this._currentBooklist?.id ?? null,
			},
		});
		this.app.workspace.revealLeaf(leaf);
	}

	getBookshelfSummary(): string {
		return this.buildBookshelfSummary();
	}

	buildBookshelfSummary(): string {
		if (this._bookshelfSummary) return this._bookshelfSummary;

		const books = this._indexes.filter((i) => i.status === "ready");
		if (books.length === 0) {
			this._bookshelfSummary = "（用户书架为空，尚未索引任何书籍）";
			return this._bookshelfSummary;
		}

		const localBooks = books.filter((b) => b.fileType !== "weread");
		const wereadBooks = books.filter((b) => b.fileType === "weread");

		const lines: string[] = [];
		if (localBooks.length > 0) {
			lines.push("已索引书籍（有详细笔记）：");
			for (const book of localBooks.slice(0, 30)) {
				const author = book.author ? ` - ${book.author}` : '';
				lines.push(`- 《${book.pdf_name}》${author}`);
			}
			if (localBooks.length > 30) {
				lines.push(`...（还有 ${localBooks.length - 30} 本）`);
			}
		}

		if (wereadBooks.length > 0) {
			lines.push("微信读书已同步书籍：");
			for (const book of wereadBooks.slice(0, 20)) {
				const author = book.author ? ` - ${book.author}` : '';
				lines.push(`- 《${book.pdf_name}》${author}`);
			}
			if (wereadBooks.length > 20) {
				lines.push(`...（还有 ${wereadBooks.length - 20} 本）`);
			}
		}

		this._bookshelfSummary = lines.join("\n");
		return this._bookshelfSummary;
	}

	invalidateBookshelfSummary(): void {
		this._bookshelfSummary = null;
	}

	// ── Index Loading ──

	async loadIndexes(): Promise<void> {
		this._indexes = await BookDomain.loadIndexesOnly(this.app, this.plugin);
		this.invalidateBookshelfSummary();

		if (this.plugin.settings.lastSelectedIndexId && !this.plugin.settings.lastCrossBookMode) {
			const exists = this._indexes.some((idx) => idx.id === this.plugin.settings.lastSelectedIndexId);
			if (exists) {
				log("[BookDomain] Restoring last selected book:", this.plugin.settings.lastSelectedIndexId);
				await this.selectIndex(this.plugin.settings.lastSelectedIndexId);
			} else {
				log("[BookDomain] Last selected book no longer exists, clearing setting");
				this.plugin.settings.lastSelectedIndexId = undefined;
				await this.plugin.saveSettings();
			}
		}
		this.emitChanged();
	}

	async refreshIndexes(): Promise<void> {
		await this.loadIndexes();
	}

	// ── Book selection ──

	async selectIndex(indexId: string): Promise<void> {
		if (this._currentIndexId === indexId) {
			log(`[BookDomain] selectIndex: Already selected indexId=${indexId}, skipping`);
			await this.syncTopbarBookName();
			return;
		}

		log(`[BookDomain] selectIndex: ${indexId}`);

		// Exit booklist mode when switching to a single book
		if (this._currentBooklist) {
			this._currentBooklist = null;
			this._booklistCovers = undefined;
			this.plugin.settings.lastCrossBookMode = false;
			this.plugin.settings.lastActiveBooklistId = undefined;
		}

		this._currentIndexId = indexId;
		this.plugin.settings.lastSelectedIndexId = indexId;
		await this.plugin.saveSettings();

		const index = this._indexes.find((i) => i.id === indexId);
		let displayName: string;
		let author: string | undefined;
		let coverName: string | undefined;

		const vaultDir = await this.findBookDirectoryByIndexId(indexId);

		if (index) {
			displayName = index.pdf_name;
			if (displayName.toLowerCase().endsWith(".pdf")) displayName = displayName.slice(0, -4);
			if (displayName.toLowerCase().endsWith(".epub")) displayName = displayName.slice(0, -5);

			let exportName: string | undefined;
			let metaAuthor: string | undefined;
			try {
				const metaRaw = await vaultRead(this.app, `${PAGEINDEX_DIR}/${indexId}/book-meta.json`);
				const meta = JSON.parse(metaRaw);
				exportName = meta.exportName || undefined;
				metaAuthor = meta.author || undefined;
				coverName = exportName;
			} catch { /* ignored */ }

			const simplifiedName = vaultDir?.dirName || exportName || BookDomain.getDisplayName(displayName);
			this._currentPdfName = simplifiedName;
			displayName = vaultDir?.bookName || simplifiedName;
			author = vaultDir?.author || metaAuthor || index.author;

			this.loadBookCover(coverName || displayName, indexId);
		} else {
			let exportName: string | undefined;
			let metaAuthor: string | undefined;
			try {
				const metaRaw = await vaultRead(this.app, `${PAGEINDEX_DIR}/${indexId}/book-meta.json`);
				const meta = JSON.parse(metaRaw);
				exportName = meta.exportName || undefined;
				metaAuthor = meta.author || undefined;
			} catch { /* ignored */ }

			const resolvedName = vaultDir?.dirName || exportName;
			if (resolvedName) {
				displayName = vaultDir?.bookName || resolvedName;
				this._currentPdfName = resolvedName;
				author = vaultDir?.author || metaAuthor;
				this.loadBookCover(resolvedName, indexId);
			} else {
				log(`[BookDomain] Index ${indexId} not found in index list and no metadata, skipping`);
				return;
			}
		}

		if (!author) {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				const cache = this.app.metadataCache.getFileCache(activeFile);
				const fmAuthor = cache?.frontmatter?.author;
				if (fmAuthor && typeof fmAuthor === "string") {
					author = fmAuthor;
				}
			}
		}

		this._currentBookAuthor = author || null;

		// Read description from local Markdown note
		try {
			const bookName = coverName || BookDomain.getDisplayName(this._currentPdfName || "");
			const bookNotePath = `DeepReader/${bookName}/${bookName}.md`;
			const bookNoteFile = this.app.vault.getAbstractFileByPath(bookNotePath);

			if (bookNoteFile instanceof TFile) {
				const content = await this.app.vault.read(bookNoteFile);
				const descMatch = content.match(/## 📝 全书摘要\s*\n\n([\s\S]*?)(?=\n## |$)/);
				if (descMatch && descMatch[1]) {
					this._currentDocDescription = descMatch[1].trim();
				} else {
					this._currentDocDescription = null;
				}
			} else {
				this._currentDocDescription = null;
			}
		} catch (e) {
			logError("[BookDomain] Read book description note failed:", e);
			this._currentDocDescription = null;
		}

		this.options.cancelActiveStream();

		// Session Restoration
		const savedSessions = this.plugin.settings.savedSessions || {};
		const normalizedBookName = (this._currentPdfName || "").replace(/\.pdf$/i, "").replace(/\.epub$/i, "") || this._currentIndexId || "";
		const savedSessionId = savedSessions[normalizedBookName] || savedSessions[indexId];

		if (savedSessionId) {
			try {
				await this.options.ensureSessionStore();
				const store = this.options.getSessionStore();
				let session = store ? await store.get(savedSessionId) : null;
				let activeSessionId = savedSessionId;

				// 自愈：savedSession 仅含 welcome（messages<=1，多由恢复失败 fallback 污染），
				// 找同 indexId 下更完整的历史 session 迁移指向，恢复真实历史对话。
				if (session && session.messages.length <= 1 && store) {
					const betterId = await store.findBestSessionForIndex(indexId, savedSessionId);
					if (betterId) {
						const better = await store.get(betterId);
						if (better && better.messages.length > 1) {
							log(`[BookDomain] 自愈：savedSession ${savedSessionId} 仅 ${session.messages.length} 条，迁移到 ${betterId} (${better.messages.length} 条)`);
							session = better;
							activeSessionId = betterId;
							savedSessions[normalizedBookName] = betterId;
							savedSessions[indexId] = betterId;
							await this.plugin.saveSettings();
						}
					}
				}

				if (session) {
					const sessionIndexId = String(session.indexId);
					const sessionBookName = sessionIndexId.replace(/\.pdf$/i, "").replace(/\.epub$/i, "");
					const isMatch = sessionIndexId === indexId ||
						sessionIndexId === normalizedBookName ||
						sessionBookName === normalizedBookName ||
						sessionBookName === indexId;

					if (!isMatch) {
						await this.options.startNewSession(indexId);
						this.emitChanged(true);
						return;
					}

					this.options.setSessionId(activeSessionId);
					const restored = await this.options.restoreFromSessionStore(activeSessionId);
					if (restored) {
						this.emitChanged(false);
						return;
					}
				}
				await this.options.startNewSession(indexId);
				this.emitChanged(true);
			} catch (e) {
				logError("[BookDomain] Session restoration failed, starting new session:", e);
				await this.options.startNewSession(indexId);
				this.emitChanged(true);
			}
		} else {
			await this.options.startNewSession(indexId);
			this.emitChanged(true);
		}
	}

	async selectBookByName(bookName: string): Promise<void> {
		log("[BookDomain] Selecting book by name:", bookName);
		const normalizedBookName = bookName.replace(/\.pdf$/i, "").replace(/\.epub$/i, "");
		const currentBookName = (this._currentPdfName || "").replace(/\.pdf$/i, "").replace(/\.epub$/i, "") || "";

		if (currentBookName === normalizedBookName && this._currentIndexId) {
			return;
		}

		const findMatch = (name: string, indexes: IndexListItem[]) => {
			return indexes.find((idx) => {
				const idxName = idx.pdf_name.replace(/\.pdf$/i, "").replace(/\.epub$/i, "");
				return idxName === name ||
					idx.pdf_name === bookName ||
					idxName.startsWith(name) ||
					name.startsWith(idxName);
			});
		};

		const index = findMatch(normalizedBookName, this._indexes);
		if (index) {
			await this.selectIndex(index.id);
		} else {
			await this.loadIndexes();
			const retryIndex = findMatch(normalizedBookName, this._indexes);
			if (retryIndex) {
				await this.selectIndex(retryIndex.id);
			}
		}
	}

	// ── Vault scanning ──

	async findBookDirectoryByIndexId(indexId: string): Promise<{ dirName: string; author?: string; bookName?: string } | null> {
		const allFiles = this.app.vault.getMarkdownFiles();
		for (const f of allFiles) {
			if (!f.path.startsWith("DeepReader/")) continue;
			if (!f.path.includes("MOC")) continue;

			const cache = this.app.metadataCache.getFileCache(f);
			const fmIndexId = String(cache?.frontmatter?.index_id ?? "");
			const fmPdfIndexId = String(cache?.frontmatter?.pdf_index_id ?? "");
			if (fmIndexId === indexId || fmPdfIndexId === indexId) {
				const parts = f.path.split("/");
				if (parts.length >= 3) {
					const dirName = parts[1];
					return {
						dirName,
						author: cache?.frontmatter?.author,
						bookName: cache?.frontmatter?.book_name || cache?.frontmatter?.title,
					};
				}
			}
		}
		return null;
	}

	findIndexIdByFilePath(filePath: string): string | null {
		const parts = filePath.split("/");
		if (parts.length < 3 || parts[0] !== "DeepReader") return null;

		const bookName = parts[1];
		if (!bookName) return null;

		const index = this._indexes.find((idx) => {
			const idxName = idx.pdf_name.replace(/\.pdf$/i, "").replace(/\.epub$/i, "");
			return idxName === bookName || idxName === bookName.replace(/_/g, " ");
		});

		if (index) return index.id;

		const lastIndexId = this.plugin.settings.lastSelectedIndexId;
		if (lastIndexId) {
			const lastIndex = this._indexes.find((i) => i.id === lastIndexId);
			if (lastIndex) {
				const lastBookName = lastIndex.pdf_name.replace(/\.pdf$/i, "").replace(/\.epub$/i, "");
				if (lastBookName === bookName) return lastIndexId;
			}
		}
		return null;
	}

	async syncTopbarBookName(): Promise<void> {
		if (!this._currentIndexId) return;
		const vaultDir = await this.findBookDirectoryByIndexId(this._currentIndexId);
		if (!vaultDir) return;

		const index = this._indexes.find((i) => i.id === this._currentIndexId);
		const displayName = vaultDir.bookName || vaultDir.dirName || index?.pdf_name || this._currentPdfName || "";

		if (this._currentPdfName !== vaultDir.dirName) {
			this._currentPdfName = vaultDir.dirName;
		}

		const author = vaultDir.author || index?.author;
		this._currentBookAuthor = author || null;
		this.emitChanged(false);
	}

	async checkBookChaptersExist(pdfName: string): Promise<boolean> {
		let folderName = pdfName;
		if (folderName.toLowerCase().endsWith(".pdf")) folderName = folderName.slice(0, -4);
		if (folderName.toLowerCase().endsWith(".epub")) folderName = folderName.slice(0, -5);

		const folderPath = `DeepReader/${folderName}`;
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder) return false;

		const files = this.app.vault.getMarkdownFiles();
		const chapterFiles = files.filter((f) => f.path.startsWith(folderPath + "/"));
		return chapterFiles.length > 0;
	}

	// ── Delete index ──

	async deleteIndex(indexId: string): Promise<void> {
		try {
			const index = this._indexes.find((idx) => idx.id === indexId);
			const pdfName = index ? index.pdf_name : indexId;

			this._indexes = await BookDomain.deleteIndexOnly(this.app, this.plugin, indexId);
			this.plugin.settings.lastSelectedIndexId = undefined;
			await this.plugin.saveSettings();

			if (this._currentIndexId === indexId) {
				this.clearBookInfo();
			}
			this.eventBus.emit("book:index-deleted", { pdfName });
			this.emitChanged(true);
		} catch (error) {
			const index = this._indexes.find((idx) => idx.id === indexId);
			const pdfName = index ? index.pdf_name : indexId;
			this.eventBus.emit("book:index-delete-failed", { pdfName, error: String(error) });
		}
	}

	clearBookInfo(): void {
		this._currentIndexId = null;
		this._currentPdfName = null;
		this._currentBookCoverUrl = null;
		this._currentBookAuthor = null;
		this._currentBooklist = null;
		this._booklistCovers = undefined;
	}

	// ── Book Cover Loader ──

	async loadBookCover(bookName: string, indexId?: string): Promise<void> {
		const extensions = ["png", "jpg", "jpeg", "webp", "gif", "svg"];
		let coverFile: any = null;
		let foundPath: string = "";

		for (const ext of extensions) {
			const coverPath = `DeepReader/covers/${bookName}.${ext}`;
			const file = this.app.vault.getAbstractFileByPath(coverPath);
			if (file && file instanceof TFile) {
				coverFile = file;
				foundPath = coverPath;
				break;
			}
		}

		if (coverFile) {
			const coverUrl = this.app.vault.getResourcePath(coverFile as any);
			this._currentBookCoverUrl = coverUrl;
			this.emitChanged(false);
			return;
		}

		this._currentBookCoverUrl = null;
		this.emitChanged(false);
	}

	// ── Booklists ──

	restoreBooklist(booklist: Booklist): void {
		this._currentIndexId = null;
		this._currentPdfName = null;
		this._currentBookCoverUrl = null;
		this._currentBookAuthor = null;
		this._currentDocDescription = null;
		this._currentBooklist = booklist;
		this._booklistCovers = undefined;

		this.options.cancelActiveStream();
		this.emitChanged(true);
		this.loadAndApplyBooklistCovers(booklist);
	}

	private async loadAndApplyBooklistCovers(booklist: Booklist): Promise<void> {
		try {
			const coverUrls: string[] = [];
			const extensions = ["png", "jpg", "jpeg", "webp"];
			const adapter = this.app.vault.adapter as any;

			for (const bookId of booklist.bookIds.slice(0, 3)) {
				let found = false;
				const idx = this._indexes.find((i) => i.id === bookId);
				const pdfName = idx?.pdf_name || "";
				const names: string[] = [];
				if (pdfName) {
					const stripped = stripFileExtension(pdfName);
					names.push(stripped);
					for (const sep of ["_", "-"]) {
						if (stripped.includes(sep)) {
							names.push(stripped.split(sep)[0].trim());
							break;
						}
					}
				}
				const bookIdx = booklist.bookIds.indexOf(bookId);
				if (bookIdx >= 0 && booklist.bookNames?.[bookIdx]) {
					names.push(booklist.bookNames[bookIdx]);
				}

				for (const name of names) {
					for (const ext of extensions) {
						const coverPath = `DeepReader/covers/${name}.${ext}`;
						try {
							if (await adapter.exists(coverPath)) {
								coverUrls.push(this.app.vault.getResourcePath(coverPath as any));
								found = true;
								break;
							}
						} catch { continue; }
					}
					if (found) break;
				}
				if (!found) {
					for (const name of names) {
						for (const ext of extensions) {
							const coverPath = `DeepReader/covers/${name}.${ext}`;
							try {
								if (await adapter.exists(coverPath)) {
									coverUrls.push(this.app.vault.getResourcePath(coverPath as any));
									found = true;
									break;
								}
							} catch { continue; }
						}
						if (found) break;
					}
				}
				if (!found) coverUrls.push("");
			}

			if (coverUrls.some((u) => u)) {
				this._booklistCovers = booklist.bookIds.slice(0, 3).map((id, i) => ({
					id,
					name: booklist.bookNames?.[i] || id,
					coverUrl: coverUrls[i] || undefined,
				}));
				this.emitChanged(false);
			}
		} catch (err) {
			log.warn("[BookDomain] loadAndApplyBooklistCovers failed:", err);
		}
	}

	async selectBooklist(booklist: Booklist): Promise<void> {
		log(`[BookDomain] selectBooklist: ${booklist.name}, books=${booklist.bookIds.length}`);

		this._currentIndexId = null;
		this._currentPdfName = null;
		this._currentBookCoverUrl = null;
		this._currentBookAuthor = null;
		this._currentDocDescription = null;
		this._currentBooklist = booklist;
		this._booklistCovers = undefined;

		this.loadAndApplyBooklistCovers(booklist);

		this.plugin.settings.lastSelectedIndexId = undefined;
		this.plugin.settings.lastCrossBookMode = true;

		const history = this.plugin.settings.booklistHistory || [];
		const toSave: Booklist = { ...booklist, items: undefined };
		const idx = history.findIndex((b: Booklist) => b.id === booklist.id);
		if (idx >= 0) {
			history[idx] = toSave;
		} else {
			history.unshift(toSave);
		}
		if (history.length > 20) history.length = 20;
		this.plugin.settings.booklistHistory = history;
		this.plugin.settings.lastActiveBooklistId = booklist.id;

		await this.plugin.saveSettings();

		this.options.cancelActiveStream();
		await this.options.startNewSession(booklist.id);
		this.emitChanged(true);
	}

	clearBooklist(): void {
		if (!this._currentBooklist) return;

		this.options.cancelActiveStream();
		this._currentBooklist = null;
		this._currentDocDescription = null;
		this._booklistCovers = undefined;

		this.plugin.settings.lastCrossBookMode = false;
		this.plugin.settings.lastSelectedIndexId = undefined;
		this.plugin.settings.lastActiveBooklistId = undefined;
		this.plugin.saveSettings();
		this.options.setSessionId(null);
		this.emitChanged(true);
	}

	renameBooklist(newName: string): void {
		if (!this._currentBooklist || !newName) return;

		this._currentBooklist.name = newName;

		const history = this.plugin.settings.booklistHistory || [];
		const idx = history.findIndex((b: Booklist) => b.id === this._currentBooklist!.id);
		if (idx >= 0) {
			history[idx].name = newName;
			this.plugin.saveSettings();
		}

		const leaves = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view as any;
			view.updateBooklistName?.(this._currentBooklist!.id, newName);
		}
		this.emitChanged(false);
	}

	getCurrentBookInfo(): { title: string | null; page_count: number; docDescription: string | null } {
		return {
			title: this._currentPdfName,
			page_count: 100,
			docDescription: this._currentDocDescription,
		};
	}

	private emitChanged(clearChat = false): void {
		this.eventBus.emit("book:changed", {
			indexId: this.currentIndexId,
			pdfName: this.currentPdfName,
			docDescription: this.currentDocDescription,
			bookCoverUrl: this.currentBookCoverUrl,
			bookAuthor: this.currentBookAuthor,
			currentBooklist: this._currentBooklist,
			booklistCovers: this._booklistCovers,
			clearChat,
		});
	}

	getCurrentBookContext(): any {
		return {
			indexId: this.currentIndexId,
			pdfName: this.currentPdfName,
			docDescription: this.currentDocDescription,
			bookCoverUrl: this.currentBookCoverUrl,
			bookAuthor: this.currentBookAuthor,
			currentBooklist: this._currentBooklist,
			booklistCovers: this._booklistCovers,
			clearChat: false,
		};
	}
}
