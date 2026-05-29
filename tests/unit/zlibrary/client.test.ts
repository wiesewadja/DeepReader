import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZLibraryClient } from '@/zlibrary/client';
import type { SafeResponse } from '@/utils/safe-request';

vi.mock('@/utils/safe-request', () => ({
	safeRequest: vi.fn(),
}));

import { safeRequest } from '@/utils/safe-request';
const mockRequest = safeRequest as vi.MockedFunction<typeof safeRequest>;

function mockResponse(data: any, status = 200): SafeResponse {
	return {
		status,
		headers: {},
		text: JSON.stringify(data),
		json: data,
		arrayBuffer: undefined,
	};
}

function mockBinaryResponse(data: Uint8Array, status = 200): SafeResponse {
	const buffer = data.buffer as ArrayBuffer;
	return {
		status,
		headers: {},
		text: '',
		json: undefined,
		arrayBuffer: buffer,
	};
}

describe('ZLibraryClient', () => {
	beforeEach(() => {
		mockRequest.mockReset();
	});

	describe('login', () => {
		it('登录成功返回 UserProfile', async () => {
			mockRequest.mockResolvedValueOnce(mockResponse({
				success: 1,
				user: { id: 23688146, remix_userkey: 'd07560abc' },
			}));

			const client = new ZLibraryClient();
			const profile = await client.login('test@example.com', 'password');

			expect(profile.userId).toBe(23688146);
			expect(mockRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					url: expect.stringContaining('/eapi/user/login'),
					method: 'POST',
				}),
			);
		});

		it('登录失败抛出 ZLibraryError', async () => {
			mockRequest.mockResolvedValueOnce(mockResponse({ success: 0 }));

			const client = new ZLibraryClient();
			await expect(client.login('bad@email.com', 'wrong')).rejects.toThrow('登录失败');
		});
	});

	describe('search', () => {
		it('搜索返回正确解析的书籍列表', async () => {
			mockRequest.mockResolvedValueOnce(mockResponse({
				success: 1,
				books: [
					{
						id: 11773507, hash: 'abc123', title: '高效能人士的七个习惯',
						author: '史蒂芬·柯维', extension: 'epub', size: '2.5 MB',
						cover: 'https://example.com/cover.jpg', year: 2020, language: 'chinese',
					},
				],
				exactBooksCount: 5, pagination: [{}],
			}));

			const client = new ZLibraryClient();
			const result = await client.search('高效能人士的七个习惯');

			expect(result.books).toHaveLength(1);
			expect(result.books[0].title).toBe('高效能人士的七个习惯');
			expect(result.books[0].extension).toBe('epub');
			expect(result.total).toBe(5);
		});

		it('搜索传递正确的参数', async () => {
			mockRequest.mockResolvedValueOnce(mockResponse({
				success: 1, books: [], exactBooksCount: 0, pagination: [],
			}));

			const client = new ZLibraryClient();
			await client.search('test', { limit: 5, languages: ['chinese'] });

			const call = mockRequest.mock.calls[0][0];
			expect(call.body).toContain('limit=5');
			expect(call.body).toContain('languages[]=chinese');
		});
	});

	describe('getDownloadLink', () => {
		it('返回下载链接信息', async () => {
			mockRequest.mockResolvedValueOnce(mockResponse({
				file: {
					downloadLink: 'https://user-domain.z-lib.org/dl/xxx',
					description: '测试书籍',
					extension: 'epub',
				},
			}));

			const client = new ZLibraryClient();
			const info = await client.getDownloadLink(123, 'abc');

			expect(info.downloadLink).toContain('z-lib.org');
			expect(info.extension).toBe('epub');
		});
	});

	describe('downloadBook', () => {
		it('返回二进制数据和扩展名', async () => {
			// getDownloadLink 调用
			mockRequest.mockResolvedValueOnce(mockResponse({
				file: {
					downloadLink: 'https://user-domain.z-lib.org/dl/xxx',
					extension: 'epub',
				},
			}));
			// 文件下载调用
			const fakeEpub = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
			mockRequest.mockResolvedValueOnce(mockBinaryResponse(fakeEpub));

			const client = new ZLibraryClient();
			const result = await client.downloadBook(123, 'abc');

			expect(result.extension).toBe('epub');
			expect(result.data.byteLength).toBe(4);
			expect(new Uint8Array(result.data)[0]).toBe(0x50);
		});

		it('下载空文件时抛出异常', async () => {
			mockRequest.mockResolvedValueOnce(mockResponse({
				file: { downloadLink: 'https://z-lib.org/dl/empty', extension: 'pdf' },
			}));
			mockRequest.mockResolvedValueOnce(mockResponse({}, 200));

			const client = new ZLibraryClient();
			await expect(client.downloadBook(123, 'abc')).rejects.toThrow('下载文件为空');
		});
	});

	describe('retry', () => {
		it('网络错误时重试最多 3 次后抛出异常', async () => {
			vi.useFakeTimers();
			mockRequest.mockRejectedValue(new Error('network error'));

			const client = new ZLibraryClient();
			const promise = client.search('test');
			promise.catch(() => {});
			await vi.runAllTimersAsync();
			await expect(promise).rejects.toThrow('请求失败');

			expect(mockRequest).toHaveBeenCalledTimes(4);
			vi.useRealTimers();
		});

		it('重试成功后返回结果', async () => {
			vi.useFakeTimers();
			mockRequest
				.mockRejectedValueOnce(new Error('timeout'))
				.mockResolvedValueOnce(mockResponse({
					success: 1, books: [], exactBooksCount: 0, pagination: [],
				}));

			const client = new ZLibraryClient();
			const promise = client.search('test');
			await vi.runAllTimersAsync();
			const result = await promise;

			expect(result.books).toHaveLength(0);
			expect(mockRequest).toHaveBeenCalledTimes(2);
			vi.useRealTimers();
		});

		it('业务错误不重试（RATE_LIMITED）', async () => {
			mockRequest.mockResolvedValueOnce(mockResponse({ errcode: 'RATE_LIMITED' }, 429));

			const client = new ZLibraryClient();
			await expect(client.search('test')).rejects.toThrow('下载限额已用完');

			expect(mockRequest).toHaveBeenCalledTimes(1);
		});
	});

	describe('discoverDomain', () => {
		it('返回第一个可用域名', async () => {
			mockRequest.mockResolvedValueOnce(mockResponse({
				domains: ['z-library.sk', 'singlelogin.re'],
			}));

			const client = new ZLibraryClient();
			const domain = await client.discoverDomain();

			expect(domain).toBe('z-library.sk');
		});

		it('所有域名不可用时返回默认域名', async () => {
			mockRequest.mockRejectedValue(new Error('network error'));

			const client = new ZLibraryClient();
			const domain = await client.discoverDomain();

			expect(domain).toBe('z-library.sk');
		});
	});

	describe('getProfile', () => {
		it('返回用户信息和下载限额', async () => {
			mockRequest.mockResolvedValueOnce(mockResponse({
				user: {
					id: 23688146,
					email: 'test@example.com',
					downloads_limit: 10,
					downloads_today: 2,
					isPremium: false,
				},
			}));

			const client = new ZLibraryClient();
			const profile = await client.getProfile();

			expect(profile.userId).toBe(23688146);
			expect(profile.downloadsTodayLeft).toBe(8);
		});
	});
});
