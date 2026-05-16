import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WereadApiClient } from '../api/client';
import type { WereadCookie } from '../types';

// Mock safeRequest
vi.mock('@/utils/safe-request', () => ({
	safeRequest: vi.fn(),
}));

import { safeRequest } from '@/utils/safe-request';
const mockSafeRequest = vi.mocked(safeRequest);

const testCookie: WereadCookie = {
	wr_vid: '12345',
	wr_skey: 'test_skey',
	wr_name: '测试用户',
};

describe('WereadApiClient', () => {
	let client: WereadApiClient;

	beforeEach(() => {
		client = new WereadApiClient(testCookie);
		vi.clearAllMocks();
	});

	describe('请求头构建', () => {
		it('应包含 Cookie 和 x-vid/x-skey', async () => {
			mockSafeRequest.mockResolvedValue({ status: 200, json: { books: [] }, text: '', headers: {} });

			await client.getNotebook();

			const call = mockSafeRequest.mock.calls[0][0];
			expect(call.headers).toMatchObject({
				'Cookie': 'wr_vid=12345; wr_skey=test_skey',
				'x-vid': '12345',
				'x-skey': 'test_skey',
			});
		});
	});

	describe('getNotebook', () => {
		it('应请求正确的 URL', async () => {
			mockSafeRequest.mockResolvedValue({ status: 200, json: { books: [] }, text: '', headers: {} });

			await client.getNotebook();

			expect(mockSafeRequest.mock.calls[0][0].url).toBe('https://weread.qq.com/api/user/notebook');
		});
	});

	describe('getShelf', () => {
		it('应请求 i.weread.qq.com 域名', async () => {
			mockSafeRequest.mockResolvedValue({ status: 200, json: { books: [] }, text: '', headers: {} });

			await client.getShelf();

			expect(mockSafeRequest.mock.calls[0][0].url).toContain('i.weread.qq.com/shelf/sync');
		});
	});

	describe('getBookInfo', () => {
		it('应包含 bookId 参数', async () => {
			mockSafeRequest.mockResolvedValue({ status: 200, json: {}, text: '', headers: {} });

			await client.getBookInfo('3300032341');

			expect(mockSafeRequest.mock.calls[0][0].url).toContain('bookId=3300032341');
		});
	});

	describe('getHighlights', () => {
		it('应请求 weread.qq.com 域名', async () => {
			mockSafeRequest.mockResolvedValue({ status: 200, json: { updated: [], chapters: [], book: {} }, text: '', headers: {} });

			await client.getHighlights('3300032341');

			const url = mockSafeRequest.mock.calls[0][0].url;
			expect(url).toContain('weread.qq.com/web/book/bookmarklist');
			expect(url).toContain('bookId=3300032341');
		});
	});

	describe('getReviews', () => {
		it('应包含正确的查询参数', async () => {
			mockSafeRequest.mockResolvedValue({ status: 200, json: { reviews: [] }, text: '', headers: {} });

			await client.getReviews('3300032341');

			const url = mockSafeRequest.mock.calls[0][0].url;
			expect(url).toContain('listType=11');
			expect(url).toContain('mine=1');
		});
	});

	describe('getChapters', () => {
		it('应发送 POST 请求', async () => {
			mockSafeRequest.mockResolvedValue({ status: 200, json: { data: {} }, text: '', headers: {} });

			await client.getChapters('3300032341');

			const call = mockSafeRequest.mock.calls[0][0];
			expect(call.method).toBe('POST');
			expect(JSON.parse(call.body as string)).toEqual({ bookIds: ['3300032341'] });
		});
	});

	describe('getProgress', () => {
		it('应请求进度端点', async () => {
			mockSafeRequest.mockResolvedValue({ status: 200, json: { progress: 50, readingTime: 3600 }, text: '', headers: {} });

			const result = await client.getProgress('3300032341');

			expect(mockSafeRequest.mock.calls[0][0].url).toContain('getProgress');
			expect(result.readingTime).toBe(3600);
		});
	});

	describe('validateCookie', () => {
		it('Cookie 有效时返回 true', async () => {
			mockSafeRequest.mockResolvedValue({ status: 200, json: { books: [{ bookId: '1' }] }, text: '', headers: {} });

			const valid = await client.validateCookie();
			expect(valid).toBe(true);
		});

		it('Cookie 无效时返回 false', async () => {
			mockSafeRequest.mockResolvedValue({ status: 200, json: {}, text: '', headers: {} });

			const valid = await client.validateCookie();
			expect(valid).toBe(false);
		});

		it('请求异常时返回 false', async () => {
			mockSafeRequest.mockRejectedValue(new Error('network error'));

			const valid = await client.validateCookie();
			expect(valid).toBe(false);
		});
	});
});
