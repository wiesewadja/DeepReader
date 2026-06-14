/**
 * 热门划线缓存管理器
 *
 * 参考 weread 插件的 popularHighlightsCache.ts 实现
 * 缓存存储在 .weread-cache/ 目录，TTL 默认 7 天
 */

import type { VaultAdapter } from '../sync/state';
import type { PopularHighlightInfo } from '../render/markdown-renderer';

const CACHE_DIR = '.weread-cache';
const CACHE_TTL_DAYS = 7;

interface PopularHighlightCache {
	bookId: string;
	cachedAt: number;
	ttl: number;
	items: PopularHighlightInfo[];
}

export class PopularHighlightsCacheManager {
	private adapter: VaultAdapter;

	constructor(adapter: VaultAdapter) {
		this.adapter = adapter;
	}

	private getCachePath(bookId: string): string {
		return `${CACHE_DIR}/popular-${bookId}.json`;
	}

	private isCacheExpired(cache: PopularHighlightCache): boolean {
		const ttlMs = (cache.ttl || CACHE_TTL_DAYS) * 24 * 60 * 60 * 1000;
		return Date.now() > cache.cachedAt + ttlMs;
	}

	async get(bookId: string): Promise<PopularHighlightInfo[] | null> {
		try {
			const cachePath = this.getCachePath(bookId);
			if (!(await this.adapter.exists(cachePath))) {
				return null;
			}

			const content = await this.adapter.read(cachePath);
			const cache: PopularHighlightCache = JSON.parse(content);

			if (this.isCacheExpired(cache)) {
				return null;
			}

			return cache.items;
		} catch {
			return null;
		}
	}

	async set(bookId: string, items: PopularHighlightInfo[]): Promise<void> {
		try {
			const cache: PopularHighlightCache = {
				bookId,
				cachedAt: Date.now(),
				ttl: CACHE_TTL_DAYS,
				items,
			};

			const cachePath = this.getCachePath(bookId);
			await this.ensureCacheDir();
			await this.adapter.write(cachePath, JSON.stringify(cache, null, 2));
		} catch (e) {
			console.error('[PopularHighlightsCache] 写入缓存失败:', e);
		}
	}

	async clear(bookId: string): Promise<void> {
		try {
			const cachePath = this.getCachePath(bookId);
			if (await this.adapter.exists(cachePath)) {
				await this.adapter.remove(cachePath);
			}
		} catch {
			// 忽略
		}
	}

	private async ensureCacheDir(): Promise<void> {
		if (!(await this.adapter.exists(CACHE_DIR))) {
			await this.adapter.mkdir(CACHE_DIR);
		}
	}
}
