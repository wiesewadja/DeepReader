/**
 * 微信读书集成桥接器
 * 管理 weread 映射缓存、关联操作和 Z-Library 下载
 */

import type { App } from 'obsidian';
import { Notice } from 'obsidian';
import { sanitizeFileName } from '../../weread/utils/file.js';
import type { IndexListItem } from '../../types/index.js';
import type { ZLibraryBook } from '../../zlibrary/types.js';
import { ZLibrarySearchModal } from '../zlibrary-search-modal.js';
import type { ZLibraryClient } from '../../zlibrary/client.js';
import { buildZlibClient } from '../../zlibrary/build-client.js';
import { ZLIBRARY_ENABLED } from '../../config/features.js';
import { SyncStateManager } from '../../weread/sync/state.js';
import type { VaultAdapter } from '../../weread/sync/state.js';
import { getVaultAdapter } from '../../utils/vault.js';
import type { MappingStats } from '../../weread/types.js';
import { normalizeTitle } from '../../weread/sync/matcher.js';
import { PDFFileSelectorModal } from '../../ui/pdf-file-selector.js';
import type { FileSelectResult } from '../../ui/pdf-file-selector.js';
import { isSystemFileInfo } from '../../ui/pdf-file-selector.js';
import { indexBook, isBookIndexed, generateBookId } from '../../pageindex/book-indexer.js';
import { resolveRoleConfig } from '../../config/providers.js';
import { toEmbeddingOptions } from '../../config/role-adapters.js';
import { DEFAULT_EXPORT_DIR, DEFAULT_ASSETS_PATH } from '../../pageindex/defaults.js';
import { PAGEINDEX_DIR } from '../../pageindex/paths.js';
import { getVaultPath } from '../../utils/mobile-fs.js';
import { ConfirmModal } from '../../components/confirm-modal.js';
import type { DeepPDFSettings } from '../../config/settings.js';

export interface WereadBridgeCallbacks {
	app: App;
	plugin: { manifest: { id: string }; settings: DeepPDFSettings };
	getIndexes: () => IndexListItem[];
	setIndexes: (indexes: IndexListItem[]) => void;
	getCardElements: () => Map<string, HTMLElement>;
	getDisplayName: (pdfName: string) => string;
	onRefreshIndexes: () => Promise<void>;
	onLoadWereadMapping: () => Promise<void>;
	onRenderGrid: () => void;
	onUpdateCardProgress: (indexId: string, progress: number, status: string, message?: string) => void;
	onCreateBookCard: (index: IndexListItem) => HTMLElement;
}

export class WereadBridge {
	private wereadMappingCache: Set<string> = new Set();
	private associatedDeepReaderIds: Set<string> = new Set();
	private wereadStatsCache: Map<string, MappingStats> = new Map();

	constructor(private callbacks: WereadBridgeCallbacks) {}

	getMappingCache(): Set<string> { return this.wereadMappingCache; }
	getAssociatedDeepReaderIds(): Set<string> { return this.associatedDeepReaderIds; }
	getStatsCache(): Map<string, MappingStats> { return this.wereadStatsCache; }

	private getAdapter(): VaultAdapter | null {
		return getVaultAdapter(this.callbacks.app);
	}

	/** 从 .pageindex/weread/mapping.json 加载已关联书籍 ID 集合 + 统计 */
	async loadWereadMapping(): Promise<void> {
		try {
			const adapter = this.getAdapter();
			if (!adapter) return;
			const mappingPath = `${PAGEINDEX_DIR}/weread/mapping.json`;
			if (!(await adapter.exists(mappingPath))) return;
			const raw = await adapter.read(mappingPath);
			const mapping = JSON.parse(raw) as { mappings?: Record<string, { deepReaderBookId?: string; stats?: MappingStats }> };
			const entries = Object.entries(mapping.mappings || {});
			this.wereadMappingCache = new Set(entries.map(([key]) => key));
			this.associatedDeepReaderIds = new Set(
				entries.map(([, m]) => m?.deepReaderBookId).filter((id): id is string => Boolean(id)),
			);
			this.wereadStatsCache.clear();
			for (const [key, entry] of entries) {
				if (entry?.stats) {
					this.wereadStatsCache.set(key, entry.stats);
				}
			}
		} catch {
			// 静默失败
		}
	}

	isWereadLinked(index: IndexListItem): boolean {
		if (index.fileType === 'weread') return true;
		return this.wereadMappingCache.has(index.id) || this.associatedDeepReaderIds.has(index.id);
	}

	refreshWereadCardInfo(): void {
		const cardElements = this.callbacks.getCardElements();
		const indexes = this.callbacks.getIndexes();
		for (const [bookId, card] of cardElements) {
			const tagRow = card.querySelector('.deeppdf-lib-book-tag-row');
			if (tagRow && !tagRow.querySelector('.deeppdf-lib-type-weread')) {
				const idx = indexes.find(i => i.id === bookId);
				if (idx && this.isWereadLinked(idx)) {
					tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-weread', text: '微信读书' });
				}
			}

			const stats = this.wereadStatsCache.get(bookId);
			if (stats && tagRow && !(tagRow as HTMLElement).dataset.wereadStatsInjected) {
				(tagRow as HTMLElement).dataset.wereadStatsInjected = '1';
				if (stats.noteCount > 0) {
					tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-stat', text: `${stats.noteCount} 笔记` });
				}
				if (stats.reviewCount > 0) {
					tagRow.createDiv({ cls: 'deeppdf-lib-type-tag deeppdf-lib-type-stat', text: `${stats.reviewCount} 评论` });
				}
			}
		}
	}

	handleZlibDownload(index: IndexListItem): void {
		const localMatch = this.findLocalMatch(index);
		if (localMatch) {
			new ConfirmModal(
				this.callbacks.app,
				'发现本地已有此书',
				`书库中已有「${localMatch.pdf_name}」，可以直接关联而无需重新下载。\n是否直接关联？`,
				async () => {
					await this.linkExistingLocalBook(index, localMatch);
				},
				{
					confirmLabel: '直接关联',
					cancelLabel: '继续下载',
					onCancel: () => {
						this.proceedZlibDownload(index);
					},
				},
			).open();
			return;
		}

		this.proceedZlibDownload(index);
	}

	proceedZlibDownload(index: IndexListItem): void {
		if (!ZLIBRARY_ENABLED) {
			new Notice('Z-Library 功能已关闭，请前往设置启用', 3000);
			return;
		}

		const settings = this.callbacks.plugin.settings;
		if (!settings.enableZlibrary) {
			new Notice('请先在设置中启用 Z-Library 功能', 3000);
			return;
		}
		if (!settings.zlibraryUserId || !settings.zlibraryUserKey) {
			new Notice('请先在设置中登录 Z-Library 账号', 3000);
			return;
		}

		const client = buildZlibClient(settings);

		const bookTitle = this.callbacks.getDisplayName(index.pdf_name);
		const bookAuthor = index.author || '';
		new ZLibrarySearchModal(this.callbacks.app, bookTitle, bookAuthor, client, async (book) => {
			await this.downloadIndexAndAssociate(index, book, client);
		}).open();
	}

	findLocalMatch(wereadIndex: IndexListItem): IndexListItem | undefined {
		const wereadTitle = normalizeTitle(wereadIndex.pdf_name);
		if (!wereadTitle) return undefined;

		return this.callbacks.getIndexes().find(idx => {
			if (idx.fileType === 'weread') return false;
			if (this.associatedDeepReaderIds.has(idx.id)) return false;
			const localTitle = normalizeTitle(idx.pdf_name);
			if (!localTitle) return false;
			if (wereadTitle === localTitle) return true;
			const shorter = wereadTitle.length < localTitle.length ? wereadTitle : localTitle;
			const longer = wereadTitle.length < localTitle.length ? localTitle : wereadTitle;
			return longer.includes(shorter) && shorter.length >= longer.length * 0.7;
		});
	}

	async linkExistingLocalBook(wereadIndex: IndexListItem, localIndex: IndexListItem): Promise<void> {
		const adapter = this.getAdapter();
		if (!adapter) {
			new Notice('Vault 不可用');
			return;
		}

		this.setWereadCardProcessing(wereadIndex, 50, '关联中...');

		try {
			const mappingPath = `${PAGEINDEX_DIR}/weread/mapping.json`;
			let mapping = { mappings: {} as Record<string, unknown> };
			if (await adapter.exists(mappingPath)) {
				const raw = await adapter.read(mappingPath);
				mapping = JSON.parse(raw) as typeof mapping;
			}
			mapping.mappings[wereadIndex.id] = {
				deepReaderBookId: localIndex.id,
				title: wereadIndex.pdf_name,
			};
			await adapter.write(mappingPath, JSON.stringify(mapping, null, 2));
		} catch (e: unknown) {
			this.restoreWereadCard(wereadIndex);
			new Notice(`关联失败：${(e instanceof Error ? e.message : String(e))}`, 5000);
			return;
		}

		new Notice(`「${wereadIndex.pdf_name}」已关联到本地书籍`);
		await this.callbacks.onRefreshIndexes();
		await this.callbacks.onLoadWereadMapping();
		this.callbacks.onRenderGrid();
	}

	setWereadCardProcessing(index: IndexListItem, percent: number, message: string): void {
		const indexes = this.callbacks.getIndexes();
		const idx = indexes.find(i => i.id === index.id);
		if (idx) {
			idx.status = 'processing';
			idx.progress_percent = percent;
			idx.message = message;
		}
		const cardElements = this.callbacks.getCardElements();
		const oldCard = cardElements.get(index.id);
		if (oldCard) {
			const newCard = this.callbacks.onCreateBookCard(idx || index);
			oldCard.replaceWith(newCard);
			cardElements.set(index.id, newCard);
		}
	}

	restoreWereadCard(index: IndexListItem): void {
		const indexes = this.callbacks.getIndexes();
		const idx = indexes.find(i => i.id === index.id);
		if (idx) {
			idx.status = 'ready';
			idx.progress_percent = undefined;
			idx.message = undefined;
		}
		const cardElements = this.callbacks.getCardElements();
		const oldCard = cardElements.get(index.id);
		if (oldCard) {
			const newCard = this.callbacks.onCreateBookCard(idx || index);
			oldCard.replaceWith(newCard);
			cardElements.set(index.id, newCard);
		}
	}

	handleLocalAssociate(index: IndexListItem): void {
		new PDFFileSelectorModal(this.callbacks.app, async (fileInfo) => {
			await this.associateLocalFile(index, fileInfo);
		}).open();
	}

	async associateLocalFile(
		wereadIndex: IndexListItem,
		fileInfo: FileSelectResult,
	): Promise<void> {
		const adapter = this.getAdapter();
		if (!adapter) {
			new Notice('Vault 不可用');
			return;
		}

		const vaultBase = getVaultPath(this.callbacks.app);
		if (!vaultBase) {
			new Notice('无法获取 Vault 路径');
			return;
		}

		let filePath: string;
		let fileType: 'pdf' | 'epub';
		let localVaultPath: string | undefined;

		this.setWereadCardProcessing(wereadIndex, 5, '准备文件...');

		if (isSystemFileInfo(fileInfo)) {
			const ext = fileInfo.docType;
			const safeName = sanitizeFileName(fileInfo.name);
			const assetsDir = `${DEFAULT_EXPORT_DIR}/${DEFAULT_ASSETS_PATH}`;
			const vaultRelativePath = `${assetsDir}/${safeName}.${ext}`;

			if (!(await adapter.exists(assetsDir))) {
				await adapter.mkdir(assetsDir);
			}

			const buffer = await fileInfo.file.arrayBuffer();
			await adapter.writeBinary(vaultRelativePath, buffer);
			filePath = `${vaultBase}/${vaultRelativePath}`;
			fileType = ext;
			localVaultPath = vaultRelativePath;
		} else {
			filePath = `${vaultBase}/${fileInfo.file.path}`;
			fileType = fileInfo.docType;
			localVaultPath = fileInfo.file.path;
		}

		let bookId: string;
		const alreadyIndexed = await isBookIndexed(filePath, vaultBase);

		if (alreadyIndexed) {
			bookId = await generateBookId(filePath);
		} else {
			const settings = this.callbacks.plugin.settings;
			const pageindexRole = resolveRoleConfig('pageindex', settings);
			const embeddingRole = resolveRoleConfig('embedding', settings);
			const embeddingOpts = embeddingRole ? toEmbeddingOptions(embeddingRole) : undefined;

			try {
				const result = await indexBook({
					filePath,
					fileType,
					outputDir: vaultBase,
					embedding: embeddingOpts,
					model: pageindexRole?.model || 'deepseek-chat',
					apiKey: pageindexRole?.apiKey || '',
					baseUrl: pageindexRole?.baseUrl || '',
					addNodeSummary: settings.ifAddNodeSummary,
					onProgress: (p) => {
						this.callbacks.onUpdateCardProgress(wereadIndex.id, p.percent, 'processing', p.stepLabel);
					},
				});
				bookId = result.bookId;
			} catch (e: unknown) {
				this.restoreWereadCard(wereadIndex);
				new Notice(`索引失败：${(e instanceof Error ? e.message : String(e))}`, 5000);
				return;
			}
		}

		this.callbacks.onUpdateCardProgress(wereadIndex.id, 100, 'processing', '关联中...');
		try {
			const mappingPath = `${PAGEINDEX_DIR}/weread/mapping.json`;
			let mapping = { mappings: {} as Record<string, unknown> };
			if (await adapter.exists(mappingPath)) {
				const raw = await adapter.read(mappingPath);
				mapping = JSON.parse(raw) as typeof mapping;
			}
			mapping.mappings[wereadIndex.id] = {
				deepReaderBookId: bookId,
				title: wereadIndex.pdf_name,
				filePath,
				localFile: localVaultPath,
			};
			await adapter.write(mappingPath, JSON.stringify(mapping, null, 2));
			this.wereadMappingCache.add(wereadIndex.id);
		} catch (e: unknown) {
			this.restoreWereadCard(wereadIndex);
			new Notice(`关联写入失败：${(e instanceof Error ? e.message : String(e))}`, 5000);
			return;
		}

		new Notice(`「${wereadIndex.pdf_name}」关联成功`);
		await this.callbacks.onRefreshIndexes();
		await this.callbacks.onLoadWereadMapping();
		this.callbacks.onRenderGrid();
	}

	async downloadIndexAndAssociate(
		wereadIndex: IndexListItem,
		zlibBook: ZLibraryBook,
		client: ZLibraryClient,
	): Promise<void> {
		const adapter = this.getAdapter();
		if (!adapter) {
			new Notice('Vault 不可用');
			return;
		}

		const safeTitle = sanitizeFileName(zlibBook.title);
		const assetsDir = `${DEFAULT_EXPORT_DIR}/${DEFAULT_ASSETS_PATH}`;

		this.setWereadCardProcessing(wereadIndex, 5, '正在下载...');

		// ── Phase 1: 下载 ──
		let downloadPath: string;
		try {
			const { data, extension } = await client.downloadBook(zlibBook.id, zlibBook.hash);
			const fileName = `${safeTitle}.${extension}`;
			const vaultRelativePath = `${assetsDir}/${fileName}`;

			if (!(await adapter.exists(assetsDir))) {
				await adapter.mkdir(assetsDir);
			}
			await adapter.writeBinary(vaultRelativePath, data);
			const vaultBase = getVaultPath(this.callbacks.app);
			downloadPath = `${vaultBase}/${vaultRelativePath}`;
			new Notice(`已保存到 ${vaultRelativePath}`);
		} catch (e: unknown) {
			this.restoreWereadCard(wereadIndex);
			new Notice(`下载失败：${(e instanceof Error ? e.message : String(e))}`, 5000);
			return;
		}

		// ── Phase 2: 索引 ──
		const settings = this.callbacks.plugin.settings;
		const pageindexRole = resolveRoleConfig('pageindex', settings);
		const embeddingRole = resolveRoleConfig('embedding', settings);
		const embeddingOpts = embeddingRole ? toEmbeddingOptions(embeddingRole) : undefined;

		let bookId: string;
		try {
			const result = await indexBook({
				filePath: downloadPath,
				fileType: (zlibBook.extension || 'pdf') as 'pdf' | 'epub',
				outputDir: getVaultPath(this.callbacks.app),
				embedding: embeddingOpts,
				model: pageindexRole?.model || 'deepseek-chat',
				apiKey: pageindexRole?.apiKey || '',
				baseUrl: pageindexRole?.baseUrl || '',
				addNodeSummary: settings.ifAddNodeSummary,
				onProgress: (p) => {
					this.callbacks.onUpdateCardProgress(wereadIndex.id, p.percent, 'processing', p.stepLabel);
				},
			});
			bookId = result.bookId;
		} catch (e: unknown) {
			this.restoreWereadCard(wereadIndex);
			new Notice(`索引失败：${(e instanceof Error ? e.message : String(e))}`, 5000);
			return;
		}

		// ── Phase 3: 关联 ──
		this.callbacks.onUpdateCardProgress(wereadIndex.id, 100, 'processing', '关联中...');
		try {
			const mappingPath = `${PAGEINDEX_DIR}/weread/mapping.json`;
			let mapping = { mappings: {} as Record<string, unknown> };
			if (await adapter.exists(mappingPath)) {
				const raw = await adapter.read(mappingPath);
				mapping = JSON.parse(raw) as typeof mapping;
			}
			mapping.mappings[wereadIndex.id] = {
				deepReaderBookId: bookId,
				title: wereadIndex.pdf_name,
				filePath: downloadPath,
				zlibraryBookId: zlibBook.id,
			};
			await adapter.write(mappingPath, JSON.stringify(mapping, null, 2));
			this.wereadMappingCache.add(wereadIndex.id);
		} catch (e: unknown) {
			this.restoreWereadCard(wereadIndex);
			new Notice(`关联写入失败：${(e instanceof Error ? e.message : String(e))}`, 5000);
			return;
		}

		// ── Phase 4: 刷新 ──
		new Notice(`「${zlibBook.title}」下载并索引成功！`);
		await this.callbacks.onRefreshIndexes();
		await this.callbacks.onLoadWereadMapping();
		this.callbacks.onRenderGrid();
	}
}
