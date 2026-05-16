/**
 * 微信读书服务入口 — WereadService
 *
 * 面向插件主入口（main.ts）的高层 API，封装客户端创建、状态管理、同步引擎。
 * 认证（Cookie 管理 / 登录流程）由 auth 模块处理，此处通过 settings 中的 Cookie 驱动。
 */

import type { App } from 'obsidian';
import type { DeepPDFSettings } from '../config/settings';
import { WereadApiClient } from './api/client';
import { SyncStateManager } from './sync/state';
import { SyncEngine, type SyncEngineCallbacks, type SyncEngineSettings } from './sync/sync-engine';
import { matchBooks, type WereadBookSummary } from './sync/matcher';
import { loadIndexedBooks } from './utils/indexed-books';
import type { WereadCookie, SyncResult, WereadMapping } from './types';
import { serviceLog as logger } from '../utils/logger';

/** 登录结果 */
export interface LoginResult {
	success: boolean;
	cookie?: WereadCookie;
	error?: string;
}

/** 最小接口：Plugin 实例需要 settings + app + saveSettings */
interface WereadPluginHost {
	settings: DeepPDFSettings;
	app: App;
	saveSettings(): Promise<void>;
}

export class WereadService {
	private syncEngine?: SyncEngine;

	constructor(private plugin: WereadPluginHost) {}

	private get settings(): DeepPDFSettings {
		return this.plugin.settings;
	}

	private getCookie(): WereadCookie | undefined {
		return this.settings.wereadCookie ?? undefined;
	}

	private async saveCookie(cookie: WereadCookie): Promise<void> {
		this.settings.wereadCookie = cookie;
		await this.plugin.saveSettings();
	}

	private getVaultAdapter() {
		return (this.plugin.app.vault as any).adapter;
	}

	private getVaultPath(): string {
		return this.getVaultAdapter().basePath as string;
	}

	private getSyncEngineSettings(): SyncEngineSettings {
		return {
			wereadNoteLocation: this.settings.wereadNoteLocation || 'DeepReader/微信读书',
			wereadSubFolder: this.settings.wereadSubFolder || '',
			wereadFileName: this.settings.wereadFileName || 'title',
			wereadExcludeArticles: this.settings.wereadExcludeArticles ?? true,
			wereadNoteCountThreshold: this.settings.wereadNoteCountThreshold ?? 0,
		};
	}

	private createSyncEngine(callbacks: SyncEngineCallbacks): SyncEngine {
		const cookie = this.getCookie();
		if (!cookie) {
			throw new Error('未登录微信读书，请先完成登录');
		}

		const client = new WereadApiClient(cookie);
		const adapter = this.getVaultAdapter();
		const vaultPath = this.getVaultPath();
		const stateManager = new SyncStateManager(adapter);
		const settings = this.getSyncEngineSettings();

		return new SyncEngine(client, stateManager, adapter, vaultPath, settings, callbacks);
	}

	async sync(
		force?: boolean,
		callbacks?: SyncEngineCallbacks,
	): Promise<SyncResult> {
		const cbs: SyncEngineCallbacks = callbacks ?? {
			onProgress: () => {},
			onNotice: (msg: string) => logger.info(msg),
		};

		this.syncEngine = this.createSyncEngine(cbs);

		try {
			return await this.syncEngine.sync({ force });
		} catch (err) {
			const msg = `同步失败: ${err instanceof Error ? err.message : String(err)}`;
			logger.error(msg);
			cbs.onNotice(msg);
			return { added: 0, updated: 0, unchanged: 0, matched: 0, unmatched: 0, errors: [msg] };
		}
	}

	/** 重新匹配微信读书书籍与 DeepReader 已索引书籍（不触发全量同步） */
	async rematch(): Promise<{ matched: number; unmatched: number }> {
		const cookie = this.getCookie();
		if (!cookie) {
			throw new Error('未登录微信读书，请先完成登录');
		}

		const adapter = this.getVaultAdapter();
		const vaultPath = this.getVaultPath();
		const stateManager = new SyncStateManager(adapter);
		await stateManager.ensureDir();

		const syncState = await stateManager.loadSyncState();
		const wereadSummaries: WereadBookSummary[] = Object.values(syncState.syncedBooks).map(b => ({
			bookId: b.bookId,
			title: b.title,
			author: b.author,
		}));

		const indexedBooks = await loadIndexedBooks(vaultPath);
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

	async login(cookie: WereadCookie): Promise<LoginResult> {
		const client = new WereadApiClient(cookie);
		const valid = await client.validateCookie();
		if (!valid) {
			return { success: false, error: 'Cookie 无效或已过期' };
		}

		await this.saveCookie(cookie);
		logger.info('微信读书登录成功');
		return { success: true, cookie };
	}

	async logout(): Promise<void> {
		this.settings.wereadCookie = null;
		await this.plugin.saveSettings();
		this.syncEngine = undefined;
		logger.info('微信读书已登出');
	}

	isLoggedIn(): boolean {
		const cookie = this.getCookie();
		if (!cookie) return false;
		if (cookie.expireAt && cookie.expireAt < Date.now()) return false;
		return !!(cookie.wr_vid && cookie.wr_skey);
	}

	async validateCookie(): Promise<boolean> {
		const cookie = this.getCookie();
		if (!cookie) return false;
		try {
			const client = new WereadApiClient(cookie);
			return await client.validateCookie();
		} catch {
			return false;
		}
	}

	/** 获取同步统计：上次同步时间、已同步数、已关联数、未匹配书籍列表 */
	async getSyncStats(): Promise<{
		lastSyncTime: number;
		syncedCount: number;
		matchedCount: number;
		unmatchedBooks: { bookId: string; title: string; author: string }[];
	}> {
		const adapter = this.getVaultAdapter();
		const stateManager = new SyncStateManager(adapter);
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
}
