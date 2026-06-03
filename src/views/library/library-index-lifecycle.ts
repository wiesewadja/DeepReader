/**
 * 索引生命周期管理
 * 负责索引创建、进度轮询、状态检测和增量更新
 */

import type { App } from 'obsidian';
import { Notice, TFile, TFolder } from 'obsidian';
import type { IndexListItem } from '../../types/index.js';
import { stripFileExtension } from '../../types/index.js';
import type { SystemFileInfo, FileSelectResult } from '../../ui/pdf-file-selector.js';
import { isSystemFileInfo } from '../../ui/pdf-file-selector.js';
import { PDFFileSelectorModal } from '../../ui/pdf-file-selector.js';
import { indexBook, generateBookId, generateBookIdFromPath } from '../../pageindex/book-indexer.js';
import type { BookIndexProgress } from '../../pageindex/book-types.js';
import { resolveRoleConfig } from '../../config/providers.js';
import { toEmbeddingOptions, toPropositionConfig } from '../../config/role-adapters.js';
import { DEFAULT_EXPORT_DIR, DEFAULT_ASSETS_PATH } from '../../pageindex/defaults.js';
import { getVaultPath } from '../../utils/mobile-fs.js';
import { error as logError } from '../../utils/logger.js';
import type { DeepPDFSettings } from '../../config/settings.js';
import type { CoverManager } from './library-cover-manager.js';

export interface IndexLifecycleCallbacks {
	app: App;
	plugin: { settings: DeepPDFSettings };
	getIndexes: () => IndexListItem[];
	setIndexes: (indexes: IndexListItem[]) => void;
	getCardElements: () => Map<string, HTMLElement>;
	getDisplayName: (pdfName: string) => string;
	onRenderGrid: () => void;
	onCreateBookCard: (index: IndexListItem) => HTMLElement;
	onRefreshIndexes: () => Promise<IndexListItem[] | undefined>;
	onRefreshExternal: () => Promise<IndexListItem[]>;
	externalIndexes: IndexListItem[];
	coverManager: CoverManager;
	gridEl: HTMLElement | null;
	options: {
		onRefresh?: () => Promise<IndexListItem[]>;
		onDownloadCover?: (indexId: string, pdfName: string) => Promise<string | null>;
	};
}

/** Proposition 功能开关 — token 成本过高，优化后重新启用 */
const PROPOSITION_ENABLED = false;

const PROCESSING_STATUSES = new Set([
	'processing', 'indexing', 'started', 'created',
	'running', 'active', 'pending', 'queued', 'uploading',
]);
const READY_STATUSES = new Set(['ready', 'completed', 'success']);
const FAILED_STATUSES = new Set(['failed', 'error']);

export class IndexLifecycle {
	private activelyIndexingBookId: string | null = null;
	private lastIndexStates: Map<string, { status: string; progress: number; message: string }> = new Map();
	private pollingInterval: number | null = null;

	constructor(private callbacks: IndexLifecycleCallbacks) {}

	getActivelyIndexingBookId(): string | null { return this.activelyIndexingBookId; }
	getLastIndexStates(): Map<string, { status: string; progress: number; message: string }> { return this.lastIndexStates; }

	setActivelyIndexingBookId(id: string | null): void { this.activelyIndexingBookId = id; }

	cleanup(): void {
		if (this.pollingInterval) {
			window.clearInterval(this.pollingInterval);
			this.pollingInterval = null;
		}
	}

	updateCardProgress(indexId: string, progress: number, status: string, message?: string): void {
		const card = this.callbacks.getCardElements().get(indexId);
		if (!card) return;

		const progressBar = card.querySelector('.deeppdf-lib-progress-bar') as HTMLElement | null;
		const progressText = card.querySelector('.deeppdf-lib-progress-text') as HTMLElement | null;
		const progressMessage = card.querySelector('.deeppdf-lib-progress-message') as HTMLElement | null;

		if (progressBar) {
			progressBar.style.width = `${progress}%`;
		}
		if (progressText) {
			progressText.textContent = `${Math.round(progress)}%`;
		}
		if (progressMessage && message) {
			progressMessage.textContent = message;
		}
	}

	startProgressPolling(): void {
		if (this.pollingInterval) {
			window.clearInterval(this.pollingInterval);
		}

		this.pollingInterval = window.setInterval(async () => {
			await this.refreshIndexes();

			if (this.activelyIndexingBookId) {
				const indexes = this.callbacks.getIndexes();
				const activeIdx = indexes.find(idx => idx.id === this.activelyIndexingBookId);
				if (activeIdx && READY_STATUSES.has((activeIdx.status || '').toLowerCase())) {
					activeIdx.status = 'processing';
					const card = this.callbacks.getCardElements().get(this.activelyIndexingBookId);
					if (card) {
						const newCard = this.callbacks.onCreateBookCard(activeIdx);
						card.replaceWith(newCard);
						this.callbacks.getCardElements().set(this.activelyIndexingBookId!, newCard);
					}
				}
			}

			const hasProcessing = this.callbacks.getIndexes().some(idx => {
				const status = (idx.status || '').toLowerCase();
				return PROCESSING_STATUSES.has(status);
			});

			if (!hasProcessing) {
				if (this.pollingInterval) {
					window.clearInterval(this.pollingInterval);
					this.pollingInterval = null;
				}

				if (!this.activelyIndexingBookId) {
					const failedIndexes = this.callbacks.getIndexes().filter(idx => {
						const status = (idx.status || '').toLowerCase();
						return FAILED_STATUSES.has(status);
					});

					if (failedIndexes.length > 0) {
						const failedNames = failedIndexes.map(idx => this.callbacks.getDisplayName(idx.pdf_name)).join('、');
						new Notice(`索引失败: ${failedNames}，请检查 API Key 配置`, 5000);
					} else {
						new Notice('索引处理完成', 3000);
					}
				}
			}
		}, 2000);

		this.refreshIndexes();
	}

	retryIndex(index: IndexListItem): void {
		const indexes = this.callbacks.getIndexes().filter(idx => idx.id !== index.id);
		this.callbacks.setIndexes(indexes);
		this.callbacks.getCardElements().delete(index.id);
		this.lastIndexStates.delete(index.id);
		this.callbacks.onRenderGrid();

		new Notice(`请重新添加「${this.callbacks.getDisplayName(index.pdf_name)}」进行索引`, 5000);
		this.handleAddDocument();
	}

	async handleAddDocument(): Promise<void> {
		new PDFFileSelectorModal(this.callbacks.app, async (fileInfo: FileSelectResult) => {
			const displayName = this.callbacks.getDisplayName(fileInfo.name);
			let bookId = '';

			try {
				const vaultPath = getVaultPath(this.callbacks.app);
				let filePath: string;

				if (isSystemFileInfo(fileInfo)) {
					const systemFile = fileInfo as SystemFileInfo;
					const arrayBuffer = await systemFile.file.arrayBuffer();
					const fileName = systemFile.file.name;
					const vaultRelativeDir = `${DEFAULT_EXPORT_DIR}/${DEFAULT_ASSETS_PATH}`;
					const vaultRelativePath = `${vaultRelativeDir}/${fileName}`;

					if (!(this.callbacks.app.vault.getAbstractFileByPath(vaultRelativeDir) instanceof TFolder)) {
						await this.callbacks.app.vault.createFolder(vaultRelativeDir);
					}

					const existingFile = this.callbacks.app.vault.getAbstractFileByPath(vaultRelativePath);
					if (existingFile instanceof TFile) {
						await this.callbacks.app.vault.modifyBinary(existingFile, arrayBuffer);
					} else {
						await this.callbacks.app.vault.createBinary(vaultRelativePath, arrayBuffer);
					}
					new Notice(`文件已保存到 ${vaultRelativePath}`);

					filePath = `${vaultPath}/${vaultRelativePath}`;
				} else {
					filePath = fileInfo.path;
				}

				const fileType = (fileInfo as unknown as { docType: string }).docType === 'epub' ? 'epub' : 'pdf';

				const prelimId = generateBookIdFromPath(filePath);
				const newIndex: IndexListItem = {
					id: prelimId,
					pdf_name: fileInfo.name,
					fileType,
					node_count: 0,
					created_at: new Date().toISOString(),
					status: 'processing',
					progress_percent: 0,
					message: '准备索引...',
				};

				// 移除同名文件的旧索引项
				let indexes = this.callbacks.getIndexes().filter(idx => {
					const idxName = idx.pdf_name || '';
					return idxName !== fileInfo.name;
				});
				this.callbacks.getCardElements().delete(prelimId);

				this.activelyIndexingBookId = prelimId;
				indexes.unshift(newIndex);
				this.callbacks.setIndexes(indexes);
				this.callbacks.onRenderGrid();
				new Notice(`开始索引「${displayName}」...`);

				bookId = await generateBookId(filePath);
				if (bookId !== prelimId) {
					const currentIndexes = this.callbacks.getIndexes();
					const entry = currentIndexes.find(i => i.id === prelimId);
					if (entry) entry.id = bookId;
					const card = this.callbacks.getCardElements().get(prelimId);
					if (card) {
						this.callbacks.getCardElements().delete(prelimId);
						this.callbacks.getCardElements().set(bookId, card);
					}
					this.lastIndexStates.delete(prelimId);
					const dupCount = currentIndexes.filter(i => i.id === bookId).length;
					if (dupCount > 1) {
						this.callbacks.setIndexes(currentIndexes.filter(i =>
							i.id !== bookId || i.status === 'processing'
						));
					}
				}
				this.activelyIndexingBookId = bookId;

				const settings = this.callbacks.plugin.settings;
				const pageindexRole = resolveRoleConfig('pageindex', settings);
				const apiKey = pageindexRole?.apiKey || '';
				const baseUrl = pageindexRole?.baseUrl || '';
				const model = pageindexRole?.model || 'deepseek-chat';

				const embeddingRole = resolveRoleConfig('embedding', settings);
				const embeddingOpts = embeddingRole ? toEmbeddingOptions(embeddingRole) : undefined;

				const propositionRole = PROPOSITION_ENABLED ? resolveRoleConfig('proposition', settings) : null;
				const propositionOpts = propositionRole
					? toPropositionConfig(propositionRole, settings.propositionCardsPer500Words)
					: undefined;

				const result = await indexBook({
					filePath,
					fileType,
					outputDir: vaultPath,
					embedding: embeddingOpts,
					model: model,
					apiKey: apiKey,
					baseUrl: baseUrl,
					mineruApiKey: settings.providers?.['mineru']?.apiKey || '',
					addNodeSummary: settings.ifAddNodeSummary,
					propositions: propositionOpts,
					onProgress: (progress: BookIndexProgress) => {
						newIndex.progress_percent = progress.percent;
						newIndex.status = 'processing';
						newIndex.message = progress.stepLabel;
						this.updateCardProgress(bookId, progress.percent, 'processing', progress.stepLabel);
					},
				});

				await this.refreshIndexes();

				const currentIndexes = this.callbacks.getIndexes();
				const doneIdx = currentIndexes.find(idx => idx.id === bookId);
				if (doneIdx) {
					doneIdx.status = 'ready';
					doneIdx.progress_percent = 100;
					const card = this.callbacks.getCardElements().get(bookId);
					if (card) {
						const newCard = this.callbacks.onCreateBookCard(doneIdx);
						card.replaceWith(newCard);
						this.callbacks.getCardElements().set(bookId, newCard);
					}
				}

				this.activelyIndexingBookId = null;
				new Notice(`索引成功！章节: ${result.chaptersCount}`, 3000);
			} catch (error: unknown) {
				this.activelyIndexingBookId = null;
				const currentIndexes = this.callbacks.getIndexes();
				const errIdx = currentIndexes.find(idx => idx.id === bookId);
				if (errIdx) {
					errIdx.status = 'failed';
					errIdx.message = (error instanceof Error ? error.message : String(error)) || '索引失败';
					const card = this.callbacks.getCardElements().get(bookId);
					if (card) {
						const newCard = this.callbacks.onCreateBookCard(errIdx);
						card.replaceWith(newCard);
						this.callbacks.getCardElements().set(bookId, newCard);
					}
				}

				await this.refreshIndexes();

				let msg = '索引创建失败';
				const errMessage = error instanceof Error ? error.message : String(error);
				if (errMessage?.includes('API key')) msg = 'API key 未配置或无效';
				else if (errMessage) msg = `索引创建失败: ${errMessage}`;
				new Notice(msg, 5000);
				logError('[DeepPDF] 索引创建错误:', error);
			}
		}).open();
	}

	async refreshIndexes(): Promise<void> {
		const newIndexes = await this.callbacks.onRefreshIndexes();

		if (newIndexes) {
			const currentIndexes = this.callbacks.getIndexes();

			const realBookIds = new Set(newIndexes.map(idx => idx.id));
			const tempIndexesToKeep = currentIndexes.filter(idx =>
				idx.id.startsWith('temp_') && !realBookIds.has(idx.id)
			);
			const processingToKeep = currentIndexes.filter(idx =>
				!idx.id.startsWith('temp_') &&
				PROCESSING_STATUSES.has((idx.status || '').toLowerCase()) &&
				!realBookIds.has(idx.id)
			);

			const merged = [...newIndexes, ...tempIndexesToKeep, ...processingToKeep];

			const seen = new Set<string>();
			this.callbacks.setIndexes(merged.filter(idx => {
				if (seen.has(idx.id)) return false;
				seen.add(idx.id);
				return true;
			}));

			const updatedIndexes = this.callbacks.getIndexes();
			const currentIds = new Set(updatedIndexes.map(idx => idx.id));
			const cardElements = this.callbacks.getCardElements();
			for (const [id, card] of cardElements) {
				if (!currentIds.has(id)) {
					card.remove();
					cardElements.delete(id);
					this.lastIndexStates.delete(id);
				}
			}

			const newAddedIndexes = this.detectNewIndexes(updatedIndexes);
			const changedIndexes = this.detectChangedIndexes(updatedIndexes);
			const completedIndexes = this.detectCompletedIndexes(updatedIndexes);

			if (newAddedIndexes.length > 0) {
				this.addNewCards(newAddedIndexes);
			} else if (changedIndexes.length > 0 || completedIndexes.length > 0) {
				await this.updateCardsIncrementally(changedIndexes, completedIndexes);
			}
		} else {
			this.callbacks.setIndexes([...this.callbacks.externalIndexes]);
		}
	}

	detectNewIndexes(newIndexes: IndexListItem[]): IndexListItem[] {
		return newIndexes.filter(idx => !this.lastIndexStates.has(idx.id));
	}

	detectChangedIndexes(newIndexes: IndexListItem[]): IndexListItem[] {
		return newIndexes.filter(idx => {
			const lastState = this.lastIndexStates.get(idx.id);
			if (!lastState) return false;

			const newStatus = (idx.status || 'unknown').toLowerCase();
			const newProgress = idx.progress_percent || 0;
			const newMessage = idx.message || '';

			return lastState.status.toLowerCase() !== newStatus ||
				   Math.abs(lastState.progress - newProgress) >= 5 ||
				   (lastState.message || '') !== newMessage;
		});
	}

	detectCompletedIndexes(newIndexes: IndexListItem[]): IndexListItem[] {
		const completedIds: string[] = [];

		newIndexes.forEach(idx => {
			const lastState = this.lastIndexStates.get(idx.id);

			if (lastState) {
				const wasProcessing = PROCESSING_STATUSES.has(lastState.status.toLowerCase());
				const isNowReady = READY_STATUSES.has((idx.status || '').toLowerCase());

				if (wasProcessing && isNowReady) {
					completedIds.push(idx.id);
				}
			}
		});

		return newIndexes.filter(idx => completedIds.includes(idx.id));
	}

	addNewCards(newIndexes: IndexListItem[]): void {
		if (!this.callbacks.gridEl) return;

		const isEmptyState = this.callbacks.gridEl.querySelector('.deeppdf-lib-empty') !== null;
		if (isEmptyState) {
			this.callbacks.onRenderGrid();
			return;
		}

		for (const index of newIndexes) {
			const card = this.callbacks.onCreateBookCard(index);
			this.callbacks.gridEl!.appendChild(card);
			this.callbacks.getCardElements().set(index.id, card);
			this.lastIndexStates.set(index.id, {
				status: index.status || 'unknown',
				progress: index.progress_percent || 0,
				message: index.message || '',
			});
		}

		const hasProcessing = newIndexes.some(idx =>
			PROCESSING_STATUSES.has((idx.status || '').toLowerCase())
		);
		if (hasProcessing) {
			this.startProgressPolling();
		}
	}

	async updateCardsIncrementally(changedIndexes: IndexListItem[], completedIndexes: IndexListItem[]): Promise<void> {
		const isEmptyState = this.callbacks.gridEl?.querySelector('.deeppdf-lib-empty') !== null;
		if (isEmptyState) {
			this.callbacks.onRenderGrid();
			return;
		}

		changedIndexes.forEach(idx => {
			const rawStatus = (idx.status || 'unknown').toLowerCase();
			const isProcessing = PROCESSING_STATUSES.has(rawStatus);

			if (isProcessing) {
				this.updateCardProgress(idx.id, idx.progress_percent || 0, idx.status || '', idx.message || undefined);
			} else {
				const card = this.callbacks.getCardElements().get(idx.id);
				if (card) {
					const newCard = this.callbacks.onCreateBookCard(idx);
					card.replaceWith(newCard);
					this.callbacks.getCardElements().set(idx.id, newCard);
				}
			}
		});

		changedIndexes.forEach(idx => {
			this.lastIndexStates.set(idx.id, {
				status: idx.status || 'unknown',
				progress: idx.progress_percent || 0,
				message: idx.message || '',
			});
		});

		// 对刚完成的索引，先下载封面到本地，然后显示
		const coverManager = this.callbacks.coverManager;
		for (const idx of completedIndexes) {
			if (!coverManager.getCache().has(idx.id) && !coverManager.getLoadingCovers().has(idx.id)) {
				coverManager.getLoadingCovers().add(idx.id);
				const card = this.callbacks.getCardElements().get(idx.id);
				if (card) {
					const coverEl = card.querySelector('.deeppdf-lib-book-cover');
					if (coverEl) {
						const bookName = this.callbacks.getDisplayName(idx.pdf_name);
						if (this.callbacks.options.onDownloadCover) {
							await this.callbacks.options.onDownloadCover(idx.id, idx.pdf_name);
						}
						await coverManager.loadCoverAndDisplay(idx.id, bookName, coverEl as HTMLElement);
					}
				}
			}
		}

		// 对正在进行中且进度 >= 50 的索引，也加载封面
		for (const idx of changedIndexes) {
			const progress = idx.progress_percent || 0;
			const isProcessing = PROCESSING_STATUSES.has((idx.status || '').toLowerCase());

			if (isProcessing && progress >= 50 && !coverManager.getCache().has(idx.id) && !coverManager.getLoadingCovers().has(idx.id)) {
				coverManager.getLoadingCovers().add(idx.id);
				const card = this.callbacks.getCardElements().get(idx.id);
				if (card) {
					const coverEl = card.querySelector('.deeppdf-lib-book-cover');
					if (coverEl) {
						const bookName = this.callbacks.getDisplayName(idx.pdf_name);
						await coverManager.loadCoverAndDisplay(idx.id, bookName, coverEl as HTMLElement);
					}
				}
			}
		}
	}
}
