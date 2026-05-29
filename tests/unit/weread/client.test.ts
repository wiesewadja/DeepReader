import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WereadApiClient } from '@/weread/api/client';

// Mock safeRequest
vi.mock('@/utils/safe-request', () => ({
	safeRequest: vi.fn(),
}));

import { safeRequest } from '@/utils/safe-request';
const mockSafeRequest = vi.mocked(safeRequest);

const TEST_API_KEY = 'wrk-test-api-key-12345';
const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';

/** 网关响应成功封装 */
function gatewayResponse(data: Record<string, unknown>) {
	return { status: 200, json: { errcode: 0, ...data }, text: '', headers: {} };
}

/** 网关响应错误 */
function gatewayError(errcode: number, errmsg = 'error') {
	return { status: 200, json: { errcode, errmsg }, text: '', headers: {} };
}

describe('WereadApiClient (Gateway)', () => {
	let client: WereadApiClient;

	beforeEach(() => {
		client = new WereadApiClient(TEST_API_KEY);
		vi.clearAllMocks();
	});

	// ═══════════════════════════════════════════════════════════════
	// 请求基础：网关 URL + Bearer 认证 + skill_version
	// ═══════════════════════════════════════════════════════════════
	describe('gateway 基础调用', () => {
		it('应 POST 到统一网关 URL', async () => {
			mockSafeRequest.mockResolvedValue(gatewayResponse({ books: [] }));

			await client.getNotebook();

			const call = mockSafeRequest.mock.calls[0][0];
			expect(call.url).toBe(GATEWAY_URL);
			expect(call.method).toBe('POST');
		});

		it('应发送 Bearer Authorization header', async () => {
			mockSafeRequest.mockResolvedValue(gatewayResponse({ books: [] }));

			await client.getNotebook();

			const call = mockSafeRequest.mock.calls[0][0];
			expect(call.headers).toMatchObject({
				'Authorization': `Bearer ${TEST_API_KEY}`,
			});
			expect(call.contentType).toBe('application/json');
		});

		it('应包含 api_name 和 skill_version', async () => {
			mockSafeRequest.mockResolvedValue(gatewayResponse({ books: [] }));

			await client.getNotebook();

			const call = mockSafeRequest.mock.calls[0][0];
			const body = JSON.parse(call.body as string);
			expect(body.api_name).toBe('/user/notebooks');
			expect(body.skill_version).toBe('1.0.3');
		});

		it('网关 errcode 非 0 时应抛出错误', async () => {
			mockSafeRequest.mockResolvedValue(gatewayError(1001, 'invalid key'));

			await expect(client.getNotebook()).rejects.toThrow('invalid key');
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// getNotebook — 分页循环
	// ═══════════════════════════════════════════════════════════════
	describe('getNotebook', () => {
		it('应自动分页循环直到 hasMore !== 1', async () => {
			// 第一页：2 本书，hasMore=1
			mockSafeRequest
				.mockResolvedValueOnce(gatewayResponse({
					books: [
						{ bookId: '1', book: { title: '书A' }, sort: 100, noteCount: 1, reviewCount: 0, reviewLikeCount: 0, reviewCommentCount: 0, bookmarkCount: 0 },
						{ bookId: '2', book: { title: '书B' }, sort: 50, noteCount: 2, reviewCount: 0, reviewLikeCount: 0, reviewCommentCount: 0, bookmarkCount: 0 },
					],
					hasMore: 1,
				}))
				// 第二页：1 本书，hasMore=0
				.mockResolvedValueOnce(gatewayResponse({
					books: [
						{ bookId: '3', book: { title: '书C' }, sort: 20, noteCount: 3, reviewCount: 0, reviewLikeCount: 0, reviewCommentCount: 0, bookmarkCount: 0 },
					],
					hasMore: 0,
				}));

			const result = await client.getNotebook();

			// 应返回所有 3 本书
			expect(result.books).toHaveLength(3);
			expect(mockSafeRequest).toHaveBeenCalledTimes(2);

			// 第二次调用应传 lastSort=50（第一页最后一条的 sort）
			const secondCallBody = JSON.parse(mockSafeRequest.mock.calls[1][0].body as string);
			expect(secondCallBody.lastSort).toBe(50);
		});

		it('只有一页时直接返回', async () => {
			mockSafeRequest.mockResolvedValue(gatewayResponse({
				books: [{ bookId: '1', book: { title: '书A' }, sort: 100, noteCount: 1, reviewCount: 0, reviewLikeCount: 0, reviewCommentCount: 0, bookmarkCount: 0 }],
				hasMore: 0,
			}));

			const result = await client.getNotebook();

			expect(result.books).toHaveLength(1);
			expect(mockSafeRequest).toHaveBeenCalledTimes(1);
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// 其他 API 方法 — 参数映射
	// ═══════════════════════════════════════════════════════════════
	describe('getShelf', () => {
		it('应传 api_name=/shelf/sync 无额外参数', async () => {
			mockSafeRequest.mockResolvedValue(gatewayResponse({ books: [] }));

			await client.getShelf();

			const body = JSON.parse(mockSafeRequest.mock.calls[0][0].body as string);
			expect(body.api_name).toBe('/shelf/sync');
		});
	});

	describe('getHighlights', () => {
		it('应传 api_name=/book/bookmarklist + bookId', async () => {
			mockSafeRequest.mockResolvedValue(gatewayResponse({ updated: [], chapters: [], book: {} }));

			await client.getHighlights('3300032341');

			const body = JSON.parse(mockSafeRequest.mock.calls[0][0].body as string);
			expect(body.api_name).toBe('/book/bookmarklist');
			expect(body.bookId).toBe('3300032341');
		});
	});

	describe('getReviews', () => {
		it('应传 api_name=/review/list/mine + bookid (小写)', async () => {
			mockSafeRequest.mockResolvedValue(gatewayResponse({ reviews: [], totalCount: 0, hasMore: 0 }));

			await client.getReviews('3300032341');

			const body = JSON.parse(mockSafeRequest.mock.calls[0][0].body as string);
			expect(body.api_name).toBe('/review/list/mine');
			expect(body.bookid).toBe('3300032341');
		});
	});

	describe('getChapters', () => {
		it('应传 api_name=/book/chapterinfo + bookId', async () => {
			mockSafeRequest.mockResolvedValue(gatewayResponse({ bookId: '3300032341', chapters: [] }));

			await client.getChapters('3300032341');

			const body = JSON.parse(mockSafeRequest.mock.calls[0][0].body as string);
			expect(body.api_name).toBe('/book/chapterinfo');
			expect(body.bookId).toBe('3300032341');
		});
	});

	describe('getProgress', () => {
		it('应传 api_name=/book/getprogress + bookId', async () => {
			mockSafeRequest.mockResolvedValue(gatewayResponse({
				bookId: '3300032341',
				book: { progress: 72, recordReadingTime: 66600 },
			}));

			await client.getProgress('3300032341');

			const body = JSON.parse(mockSafeRequest.mock.calls[0][0].body as string);
			expect(body.api_name).toBe('/book/getprogress');
			expect(body.bookId).toBe('3300032341');
		});
	});

	// ═══════════════════════════════════════════════════════════════
	// validateApiKey
	// ═══════════════════════════════════════════════════════════════
	describe('validateApiKey', () => {
		it('API Key 有效时返回 true', async () => {
			mockSafeRequest.mockResolvedValue(gatewayResponse({
				books: [{ bookId: '1' }],
				hasMore: 0,
			}));

			expect(await client.validateApiKey()).toBe(true);
		});

		it('API Key 无效（errcode != 0）时返回 false', async () => {
			mockSafeRequest.mockResolvedValue(gatewayError(1001));

			expect(await client.validateApiKey()).toBe(false);
		});

		it('网络异常时返回 false', async () => {
			mockSafeRequest.mockRejectedValue(new Error('network error'));

			expect(await client.validateApiKey()).toBe(false);
		});
	});
});
