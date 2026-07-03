/**
 * 封面管理器
 * 负责封面查找、加载、缓存和占位符生成
 */

import { nodeFs } from '../../utils/node-fs.js';
import { TFile, type App } from 'obsidian';
import { getBookFile } from '../../pageindex/paths.js';
import type { IndexListItem } from '../../types/index.js';
import { stripFileExtension } from '../../types/index.js';
import { getVaultPath } from '../../utils/mobile-fs.js';
import { getVaultAdapter } from '../../utils/vault.js';
import { SyncStateManager } from '../../weread/sync/state.js';
import type { VaultAdapter } from '../../weread/sync/state.js';
import { downloadWereadCover } from '../../weread/utils/cover.js';
import { sanitizeFileName } from '../../weread/utils/helpers.js';

export interface CoverManagerCallbacks {
	getIndexes: () => IndexListItem[];
	getDisplayName: (pdfName: string) => string;
	plugin: { manifest: { id: string } };
	addCoverActions: (coverEl: HTMLElement, indexId: string) => void;
}

export class CoverManager {
	private coverCache: Map<string, string> = new Map();
	private loadingCovers: Set<string> = new Set();

	constructor(
		private app: App,
		private callbacks: CoverManagerCallbacks,
	) {}

	getCache(): Map<string, string> {
		return this.coverCache;
	}

	getLoadingCovers(): Set<string> {
		return this.loadingCovers;
	}

	clearAll(): void {
		this.coverCache.clear();
		this.loadingCovers.clear();
	}

	clearLoading(): void {
		this.loadingCovers.clear();
	}

	private getAdapter(): VaultAdapter | null {
		return getVaultAdapter(this.app);
	}

	/** 查找封面文件并返回 URL，找不到返回 null */
	async findCoverUrl(indexId: string, bookName: string): Promise<string | null> {
		const possibleNames: string[] = [];

		// 1. 从 book-meta.json 读取 exportName
		try {
			const vaultPath = getVaultPath(this.app);
			const metaRaw = await nodeFs().readFile(getBookFile(vaultPath, indexId, 'book-meta.json'), 'utf-8');
			const meta = JSON.parse(metaRaw) as { exportName?: string };
			if (meta.exportName) possibleNames.push(meta.exportName);
		} catch { /* ignore */ }

		// 2. getDisplayName
		const displayName = this.callbacks.getDisplayName(bookName);
		if (displayName && !possibleNames.includes(displayName)) possibleNames.push(displayName);

		// 3. 原始 bookName
		if (bookName && !possibleNames.includes(bookName)) possibleNames.push(bookName);

		// 4. sanitize
		const sanitizedName = sanitizeFileName(bookName);
		if (sanitizedName && !possibleNames.includes(sanitizedName)) possibleNames.push(sanitizedName);

		// 5. 去扩展名的 pdf_name
		const index = this.callbacks.getIndexes().find(idx => idx.id === indexId);
		if (index) {
			const rawName = stripFileExtension(index.pdf_name);
			if (rawName && !possibleNames.includes(rawName)) possibleNames.push(rawName);
			const sanitizedRaw = sanitizeFileName(rawName);
			if (sanitizedRaw && !possibleNames.includes(sanitizedRaw)) possibleNames.push(sanitizedRaw);
		}

		const extensions = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];

		// 先查 vault 缓存
		for (const name of possibleNames) {
			for (const ext of extensions) {
				const coverPath = `DeepReader/covers/${name}.${ext}`;
				const file = this.app.vault.getAbstractFileByPath(coverPath);
				if (file && file instanceof TFile) {
					if (file.stat?.size === 0) return null;
					return this.app.vault.getResourcePath(file);
				}
			}
		}

		// Fallback: adapter 检查
		const adapter = this.getAdapter();
		if (adapter) {
			for (const name of possibleNames) {
				for (const ext of extensions) {
					const coverPath = `DeepReader/covers/${name}.${ext}`;
					try {
						if (await adapter.exists(coverPath)) {
							// adapter 查到的路径无法直接getResourcePath，但vault路径可以
							const file = this.app.vault.getAbstractFileByPath(coverPath);
							if (file && file instanceof TFile) {
								return this.app.vault.getResourcePath(file);
							}
						}
					} catch { continue; }
				}
			}
		}

		return null;
	}

	async loadCoverAndDisplay(indexId: string, bookName: string, coverEl: HTMLElement): Promise<void> {
		try {
			const localCoverUrl = await this.findCoverUrl(indexId, bookName);
			let contentEl = coverEl.querySelector('.deeppdf-lib-cover-content') as HTMLElement | null;
			const hasContentEl = !!contentEl;
			if (!contentEl) {
				contentEl = coverEl;
			}

			if (localCoverUrl) {
				this.coverCache.set(indexId, localCoverUrl);

				const checkMark = coverEl.querySelector('.deeppdf-lib-cover-check');

				if (!hasContentEl) {
					coverEl.innerHTML = '';
				} else {
					contentEl.innerHTML = '';
				}
				const imgEl = contentEl.createEl('img', { cls: 'deeppdf-lib-cover-img' });
				if (hasContentEl) {
					imgEl.style.filter = 'brightness(0.5)';
				}
				imgEl.src = localCoverUrl;
				imgEl.alt = bookName;

				imgEl.addEventListener('error', () => {
					this.coverCache.delete(indexId);
					this.retryCoverDownload(indexId, bookName, coverEl);
				});

				if (!hasContentEl && checkMark) coverEl.appendChild(checkMark);
				this.callbacks.addCoverActions(coverEl, indexId);
			} else {
				this.retryCoverDownload(indexId, bookName, coverEl);
			}
		} catch {
			// 加载失败，保持占位符
		} finally {
			this.loadingCovers.delete(indexId);
		}
	}

	/**
	 * 封面图片加载失败时，尝试重新下载封面
	 * 优先从 syncState 获取 cover URL 下载微信读书封面
	 */
	async retryCoverDownload(indexId: string, bookName: string, coverEl: HTMLElement): Promise<void> {
		const displayName = this.callbacks.getDisplayName(bookName);
		const checkMark = coverEl.querySelector('.deeppdf-lib-cover-check');
		let contentEl = coverEl.querySelector('.deeppdf-lib-cover-content') as HTMLElement | null;
		const hasContentEl = !!contentEl;
		if (!contentEl) {
			contentEl = coverEl;
		}

		// 显示加载中占位符
		if (!hasContentEl) {
			coverEl.innerHTML = `<div class="deeppdf-lib-cover-loading"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div>`;
		}

		const adapter = this.getAdapter();
		if (adapter) {
			try {
				const stateManager = new SyncStateManager(adapter, this.callbacks.plugin.manifest.id);
				const syncState = await stateManager.loadSyncState();
				const entry = syncState.syncedBooks[indexId];
				if (entry?.cover) {
					const newCoverPath = await downloadWereadCover(entry.cover, entry.title, adapter);
					if (newCoverPath) {
						await this.app.vault.adapter.stat(newCoverPath);
						const file = this.app.vault.getAbstractFileByPath(newCoverPath);
						if (file && file instanceof TFile) {
							const url = this.app.vault.getResourcePath(file);
							this.coverCache.set(indexId, url);

							if (!hasContentEl) {
								coverEl.innerHTML = '';
							} else {
								contentEl.innerHTML = '';
							}
							const imgEl = contentEl.createEl('img', { cls: 'deeppdf-lib-cover-img' });
							if (hasContentEl) {
								imgEl.style.filter = 'brightness(0.5)';
							}
							imgEl.src = url;
							imgEl.alt = bookName;
							if (!hasContentEl && checkMark) coverEl.appendChild(checkMark);
							this.callbacks.addCoverActions(coverEl, indexId);
							return;
						}
					}
				}
			} catch { /* ignore */ }
		}

		// 重新下载失败，显示占位符
		if (!hasContentEl) {
			coverEl.innerHTML = this.createCoverPlaceholder(displayName);
		} else {
			contentEl.innerHTML = this.createCoverPlaceholder(displayName);
		}
		if (!hasContentEl && checkMark) coverEl.appendChild(checkMark);
		this.callbacks.addCoverActions(coverEl, indexId);
	}

	async loadCoverForBooklistCard(indexId: string, bookName: string, coverEl: HTMLElement): Promise<void> {
		if (this.coverCache.has(indexId)) {
			coverEl.style.backgroundImage = `url(${this.coverCache.get(indexId)})`;
			return;
		}
		const url = await this.findCoverUrl(indexId, bookName);
		if (url) {
			this.coverCache.set(indexId, url);
			coverEl.style.backgroundImage = `url(${url})`;
		}
	}

	createCoverPlaceholder(bookName: string, isFailed: boolean = false): string {
		const displayName = bookName.length > 6 ? bookName.substring(0, 6) : bookName;
		if (isFailed) {
			return `
				<div class="deeppdf-lib-cover-placeholder failed">
					<div class="deeppdf-lib-cover-icon">
						<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
					</div>
					<div class="deeppdf-lib-cover-text">索引失败</div>
				</div>
			`;
		}
		return `
			<div class="deeppdf-lib-cover-placeholder">
				<div class="deeppdf-lib-cover-icon"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg></div>
				<div class="deeppdf-lib-cover-text">${displayName}</div>
			</div>
		`;
	}
}
