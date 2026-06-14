import { describe, it, expect, beforeEach } from 'vitest';
import { PopularHighlightsCacheManager } from '../../../src/weread/cache/popular-highlights-cache';
import type { VaultAdapter } from '../../../src/weread/sync/state';

function createMockAdapter(): VaultAdapter {
	const files = new Map<string, string>();
	return {
		exists: async (path: string) => files.has(path),
		read: async (path: string) => files.get(path) ?? '',
		write: async (path: string, data: string) => { files.set(path, data); },
		writeBinary: async () => {},
		mkdir: async () => {},
		stat: async () => null,
		remove: async (path: string) => { files.delete(path); },
	} as unknown as VaultAdapter;
}

describe('PopularHighlightsCacheManager', () => {
	let adapter: VaultAdapter;
	let cache: PopularHighlightsCacheManager;

	beforeEach(() => {
		adapter = createMockAdapter();
		cache = new PopularHighlightsCacheManager(adapter);
	});

	it('returns null when cache does not exist', async () => {
		const result = await cache.get('book-1');
		expect(result).toBeNull();
	});

	it('returns cached items after set', async () => {
		const items = [
			{ bookmarkId: 'bm1', chapterUid: 1, range: '1-10', markText: '热门', totalCount: 100 },
		];
		await cache.set('book-1', items);
		const result = await cache.get('book-1');
		expect(result).toEqual(items);
	});

	it('returns null when cache is expired', async () => {
		const items = [
			{ bookmarkId: 'bm1', chapterUid: 1, range: '1-10', markText: '热门', totalCount: 100 },
		];
		await cache.set('book-1', items);

		// 模拟 8 天后读取：TTL 为 7 天
		const originalNow = Date.now;
		Date.now = () => originalNow() + 8 * 24 * 60 * 60 * 1000;
		try {
			const result = await cache.get('book-1');
			expect(result).toBeNull();
		} finally {
			Date.now = originalNow;
		}
	});

	it('clears cache by removing file', async () => {
		const items = [
			{ bookmarkId: 'bm1', chapterUid: 1, range: '1-10', markText: '热门', totalCount: 100 },
		];
		await cache.set('book-1', items);
		await cache.clear('book-1');
		const result = await cache.get('book-1');
		expect(result).toBeNull();
	});

	it('survives read errors gracefully', async () => {
		const failingAdapter: VaultAdapter = {
			...adapter,
			read: async () => { throw new Error('disk error'); },
		} as unknown as VaultAdapter;
		const failingCache = new PopularHighlightsCacheManager(failingAdapter);
		const result = await failingCache.get('book-1');
		expect(result).toBeNull();
	});
});
