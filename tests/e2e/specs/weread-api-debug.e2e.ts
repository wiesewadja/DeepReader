/**
 * 微信读书网关 API 全链路调试
 * 通过网关代理逐步调用每个 API 查看真实返回结构
 */
import { obsidianPage } from 'wdio-obsidian-service';

describe('微信读书网关 API 全链路调试', function () {
	this.timeout(180000);

	let apiKey = '';
	let firstBookId = '';

	it('Step 1: 获取 API Key', async function () {
		const result = await browser.executeObsidian(({ app }) => {
			const plugin = app.plugins?.plugins?.['deepreader-dev'] as any;
			return { apiKey: plugin?.settings?.wereadApiKey };
		});
		expect(result?.apiKey).toBeDefined();
		apiKey = result.apiKey;
		console.log('[E2E] API Key ready, length:', apiKey.length);
	});

	it('Step 2: 通过网关调用 notebook API', async function () {
		const result = await browser.executeObsidian(async (_, key: string) => {
			const { requestUrl } = require('obsidian') as any;
			const resp = await requestUrl({
				url: 'https://i.weread.qq.com/api/agent/gateway',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${key}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ api_name: '/user/notebooks', skill_version: '1.0.3' }),
			});
			const data = resp.json;
			const books = (data.books || []).slice(0, 3);
			return {
				errcode: data.errcode,
				total: (data.books || []).length,
				hasMore: data.hasMore,
				sample: books.map((b: any) => ({
					bookId: b.bookId,
					title: b.book?.title,
					noteCount: b.noteCount,
					sort: b.sort,
				})),
			};
		}, apiKey);
		console.log('[E2E] Notebook:', JSON.stringify(result, null, 2));
		firstBookId = result.sample[0]?.bookId || '';
		console.log('[E2E] Using bookId:', firstBookId);
	});

	it('Step 3: 通过网关调用 highlights API', async function () {
		if (!firstBookId) return console.log('[E2E] SKIP: no bookId');
		const result = await browser.executeObsidian(async (_, args: { key: string; bid: string }) => {
			const { requestUrl } = require('obsidian') as any;
			const resp = await requestUrl({
				url: 'https://i.weread.qq.com/api/agent/gateway',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${args.key}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ api_name: '/book/bookmarklist', skill_version: '1.0.3', bookId: args.bid }),
			});
			const data = resp.json;
			return {
				errcode: data.errcode,
				topKeys: Object.keys(data),
				updatedLen: data.updated?.length,
				chaptersLen: data.chapters?.length,
				bookTitle: data.book?.title,
			};
		}, { key: apiKey, bid: firstBookId });
		console.log('[E2E] Highlights:', JSON.stringify(result, null, 2));
	});

	it('Step 4: 通过网关调用 chapters API', async function () {
		if (!firstBookId) return console.log('[E2E] SKIP: no bookId');
		const result = await browser.executeObsidian(async (_, args: { key: string; bid: string }) => {
			const { requestUrl } = require('obsidian') as any;
			const resp = await requestUrl({
				url: 'https://i.weread.qq.com/api/agent/gateway',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${args.key}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ api_name: '/book/chapterinfo', skill_version: '1.0.3', bookId: args.bid }),
			});
			const data = resp.json;
			return {
				errcode: data.errcode,
				bookId: data.bookId,
				chaptersLen: data.chapters?.length,
				sample: data.chapters?.slice(0, 2),
			};
		}, { key: apiKey, bid: firstBookId });
		console.log('[E2E] Chapters:', JSON.stringify(result, null, 2));
	});

	it('Step 5: 通过网关调用 reviews API', async function () {
		if (!firstBookId) return console.log('[E2E] SKIP: no bookId');
		const result = await browser.executeObsidian(async (_, args: { key: string; bid: string }) => {
			const { requestUrl } = require('obsidian') as any;
			const resp = await requestUrl({
				url: 'https://i.weread.qq.com/api/agent/gateway',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${args.key}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ api_name: '/review/list/mine', skill_version: '1.0.3', bookid: args.bid }),
			});
			const data = resp.json;
			return {
				errcode: data.errcode,
				reviewsLen: data.reviews?.length,
				totalCount: data.totalCount,
			};
		}, { key: apiKey, bid: firstBookId });
		console.log('[E2E] Reviews:', JSON.stringify(result, null, 2));
	});

	it('Step 6: 通过网关调用 progress API', async function () {
		if (!firstBookId) return console.log('[E2E] SKIP: no bookId');
		const result = await browser.executeObsidian(async (_, args: { key: string; bid: string }) => {
			const { requestUrl } = require('obsidian') as any;
			const resp = await requestUrl({
				url: 'https://i.weread.qq.com/api/agent/gateway',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${args.key}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ api_name: '/book/getprogress', skill_version: '1.0.3', bookId: args.bid }),
			});
			const data = resp.json;
			return {
				errcode: data.errcode,
				progress: data.book?.progress,
				recordReadingTime: data.book?.recordReadingTime,
			};
		}, { key: apiKey, bid: firstBookId });
		console.log('[E2E] Progress:', JSON.stringify(result, null, 2));
	});
});
