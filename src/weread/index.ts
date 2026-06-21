/**
 * 微信读书服务入口 — WereadService
 *
 * 面向插件主入口（main.ts）的高层 API
 */

import type { App } from 'obsidian';
import type { DeepPDFSettings } from '../config/settings';
import { serviceLog as logger } from '../utils/logger';
import { getVaultPath } from '../utils/mobile-fs.js';
import { WereadApiClient } from './api/client';
import { importHighlights } from './sync/highlight-importer';
import { enrichMappingWithStats } from './sync/mapping-stats';
import { matchBooks, type WereadBookSummary } from './sync/matcher';
import { SyncStateManager } from './sync/state';
import { WereadSyncEngine, type SyncEngineHost } from './sync/sync-engine';
import type { SyncResult, WereadMapping } from './types';
import { loadIndexedBooks } from './utils/indexed-books';

/** 最小接口：Plugin 实例需要 settings + app + saveSettings */
interface WereadPluginHost {
	settings: DeepPDFSettings;
	app: App;
	saveSettings(): Promise<void>;
	pluginId: string;  // dev='deepreader-dev'，daily='deepreader'
}

export class WereadService {
	private syncEngine?: WereadSyncEngine;

	constructor(private plugin: WereadPluginHost) {}

	private get settings(): DeepPDFSettings {
		return this.plugin.settings;
	}

	private getApiKey(): string | undefined {
		return this.settings.wereadApiKey || undefined;
	}

	private async saveApiKey(key: string): Promise<void> {
		this.settings.wereadApiKey = key;
		await this.plugin.saveSettings();
	}

	private getVaultAdapter() {
		return (this.plugin.app.vault as any).adapter;
	}

	private getVaultPathLocal(): string {
		return getVaultPath(this.plugin.app);
	}

	private createSyncEngineHost(): SyncEngineHost {
		return {
			settings: {
				wereadApiKey: this.settings.wereadApiKey,
				wereadExcludeArticles: this.settings.wereadExcludeArticles ?? true,
				wereadNoteCountThreshold: this.settings.wereadNoteCountThreshold ?? 0,
			},
			adapter: this.getVaultAdapter(),
			pluginId: this.plugin.pluginId,
		};
	}

	async sync(
		force?: boolean,
		callbacks?: { onProgress?: (p: any) => void; onNotice?: (msg: string) => void },
	): Promise<SyncResult> {
		const host = this.createSyncEngineHost();
		this.syncEngine = new WereadSyncEngine(host);
		if (callbacks?.onProgress) {
			this.syncEngine.onProgress(callbacks.onProgress);
		}

		try {
			const result = await this.syncEngine.sync(!!force);

			// 同步完成后，将统计信息注入 mapping
			await this.updateMappingStats();

			// 导入微信读书高亮到已关联书籍的章节文件
			await this.importHighlightsToChapters();

			return result;
		} catch (err) {
			const msg = `同步失败: ${err instanceof Error ? err.message : String(err)}`;
			logger.error(msg);
			callbacks?.onNotice?.(msg);
			return { added: 0, updated: 0, unchanged: 0, matched: 0, unmatched: 0, errors: [msg] };
		}
	}

	/** 重新匹配微信读书书籍与 DeepReader 已索引书籍 */
	async rematch(): Promise<{ matched: number; unmatched: number }> {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			throw new Error('未配置微信读书 API Key');
		}

		const adapter = this.getVaultAdapter();
		const stateManager = new SyncStateManager(adapter, this.plugin.pluginId);
		await stateManager.ensureDir();

		const syncState = await stateManager.loadSyncState();
		const wereadSummaries: WereadBookSummary[] = Object.values(syncState.syncedBooks).map(b => ({
			bookId: b.bookId,
			title: b.title,
			author: b.author,
		}));

		const indexedBooks = await loadIndexedBooks(this.plugin.app);
		const matchResults = matchBooks(wereadSummaries, indexedBooks);

		const now = Date.now();
		const mapping = await stateManager.loadMapping();
		let matched = 0;
		let unmatched = 0;

		for (const mr of matchResults) {
			if (mr.matched) {
				mapping.mappings[mr.wereadBookId] = {
					wereadBookId: mr.wereadBookId,
					wereadTitle: mr.wereadTitle,
					deepReaderBookId: mr.deepReaderBookId,
					deepReaderTitle: mr.deepReaderTitle,
					matchMethod: 'title-author',
					matchedAt: now,
					confirmed: false,
				};
				matched++;
			} else {
				unmatched++;
			}
		}

		await stateManager.saveMapping(mapping);
		return { matched, unmatched };
	}

	async setApiKey(key: string): Promise<{ success: boolean; error?: string }> {
		const client = new WereadApiClient(key);
		const valid = await client.validateApiKey();
		if (!valid) {
			return { success: false, error: 'API Key 无效或已过期' };
		}

		await this.saveApiKey(key);
		logger.info('微信读书 API Key 验证成功');
		return { success: true };
	}

	async logout(): Promise<void> {
		this.settings.wereadApiKey = '';
		await this.plugin.saveSettings();
		this.syncEngine = undefined;
		logger.info('微信读书已清除 API Key');
	}

	isLoggedIn(): boolean {
		return !!this.settings.wereadApiKey;
	}

	async validateApiKey(): Promise<boolean> {
		const apiKey = this.getApiKey();
		if (!apiKey) return false;
		try {
			const client = new WereadApiClient(apiKey);
			return await client.validateApiKey();
		} catch {
			return false;
		}
	}

	/** 获取同步统计 */
	async getSyncStats(): Promise<{
		lastSyncTime: number;
		syncedCount: number;
		matchedCount: number;
		unmatchedBooks: { bookId: string; title: string; author: string }[];
	}> {
		const adapter = this.getVaultAdapter();
		const stateManager = new SyncStateManager(adapter, this.plugin.pluginId);
		const syncState = await stateManager.loadSyncState();
		const mapping = await stateManager.loadMapping();

		const syncedBooks = Object.values(syncState.syncedBooks);
		const mappedIds = new Set(Object.keys(mapping.mappings));
		const unmatchedBooks = syncedBooks
			.filter(b => !mappedIds.has(b.bookId))
			.map(b => ({ bookId: b.bookId, title: b.title, author: b.author }));

		return {
			lastSyncTime: syncState.lastSyncTime,
			syncedCount: syncedBooks.length,
			matchedCount: mappedIds.size,
			unmatchedBooks,
		};
	}

	/** 将 syncState 中的统计信息注入 mapping（Phase 2） */
	private async updateMappingStats(): Promise<void> {
		try {
			const adapter = this.getVaultAdapter();
			const stateManager = new SyncStateManager(adapter, this.plugin.pluginId);

			const syncState = await stateManager.loadSyncState();
			const mapping = await stateManager.loadMapping();

			if (Object.keys(mapping.mappings).length === 0) return;

			const enriched = enrichMappingWithStats(mapping, syncState);
			await stateManager.saveMapping(enriched);

			logger.info(`Mapping stats updated for ${Object.keys(enriched.mappings).length} entries`);
		} catch (err) {
			logger.warn(`更新 mapping stats 失败: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** 将微信读书高亮导入已关联书籍的章节文件 */
	private async importHighlightsToChapters(): Promise<void> {
		try {
			const adapter = this.getVaultAdapter();
			const stateManager = new SyncStateManager(adapter, this.plugin.pluginId);
			const syncState = await stateManager.loadSyncState();
			const mapping = await stateManager.loadMapping();

			if (Object.keys(mapping.mappings).length === 0) return;

			const result = await importHighlights(adapter, mapping, syncState);
			if (result.imported > 0) {
				logger.info(`高亮导入: ${result.imported} 条`);
			}
			if (result.errors.length > 0) {
				logger.warn(`高亮导入错误: ${result.errors.join('; ')}`);
			}
		} catch (err) {
			logger.warn(`高亮导入失败: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

}
