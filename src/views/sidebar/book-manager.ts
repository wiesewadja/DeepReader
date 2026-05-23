/**
 * 书籍管理器
 *
 * 管理索引加载、书籍选择、封面/元数据、删除索引。
 */

import { Notice, TFile } from 'obsidian';
import { uiLog as log, error as logError } from '../../utils/logger.js';
import type { IndexListItem } from '../../types/index.js';
import type { MessageList } from '../../components/message-list/message-list.js';
import type { ReadingTopbar } from '../../components/reading-topbar/index.js';
import type { ReadingProgress } from '../../pageindex/reading-progress.js';
import type { FrontendAgent } from '../../agent/index.js';
import type { ProactiveEngine } from '../../agent/proactive/engine.js';
import type { MilestoneRecorder } from '../../agent/memory/milestones.js';
import type { SessionStore } from '../../agent/session/index.js';
import { LIBRARY_VIEW_TYPE } from '../library-view.js';

export interface BookManagerHost {
	get app(): import('obsidian').App;
	get plugin(): any;
	get messageList(): MessageList | null;
	get readingTopbar(): ReadingTopbar | null;
	get readingProgress(): ReadingProgress | null;
	get proactiveEngine(): ProactiveEngine | null;
	get frontendAgent(): FrontendAgent | null;

	// Session delegation
	startNewSession(indexId: string): Promise<void>;
	restoreFromSessionStore(sessionId: string): Promise<boolean>;
	get sessionId(): string | null;
	set sessionId(id: string | null);
	get sessionStore(): SessionStore | null;
	ensureSessionStore(): Promise<void>;

	// Progress tracking
	flushProgressSave(): Promise<void>;
	initReadingProgress(indexId: string): Promise<void>;
	navigateToLastReadChapter(): void;

	// Agent
	cancelActiveStream(): void;
	initializeFrontendAgent(): Promise<void>;
	initializeMilestoneRecorder(): Promise<void>;
}

export class BookManager {
	private host: BookManagerHost;
	private _currentIndexId: string | null = null;
	private _currentPdfName: string | null = null;
	private _currentBookCoverUrl: string | null = null;
	private _currentBookAuthor: string | null = null;
	private _currentDocDescription: string | null = null;
	private _indexes: IndexListItem[] = [];
	private _bookshelfSummary: string | null = null;
	private _milestoneRecorder: MilestoneRecorder | null = null;

	constructor(host: BookManagerHost) {
		this.host = host;
	}

	// ── State accessors ──

	get currentIndexId(): string | null { return this._currentIndexId; }
	set currentIndexId(id: string | null) { this._currentIndexId = id; }
	get currentPdfName(): string | null { return this._currentPdfName; }
	set currentPdfName(name: string | null) { this._currentPdfName = name; }
	get currentBookCoverUrl(): string | null { return this._currentBookCoverUrl; }
	set currentBookCoverUrl(url: string | null) { this._currentBookCoverUrl = url; }
	get currentBookAuthor(): string | null { return this._currentBookAuthor; }
	set currentBookAuthor(author: string | null) { this._currentBookAuthor = author; }
	get currentDocDescription(): string | null { return this._currentDocDescription; }
	set currentDocDescription(desc: string | null) { this._currentDocDescription = desc; }
	get indexes(): IndexListItem[] { return this._indexes; }
	set indexes(indexes: IndexListItem[]) { this._indexes = indexes; }
	get milestoneRecorder(): MilestoneRecorder | null { return this._milestoneRecorder; }
	set milestoneRecorder(recorder: MilestoneRecorder | null) { this._milestoneRecorder = recorder; }

	// ── Book display name ──

	getDisplayName(pdfName: string): string {
		let name = pdfName;
		// 尝试去除常见分隔符后的部分
		const separators = ['_', '-'];
		for (const sep of separators) {
			if (name.includes(sep)) {
				name = name.split(sep)[0].trim();
				break;
			}
		}
		return name;
	}

	// ── Library ──

	async openLibrary(): Promise<void> {
		await this.loadIndexes();

		const existingLeaves = this.host.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
		if (existingLeaves.length > 0) {
			this.host.app.workspace.revealLeaf(existingLeaves[0]);
			return;
		}

		const leaf = this.host.app.workspace.getLeaf('tab');
		await leaf.setViewState({
			type: LIBRARY_VIEW_TYPE,
			state: { indexes: this._indexes, selectedIndexId: this._currentIndexId }
		});
	}

	// ── Bookshelf summary ──

	buildBookshelfSummary(): string {
		if (this._bookshelfSummary) return this._bookshelfSummary;

		const books = this._indexes.filter(i => i.status === 'ready');
		if (books.length === 0) {
			this._bookshelfSummary = '（用户书架为空，尚未索引任何书籍）';
			return this._bookshelfSummary;
		}

		const localBooks = books.filter(b => b.fileType !== 'weread');
		const wereadBooks = books.filter(b => b.fileType === 'weread');

		const lines: string[] = [];
		if (localBooks.length > 0) {
			lines.push('已索引书籍（有详细笔记）：');
			for (const book of localBooks.slice(0, 30)) {
				const author = book.author ? ` - ${book.author}` : '';
				lines.push(`- 《${book.pdf_name}》${author}`);
			}
			if (localBooks.length > 30) {
				lines.push(`...（还有 ${localBooks.length - 30} 本）`);
			}
		}

		if (wereadBooks.length > 0) {
			lines.push('微信读书已同步书籍：');
			for (const book of wereadBooks.slice(0, 20)) {
				const author = book.author ? ` - ${book.author}` : '';
				lines.push(`- 《${book.pdf_name}》${author}`);
			}
			if (wereadBooks.length > 20) {
				lines.push(`...（还有 ${wereadBooks.length - 20} 本）`);
			}
		}

		this._bookshelfSummary = lines.join('\n');
		return this._bookshelfSummary;
	}

	invalidateBookshelfSummary(): void {
		this._bookshelfSummary = null;
	}

	// ── Index loading ──

	async loadIndexes(): Promise<void> {
		const vaultPath = (this.host.app.vault.adapter as any).basePath;
		const pageindexDir = `${vaultPath}/.pageindex`;

		try {
			const fs = require('fs/promises');
			const entries = await fs.readdir(pageindexDir, { withFileTypes: true });
			const indexes: any[] = [];

			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const dirPath = `${pageindexDir}/${entry.name}`;

				try {
					const statusContent = await fs.readFile(`${dirPath}/.indexing.json`, 'utf-8');
					const status = JSON.parse(statusContent);
					const isComplete = status.step === 'complete' || (status.percent || 0) >= 100;
					const isFailed = status.step === 'failed';

					if (isComplete) {
						fs.unlink(`${dirPath}/.indexing.json`).catch(() => {});
					} else {
						indexes.push({
							id: status.bookId || entry.name,
							pdf_name: status.title || entry.name,
							node_count: 0,
							created_at: new Date().toISOString(),
							fileType: status.fileType,
							status: isFailed ? 'failed' : 'processing',
							progress_percent: status.percent || 0,
							message: isFailed ? `索引失败: ${status.error || ''}` : status.stepLabel,
						});
						continue;
					}
				} catch {
					// No .indexing.json, fall through
				}

				try {
					const content = await fs.readFile(`${dirPath}/book-meta.json`, 'utf-8');
					const meta = JSON.parse(content);
					indexes.push({
						id: meta.bookId || entry.name,
						pdf_name: meta.title || entry.name,
						author: meta.author,
						description: meta.description,
						fileType: meta.fileType,
						node_count: meta.chapters?.length || 0,
						created_at: meta.indexedAt || new Date().toISOString(),
						status: 'ready',
					});
				} catch {
					// Skip
				}
			}

			this._indexes = indexes;

			// 追加微信读书已同步书籍
			try {
				const wereadStatePath = `${pageindexDir}/weread/sync-state.json`;
				const stateRaw = await fs.readFile(wereadStatePath, 'utf-8');
				const state = JSON.parse(stateRaw);
				const syncedBooks = state.syncedBooks || {};
				const localIds = new Set(indexes.map((i: any) => i.id));

				for (const entry of Object.values(syncedBooks) as any[]) {
					if (localIds.has(entry.bookId)) continue;
					indexes.push({
						id: entry.bookId,
						pdf_name: entry.title,
						author: entry.author,
						fileType: 'weread',
						node_count: (entry.noteCount || 0) + (entry.reviewCount || 0),
						created_at: entry.lastSyncTime ? new Date(entry.lastSyncTime).toISOString() : '',
						status: 'ready',
					});
				}
			} catch { /* 微信读书同步状态不存在，跳过 */ }

			log('[DeepPDF] [loadIndexes] Loaded', indexes.length, 'indexes from .pageindex/ + weread');
			this.invalidateBookshelfSummary();
		} catch {
			this._indexes = [];
		}

		if (this.host.plugin.settings.lastSelectedIndexId) {
			const exists = this._indexes.some(idx => idx.id === this.host.plugin.settings.lastSelectedIndexId);
			if (exists) {
				log('[DeepPDF] [loadIndexes] 恢复上次选中的书籍:', this.host.plugin.settings.lastSelectedIndexId);
				await this.selectIndex(this.host.plugin.settings.lastSelectedIndexId);
			} else {
				log('[DeepPDF] [loadIndexes] 上次选中的书籍已不存在，清空状态');
				this.host.plugin.settings.lastSelectedIndexId = undefined;
				await this.host.plugin.saveSettings();
			}
		}
	}

	async refreshIndexes(): Promise<void> {
		await this.loadIndexes();
	}

	// ── Book selection ──

	async selectIndex(indexId: string): Promise<void> {
		if (this._currentIndexId === indexId) {
			log(`[DeepPDF] selectIndex: 已选中索引 ${indexId}，跳过`);
			if (!this.host.readingProgress) {
				if (!this.host.proactiveEngine) {
					await this.host.initializeFrontendAgent();
				}
				await this.host.initReadingProgress(indexId);
			}
			await this.syncTopbarBookName();
			return;
		}

		log(`[DeepPDF] selectIndex triggered: ${indexId}`);

		await this.host.flushProgressSave();
		this._currentIndexId = indexId;
		this.host.plugin.settings.lastSelectedIndexId = indexId;
		await this.host.plugin.saveSettings();

		const index = this._indexes.find(i => i.id === indexId);

		let displayName: string;
		let author: string | undefined;
		let coverName: string | undefined;

		const vaultDir = await this.findBookDirectoryByIndexId(indexId);

		if (index) {
			const previousBook = this._currentPdfName;
			displayName = index.pdf_name;
			if (displayName.toLowerCase().endsWith('.pdf')) {
				displayName = displayName.slice(0, -4);
			}
			if (displayName.toLowerCase().endsWith('.epub')) {
				displayName = displayName.slice(0, -5);
			}

			let exportName: string | undefined;
			let metaAuthor: string | undefined;
			try {
				const vaultPath = (this.host.app.vault.adapter as any).basePath;
				const fs = require('fs/promises');
				const metaRaw = await fs.readFile(`${vaultPath}/.pageindex/${indexId}/book-meta.json`, 'utf-8');
				const meta = JSON.parse(metaRaw);
				exportName = meta.exportName || undefined;
				metaAuthor = meta.author || undefined;
				coverName = exportName;
			} catch { /* ignore */ }

			const simplifiedName = vaultDir?.dirName || exportName || this.getDisplayName(displayName);
			this._currentPdfName = simplifiedName;
			displayName = vaultDir?.bookName || simplifiedName;

			await this.host.initializeMilestoneRecorder();
			if (this._milestoneRecorder && previousBook !== displayName) {
				await this._milestoneRecorder.handleBookSwitch(displayName);
			}

			author = vaultDir?.author || metaAuthor || index.author;
			log(`[DeepPDF] 作者信息: vaultDir.author="${vaultDir?.author}", book-meta.author="${metaAuthor}", index.author="${index.author}"`);

			this.loadBookCover(coverName || displayName, indexId);
		} else {
			let exportName: string | undefined;
			let metaAuthor: string | undefined;
			try {
				const vaultPath = (this.host.app.vault.adapter as any).basePath;
				const fs = require('fs/promises');
				const metaRaw = await fs.readFile(`${vaultPath}/.pageindex/${indexId}/book-meta.json`, 'utf-8');
				const meta = JSON.parse(metaRaw);
				exportName = meta.exportName || undefined;
				metaAuthor = meta.author || undefined;
			} catch { /* ignore */ }

			const resolvedName = vaultDir?.dirName || exportName;
			if (resolvedName) {
				displayName = vaultDir?.bookName || resolvedName;
				this._currentPdfName = resolvedName;
				author = vaultDir?.author || metaAuthor;
				log(`[DeepPDF] 从 book-meta.json/vault 恢复书名: "${resolvedName}"`);
				this.loadBookCover(resolvedName, indexId);
			} else {
				log(`[DeepPDF] index ${indexId} 不在列表中且无 book-meta.json/vault 目录，跳过`);
				return;
			}
		}

		if (!author) {
			const activeFile = this.host.app.workspace.getActiveFile();
			if (activeFile) {
				const cache = this.host.app.metadataCache.getFileCache(activeFile);
				const fmAuthor = cache?.frontmatter?.author;
				if (fmAuthor && typeof fmAuthor === 'string') {
					author = fmAuthor;
					log(`[DeepPDF] 从章节文件 frontmatter 获取作者: "${author}"`);
				}
			}
			if (!author) {
				log(`[DeepPDF] 作者信息未找到`);
			}
		}
		log(`[DeepPDF] 最终使用的作者: author="${author}"`);

		this._currentBookAuthor = author || null;

		this.host.messageList?.setCurrentPdfName(displayName);
		this.host.readingTopbar?.setCurrentBook(displayName, author);

		if (!this.host.proactiveEngine) {
			await this.host.initializeFrontendAgent();
		}

		await this.host.initReadingProgress(indexId);
		this.host.navigateToLastReadChapter();

		// 从本地书籍笔记读取全书摘要
		try {
			const bookName = coverName || this.getDisplayName(this._currentPdfName || '');
			const bookNotePath = `DeepReader/${bookName}/${bookName}.md`;
			const bookNoteFile = this.host.app.vault.getAbstractFileByPath(bookNotePath);

			if (bookNoteFile instanceof TFile) {
				const content = await this.host.app.vault.read(bookNoteFile);
				const descMatch = content.match(/## 📝 全书摘要\s*\n\n([\s\S]*?)(?=\n## |$)/);
				if (descMatch && descMatch[1]) {
					this._currentDocDescription = descMatch[1].trim();
					log(`[DeepPDF] 从本地笔记读取到全书摘要，长度: ${this._currentDocDescription.length}`);
				} else {
					this._currentDocDescription = null;
				}
			} else {
				this._currentDocDescription = null;
			}
		} catch (e) {
			logError('[DeepPDF] 读取本地笔记失败:', e);
			this._currentDocDescription = null;
		}

		this.host.cancelActiveStream();
		this.host.messageList?.clear();

		// 恢复会话
		const savedSessions = this.host.plugin.settings.savedSessions || {};
		const normalizedBookName = (this._currentPdfName || '').replace(/\.pdf$/i, '').replace(/\.epub$/i, '') || this._currentIndexId || '';
		let savedSessionId = savedSessions[normalizedBookName] || savedSessions[indexId];

		if (savedSessionId) {
			try {
				await this.host.ensureSessionStore();
				const session = await this.host.sessionStore!.get(savedSessionId);

				if (session) {
					const sessionBookName = session.indexId
						.replace(/\.pdf$/i, '')
						.replace(/\.epub$/i, '');

					const isMatch = session.indexId === indexId ||
						session.indexId === normalizedBookName ||
						sessionBookName === normalizedBookName ||
						sessionBookName === indexId;

					if (!isMatch) {
						log(`[DeepPDF] 会话不匹配: session.indexId="${session.indexId}", 当前 indexId="${indexId}", normalizedBookName="${normalizedBookName}"`);
						this.host.startNewSession(indexId);
						return;
					}

					this.host.sessionId = savedSessionId;
					const restored = await this.host.restoreFromSessionStore(savedSessionId);
					if (restored) {
						log('[DeepPDF] 从 SessionStore 恢复会话成功，会话匹配');
						return;
					}
				}

				this.host.startNewSession(indexId);
			} catch (e) {
				logError(`[DeepPDF] 恢复会话失败:`, e);
				this.host.startNewSession(indexId);
			}
		} else {
			this.host.startNewSession(indexId);
		}
	}

	async selectBookByName(bookName: string): Promise<void> {
		log('[DeepPDF] Selecting book by name:', bookName);

		const normalizedBookName = bookName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');

		const currentBookName = (this._currentPdfName || '').replace(/\.pdf$/i, '').replace(/\.epub$/i, '') || this._currentIndexId || '';
		if (currentBookName === normalizedBookName) {
			log('[DeepPDF] Already on the same book (by name):', normalizedBookName);
			if (!this.host.readingProgress && this._currentIndexId) {
				await this.host.initReadingProgress(this._currentIndexId);
			}
			return;
		}

		const findMatch = (name: string, indexes: IndexListItem[]) => {
			return indexes.find(idx => {
				const idxName = idx.pdf_name.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
				return idxName === name ||
					idx.pdf_name === bookName ||
					idxName.startsWith(name) ||
					name.startsWith(idxName);
			});
		};

		const index = findMatch(normalizedBookName, this._indexes);
		if (index) {
			log('[DeepPDF] Found index by name:', index.id);
			await this.selectIndex(index.id);
		} else {
			log('[DeepPDF] Book not found in index list, reloading indexes...');
			await this.loadIndexes();

			const retryIndex = findMatch(normalizedBookName, this._indexes);
			if (retryIndex) {
				log('[DeepPDF] Found index after reload:', retryIndex.id);
				await this.selectIndex(retryIndex.id);
			} else {
				log('[DeepPDF] Book not found in index list after reload, skipping:', normalizedBookName);
			}
		}
	}

	// ── Delete index ──

	async handleDeleteIndex(indexId: string): Promise<void> {
		try {
			const vaultPath = (this.host.app.vault.adapter as any).basePath;
			const fs = require('fs/promises');
			const path = require('path');

			const indexDir = path.join(vaultPath, '.pageindex', indexId);
			let exportName: string | null = null;
			try {
				const metaRaw = await fs.readFile(path.join(indexDir, 'book-meta.json'), 'utf-8');
				const meta = JSON.parse(metaRaw);
				exportName = meta.exportName || null;
			} catch { /* meta file may not exist */ }

			await fs.rm(indexDir, { recursive: true, force: true });

			const index = this._indexes.find(idx => idx.id === indexId);
			if (index && exportName) {
				const exportDir = path.join(vaultPath, 'DeepReader', exportName);
				await fs.rm(exportDir, { recursive: true, force: true });

				const coversDir = path.join(vaultPath, 'DeepReader', 'covers');
				for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']) {
					const coverPath = path.join(coversDir, `${exportName}.${ext}`);
					try { await fs.unlink(coverPath); } catch { /* not found */ }
				}
			} else if (index) {
				const displayName = this.getDisplayName(index.pdf_name);
				const exportDir = path.join(vaultPath, 'DeepReader', displayName);
				await fs.rm(exportDir, { recursive: true, force: true });

				const coversDir = path.join(vaultPath, 'DeepReader', 'covers');
				for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']) {
					const coverPath = path.join(coversDir, `${displayName}.${ext}`);
					try { await fs.unlink(coverPath); } catch { /* not found */ }
				}
			}

			if (this.host.sessionStore) {
				const session = await this.host.sessionStore.findSessionByIndexId(indexId);
				if (session) {
					await this.host.sessionStore.delete(session.sessionId);
				}
			}

			new Notice("索引已删除");
			this._indexes = this._indexes.filter(idx => idx.id !== indexId);
			this.host.plugin.settings.lastSelectedIndexId = undefined;
			await this.host.plugin.saveSettings();

			if (this._currentIndexId === indexId) {
				this.clearBookInfo();
			}
		} catch (error) {
			logError('[DeepPDF] 删除索引失败:', error);
			new Notice("删除失败");
		}
	}

	// ── Cover loading ──

	async loadBookCover(bookName: string, indexId?: string): Promise<void> {
		const extensions = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];
		let coverFile: any = null;
		let foundPath: string = '';

		for (const ext of extensions) {
			const coverPath = `DeepReader/covers/${bookName}.${ext}`;
			const file = this.host.app.vault.getAbstractFileByPath(coverPath);
			if (file && file instanceof TFile) {
				coverFile = file;
				foundPath = coverPath;
				break;
			}
		}

		if (coverFile) {
			const coverUrl = this.host.app.vault.getResourcePath(coverFile as any);
			this._currentBookCoverUrl = coverUrl;
			this.host.readingTopbar?.setBookCover(coverUrl);
			log(`[DeepPDF] 从本地加载书籍封面: ${foundPath}`);
			return;
		}

		this._currentBookCoverUrl = null;
		this.host.readingTopbar?.setBookCover(null);
		log(`[DeepPDF] 书籍封面不存在: DeepReader/covers/${bookName}.{png,jpg,...}`);
	}

	// ── Vault scanning ──

	async findBookDirectoryByIndexId(indexId: string): Promise<{ dirName: string; author?: string; bookName?: string } | null> {
		const allFiles = this.host.app.vault.getMarkdownFiles();

		for (const f of allFiles) {
			if (!f.path.startsWith('DeepReader/')) continue;
			if (!f.path.includes('MOC')) continue;

			const cache = this.host.app.metadataCache.getFileCache(f);
			if (cache?.frontmatter?.index_id === indexId || cache?.frontmatter?.pdf_index_id === indexId) {
				const parts = f.path.split('/');
				if (parts.length >= 3) {
					const dirName = parts[1];
					log(`[DeepPDF] findBookDirectoryByIndexId: 找到目录 "${dirName}" (indexId=${indexId})`);
					return {
						dirName,
						author: cache.frontmatter?.author,
						bookName: cache.frontmatter?.book_name || cache.frontmatter?.title,
					};
				}
			}
		}
		return null;
	}

	async syncTopbarBookName(): Promise<void> {
		if (!this._currentIndexId) return;
		const vaultDir = await this.findBookDirectoryByIndexId(this._currentIndexId);
		if (!vaultDir) return;

		const index = this._indexes.find(i => i.id === this._currentIndexId);
		const displayName = vaultDir.bookName || vaultDir.dirName || index?.pdf_name || this._currentPdfName || '';

		if (this._currentPdfName !== vaultDir.dirName) {
			this._currentPdfName = vaultDir.dirName;
			this.host.messageList?.setCurrentPdfName(displayName);
		}

		const author = vaultDir.author || index?.author;
		this.host.readingTopbar?.setCurrentBook(displayName, author);
		log('[DeepPDF] syncTopbarBookName:', displayName);
	}

	async checkBookChaptersExist(pdfName: string): Promise<boolean> {
		let folderName = pdfName;
		if (folderName.toLowerCase().endsWith('.pdf')) {
			folderName = folderName.slice(0, -4);
		}
		if (folderName.toLowerCase().endsWith('.epub')) {
			folderName = folderName.slice(0, -5);
		}

		const folderPath = `DeepReader/${folderName}`;
		const folder = this.host.app.vault.getAbstractFileByPath(folderPath);

		if (!folder) return false;

		const files = this.host.app.vault.getMarkdownFiles();
		const chapterFiles = files.filter(f => f.path.startsWith(folderPath + '/'));
		return chapterFiles.length > 0;
	}

	// ── State helpers ──

	clearBookInfo(): void {
		this._currentIndexId = null;
		this._currentPdfName = null;
		this._currentBookCoverUrl = null;
		this._currentBookAuthor = null;
		this.host.readingTopbar?.setCurrentBook(null);
		this.host.readingTopbar?.setBookCover(null);
	}

	clearTopbarDisplay(): void {
		this.host.readingTopbar?.setCurrentBook(null);
		this.host.readingTopbar?.setBookCover(null);
	}

	getCurrentBookInfo(): { title: string | null; page_count: number; docDescription: string | null } {
		return {
			title: this._currentPdfName,
			page_count: 100,
			docDescription: this._currentDocDescription,
		};
	}
}
