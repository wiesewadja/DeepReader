/**
 * 书籍管理器
 *
 * 管理索引加载、书籍选择、封面/元数据、删除索引。
 */

import { Notice, TFile } from 'obsidian';
import type { FrontendAgent } from '../../agent/index.js';
import type { ProactiveEngine } from '../../agent/proactive/engine.js';
import type { SessionStore } from '../../agent/session/index.js';
import type { DeepReaderPluginInterface } from '../../agent/tools/context/vault.js';
import type { MessageList } from '../../components/message-list/message-list.js';
import type { ReadingTopbar } from '../../components/reading-topbar/index.js';
import { removeFromCatalog } from '../../pageindex/archive.js';
import { PAGEINDEX_DIR, getPageindexDir } from '../../pageindex/paths.js';
import { stripFileExtension, type IndexListItem, type Booklist } from '../../types/index.js';
import { uiLog as log, error as logError } from '../../utils/logger.js';
import { vaultRead, vaultExists, vaultList, vaultMkdir, vaultRemove, vaultRmdir, joinPath, getVaultPath } from '../../utils/mobile-fs.js';
import { LIBRARY_VIEW_TYPE } from '../library-view.js';

export interface BookManagerHost {
	get app(): import('obsidian').App;
	get plugin(): DeepReaderPluginInterface;
	get messageList(): MessageList | null;
	get readingTopbar(): ReadingTopbar | null;
	get proactiveEngine(): ProactiveEngine | null;
	get frontendAgent(): FrontendAgent | null;

	// Session delegation
	startNewSession(indexId: string): Promise<void>;
	restoreFromSessionStore(sessionId: string): Promise<boolean>;
	get sessionId(): string | null;
	set sessionId(id: string | null);
	get sessionStore(): SessionStore | null;
	ensureSessionStore(): Promise<void>;

	// Agent
	cancelActiveStream(): void;
	initializeFrontendAgent(): Promise<void>;
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
	private _currentBooklist: Booklist | null = null;

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
	get currentBooklist(): Booklist | null { return this._currentBooklist; }
	get currentBooklistBookIds(): string[] | null { return this._currentBooklist?.bookIds ?? null; }

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
			state: { indexes: this._indexes, selectedIndexId: this._currentBooklist ? null : this._currentIndexId, selectedBooklistId: this._currentBooklist?.id ?? null }
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
		const app = this.host.app;

		try {
			log('[loadIndexes] Scanning PAGEINDEX_DIR:', PAGEINDEX_DIR);
			if (!(await vaultExists(app, getPageindexDir()))) {
				this._indexes = [];
				return;
			}
			const { folders } = await vaultList(app, getPageindexDir());
			const indexes: any[] = [];

			for (const folder of folders) {
				const bookId = folder.split('/').pop() || folder;

				try {
					const statusContent = await vaultRead(app, `${PAGEINDEX_DIR}/${bookId}/.indexing.json`);
					const status = JSON.parse(statusContent);
					const isFailed = status.step === 'failed';

					// 检测僵尸索引：文件超过 30 分钟未更新视为失败
					const fileStat = await app.vault.adapter.stat(`${getPageindexDir()}/${bookId}/.indexing.json`);
					const fileAge = fileStat ? Date.now() - fileStat.mtime : 0;
					const isStale = fileAge > 30 * 60 * 1000;

					if (isStale && !isFailed) {
						// 僵尸索引：标记为失败，显示重试按钮
						indexes.push({
							id: status.bookId || bookId,
							pdf_name: status.title || bookId,
							node_count: 0,
							created_at: new Date().toISOString(),
							fileType: status.fileType,
							status: 'failed',
							progress_percent: status.percent || 0,
							message: `索引中断: ${status.stepLabel || '处理中'}（超时）`,
						});
						continue;
					} else {
						// .indexing.json 存在 = 索引进行中（不管 step/percent 值是什么）
						// 完成判断完全由 .indexing.json 是否存在决定：
						//   - 索引成功: cleanupStatus() 删除 .indexing.json
						//   - 索引失败: .indexing.json 保留且 step="failed"
						indexes.push({
							id: status.bookId || bookId,
							pdf_name: status.title || bookId,
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
					// No .indexing.json, fall through to book-meta.json
				}

				try {
					const content = await vaultRead(app, `${PAGEINDEX_DIR}/${bookId}/book-meta.json`);
					const meta = JSON.parse(content);
					// book-meta.json with status "indexing" but no .indexing.json means
					// the pipeline crashed after writing meta but before finalizing —
					// treat as ready since the index data is complete (BM25, vectors, etc.)
					const metaStatus = meta.status === 'indexing' ? 'ready' : (meta.status || 'ready');
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

			this._indexes = indexes;

			// 追加微信读书已同步书籍（跳过已关联本地的）
			try {
				const stateRaw = await vaultRead(app, `${PAGEINDEX_DIR}/weread/sync-state.json`);
				const state = JSON.parse(stateRaw);
				const syncedBooks = state.syncedBooks || {};
				const localIds = new Set(indexes.map((i: any) => i.id));

				// 从 mapping.json 收集已关联本地索引的 WeRead bookId
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
				} catch { /* mapping.json 不存在，无关联 */ }

				for (const entry of Object.values(syncedBooks) as any[]) {
					if (linkedWereadIds.has(entry.bookId)) continue;
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

			log('[DeepPDF] [loadIndexes] Loaded', indexes.length, 'indexes from pageindex/ + weread');
			this.invalidateBookshelfSummary();
		} catch {
			this._indexes = [];
		}

		if (this.host.plugin.settings.lastSelectedIndexId && !this.host.plugin.settings.lastCrossBookMode) {
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
			if (!this.host.proactiveEngine) {
				await this.host.initializeFrontendAgent();
			}
			await this.syncTopbarBookName();
			return;
		}

		log(`[DeepPDF] selectIndex triggered: ${indexId}`);

		// Exit booklist mode when switching to a single book
		if (this._currentBooklist) {
			this._currentBooklist = null;
			this.host.readingTopbar?.clearBooklistMode();
			this.host.plugin.settings.lastCrossBookMode = false;
			this.host.plugin.settings.lastActiveBooklistId = undefined;
		}

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
				const metaRaw = await vaultRead(this.host.app, `${PAGEINDEX_DIR}/${indexId}/book-meta.json`);
				const meta = JSON.parse(metaRaw);
				exportName = meta.exportName || undefined;
				metaAuthor = meta.author || undefined;
				coverName = exportName;
			} catch { /* ignore */ }

			const simplifiedName = vaultDir?.dirName || exportName || this.getDisplayName(displayName);
			this._currentPdfName = simplifiedName;
			displayName = vaultDir?.bookName || simplifiedName;

			author = vaultDir?.author || metaAuthor || index.author;
			log(`[DeepPDF] 作者信息: vaultDir.author="${vaultDir?.author}", book-meta.author="${metaAuthor}", index.author="${index.author}"`);

			this.loadBookCover(coverName || displayName, indexId);
		} else {
			let exportName: string | undefined;
			let metaAuthor: string | undefined;
			try {
				const metaRaw = await vaultRead(this.host.app, `${PAGEINDEX_DIR}/${indexId}/book-meta.json`);
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
		const savedSessionId = savedSessions[normalizedBookName] || savedSessions[indexId];

		if (savedSessionId) {
			try {
				await this.host.ensureSessionStore();
				const session = await this.host.sessionStore!.get(savedSessionId);

				if (session) {
					const sessionIndexId = String(session.indexId);
					const sessionBookName = sessionIndexId
						.replace(/\.pdf$/i, '')
						.replace(/\.epub$/i, '');

					const isMatch = sessionIndexId === indexId ||
						sessionIndexId === normalizedBookName ||
						sessionBookName === normalizedBookName ||
						sessionBookName === indexId;

					if (!isMatch) {
						log(`[DeepPDF] 会话不匹配: session.indexId="${sessionIndexId}", 当前 indexId="${indexId}", normalizedBookName="${normalizedBookName}"`);
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

		const currentBookName = (this._currentPdfName || '').replace(/\.pdf$/i, '').replace(/\.epub$/i, '') || '';
		if (currentBookName === normalizedBookName && this._currentIndexId) {
			log('[DeepPDF] Already on the same book (by name):', normalizedBookName, 'indexId:', this._currentIndexId);
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
			const app = this.host.app;

			const indexDir = `${PAGEINDEX_DIR}/${indexId}`;
			let exportName: string | null = null;
			try {
				const metaRaw = await vaultRead(app, `${indexDir}/book-meta.json`);
				const meta = JSON.parse(metaRaw);
				exportName = meta.exportName || null;
			} catch { /* meta file may not exist */ }

			await vaultRmdir(app, indexDir);

			const index = this._indexes.find(idx => idx.id === indexId);
			if (index && exportName) {
				await vaultRmdir(app, `DeepReader/${exportName}`);

				for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']) {
					try { await vaultRemove(app, `DeepReader/covers/${exportName}.${ext}`); } catch { /* not found */ }
				}
			} else if (index) {
				const displayName = this.getDisplayName(index.pdf_name);
				await vaultRmdir(app, `DeepReader/${displayName}`);

				for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']) {
					try { await vaultRemove(app, `DeepReader/covers/${displayName}.${ext}`); } catch { /* not found */ }
				}
			}

			if (this.host.sessionStore) {
				const session = await this.host.sessionStore.findSessionByIndexId(indexId);
				if (session) {
					await this.host.sessionStore.delete(session.sessionId);
				}
			}

			// 从 catalog.json 清理条目
			try {
				await removeFromCatalog(getVaultPath(this.host.app), indexId);
			} catch (e) {
				// 失败时留下 stale entry，loadArchivedBookIds 仍能读到；记录以便调试
				logError(`[DeepPDF] 清理 catalog 条目失败 (bookId=${indexId}):`, e);
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
			const fmIndexId = String(cache?.frontmatter?.index_id ?? '');
			const fmPdfIndexId = String(cache?.frontmatter?.pdf_index_id ?? '');
			if (fmIndexId === indexId || fmPdfIndexId === indexId) {
				const parts = f.path.split('/');
				if (parts.length >= 3) {
					const dirName = parts[1];
					log(`[DeepPDF] findBookDirectoryByIndexId: 找到目录 "${dirName}" (indexId=${indexId})`);
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

	/**
	 * 从文件路径查找对应的 indexId
	 * 用于当用户从 Obsidian 文件管理器直接打开书籍章节时
	 */
	findIndexIdByFilePath(filePath: string): string | null {
		// 路径格式: DeepReader/{bookName}/{chapter}.md
		const parts = filePath.split('/');
		if (parts.length < 3 || parts[0] !== 'DeepReader') return null;

		const bookName = parts[1];
		if (!bookName) return null;

		// 在 indexes 中查找匹配的书籍
		const index = this._indexes.find(idx => {
			const idxName = idx.pdf_name.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
			return idxName === bookName || idxName === bookName.replace(/_/g, ' ');
		});

		if (index) {
			log(`[DeepPDF] findIndexIdByFilePath: 从路径 "${filePath}" 找到 indexId="${index.id}"`);
			return index.id;
		}

		// 尝试通过 lastSelectedIndexId 恢复
		const lastIndexId = this.host.plugin.settings.lastSelectedIndexId;
		if (lastIndexId) {
			const lastIndex = this._indexes.find(i => i.id === lastIndexId);
			if (lastIndex) {
				const lastBookName = lastIndex.pdf_name.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
				if (lastBookName === bookName) {
					log(`[DeepPDF] findIndexIdByFilePath: 从 lastSelectedIndexId 恢复 indexId="${lastIndexId}"`);
					return lastIndexId;
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
		this._currentBooklist = null;
		this.host.readingTopbar?.setCurrentBook(null);
		this.host.readingTopbar?.setBookCover(null);
		this.host.readingTopbar?.clearBooklistMode();
	}

	clearTopbarDisplay(): void {
		this.host.readingTopbar?.setCurrentBook(null);
		this.host.readingTopbar?.setBookCover(null);
	}

	// ── Booklist (Thematic Reading) ──

	restoreBooklist(booklist: Booklist): void {
		log(`[DeepPDF] restoreBooklist: ${booklist.name}`);
		this._currentIndexId = null;
		this._currentPdfName = null;
		this._currentBookCoverUrl = null;
		this._currentBookAuthor = null;
		this._currentDocDescription = null;
		this._currentBooklist = booklist;
		this.host.cancelActiveStream();
		this.host.messageList?.clear();
		this.host.readingTopbar?.setCurrentBooklist(booklist);
		this.host.messageList?.setCurrentPdfName(booklist.name);
		this.loadAndApplyBooklistCovers(booklist);
	}

	/** 异步加载书单封面并更新 topbar */
	private async loadAndApplyBooklistCovers(booklist: Booklist): Promise<void> {
		try {
			const coverUrls: string[] = [];
			const extensions = ['png', 'jpg', 'jpeg', 'webp'];
			const adapter = this.host.app.vault.adapter as any;

			for (const bookId of booklist.bookIds.slice(0, 3)) {
				let found = false;
				// 从 indexes 获取书名
				const idx = this._indexes.find(i => i.id === bookId);
				const pdfName = idx?.pdf_name || '';
				const names: string[] = [];
				if (pdfName) {
					const stripped = stripFileExtension(pdfName);
					names.push(stripped);
					// getDisplayName 简化版：取第一个分隔符前的部分
					for (const sep of ['_', '-']) {
						if (stripped.includes(sep)) {
							names.push(stripped.split(sep)[0].trim());
							break;
						}
					}
				}
				// 也从 booklist.bookNames 取
				const bookIdx = booklist.bookIds.indexOf(bookId);
				if (bookIdx >= 0 && booklist.bookNames?.[bookIdx]) {
					const bn = booklist.bookNames[bookIdx];
					if (!names.includes(bn)) names.push(bn);
				}

				for (const name of names) {
					for (const ext of extensions) {
						const coverPath = `DeepReader/covers/${name}.${ext}`;
						const file = this.host.app.vault.getAbstractFileByPath(coverPath);
						if (file) {
							coverUrls.push(this.host.app.vault.getResourcePath(file as any));
							found = true;
							break;
						}
					}
					if (found) break;
				}
				// Fallback: adapter.exists
				if (!found) {
					for (const name of names) {
						for (const ext of extensions) {
							const coverPath = `DeepReader/covers/${name}.${ext}`;
							try {
								if (await adapter.exists(coverPath)) {
									coverUrls.push(this.host.app.vault.getResourcePath(coverPath as any));
									found = true;
									break;
								}
							} catch { continue; }
						}
						if (found) break;
					}
				}
				if (!found) coverUrls.push('');
			}

			if (coverUrls.some(u => u)) {
				const items = booklist.bookIds.slice(0, 3).map((id, i) => ({
					id,
					name: booklist.bookNames?.[i] || id,
					coverUrl: coverUrls[i] || undefined,
				}));
				this.host.readingTopbar?.updateBooklistCovers(items);
			}
		} catch (err) {
		log.warn(`[DeepPDF] loadAndApplyBooklistCovers failed:`, err);
		}
	}

	async selectBooklist(booklist: Booklist): Promise<void> {
		log(`[DeepPDF] selectBooklist: ${booklist.name}, books=${booklist.bookIds.length}`);

		this._currentIndexId = null;
		this._currentPdfName = null;
		this._currentBookCoverUrl = null;
		this._currentBookAuthor = null;
		this._currentDocDescription = null;
		this._currentBooklist = booklist;

		this.host.readingTopbar?.setCurrentBooklist(booklist);
		this.loadAndApplyBooklistCovers(booklist);

		this.host.plugin.settings.lastSelectedIndexId = undefined;
		this.host.plugin.settings.lastCrossBookMode = true;

		// 持久化书单到历史（不存 items.coverUrl，恢复时补全）
		const history = this.host.plugin.settings.booklistHistory || [];
		const toSave: Booklist = { ...booklist, items: undefined };
		const idx = history.findIndex((b: Booklist) => b.id === booklist.id);
		if (idx >= 0) {
			history[idx] = toSave;
		} else {
			history.unshift(toSave);
		}
		if (history.length > 20) history.length = 20;
		this.host.plugin.settings.booklistHistory = history;
		this.host.plugin.settings.lastActiveBooklistId = booklist.id;

		await this.host.plugin.saveSettings();

		this.host.messageList?.setCurrentPdfName(booklist.name);

		if (!this.host.proactiveEngine) {
			await this.host.initializeFrontendAgent();
		}

		this.host.cancelActiveStream();
		this.host.messageList?.clear();

		await this.host.startNewSession(booklist.id);

		log(`[DeepPDF] selectBooklist 完成: session started for ${booklist.id}`);
	}

	clearBooklist(): void {
		if (!this._currentBooklist) return;
		log(`[DeepPDF] clearBooklist: exiting booklist mode`);

		this.host.cancelActiveStream();
		this._currentBooklist = null;
		this._currentDocDescription = null;

		this.host.readingTopbar?.clearBooklistMode();
		this.host.messageList?.clear();

		this.host.plugin.settings.lastCrossBookMode = false;
		this.host.plugin.settings.lastSelectedIndexId = undefined;
		this.host.plugin.settings.lastActiveBooklistId = undefined;
		this.host.plugin.saveSettings();
		this.host.sessionId = null;
	}

	/** 重命名当前书单 */
	renameBooklist(newName: string): void {
		if (!this._currentBooklist || !newName) return;

		this._currentBooklist.name = newName;
		this.host.messageList?.setCurrentPdfName(newName);

		// 持久化到 booklistHistory
		const history = this.host.plugin.settings.booklistHistory || [];
		const idx = history.findIndex((b: Booklist) => b.id === this._currentBooklist!.id);
		if (idx >= 0) {
			history[idx].name = newName;
			this.host.plugin.saveSettings();
		}

		// 同步更新书库视图中的卡片标题
		const leaves = this.host.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view as any;
			view.updateBooklistName?.(this._currentBooklist!.id, newName);
		}

		log(`[DeepPDF] renameBooklist: ${newName}`);
	}

	getCurrentBookInfo(): { title: string | null; page_count: number; docDescription: string | null } {
		return {
			title: this._currentPdfName,
			page_count: 100,
			docDescription: this._currentDocDescription,
		};
	}
}
