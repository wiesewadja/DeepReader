import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetchWithCorsFallback
const mockFetch = vi.fn();
vi.mock('../../../utils/safe-request.js', () => ({
	fetchWithCorsFallback: (...args: any[]) => mockFetch(...args),
}));

describe('TTSClient', () => {
	let client: any;
	const mockApiKey = 'test-mimo-key';

	beforeEach(async () => {
		mockFetch.mockReset();
		const { TTSClient } = await import('../tts-client');
		client = new TTSClient({
			apiKey: mockApiKey,
			baseUrl: 'https://api.xiaomimimo.com/v1',
		});
	});

	it('应该正确构造请求', async () => {
		const mockAudio = new ArrayBuffer(8);
		mockFetch.mockResolvedValueOnce({
			ok: true,
			arrayBuffer: () => Promise.resolve(mockAudio),
		});

		await client.synthesize('你好');

		expect(mockFetch).toHaveBeenCalledWith(
			'https://api.xiaomimimo.com/v1/chat/completions',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({
					'Authorization': `Bearer ${mockApiKey}`,
					'Content-Type': 'application/json',
				}),
			})
		);

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.model).toBe('mimo-v2-tts');
		expect(body.messages[0].content).toBe('你好');
		expect(body.voice).toBe('default_zh');
	});

	it('应该支持自定义 voice', async () => {
		const mockAudio = new ArrayBuffer(8);
		mockFetch.mockResolvedValueOnce({
			ok: true,
			arrayBuffer: () => Promise.resolve(mockAudio),
		});

		await client.synthesize('hello', { voice: 'default_en' });

		const body = JSON.parse(mockFetch.mock.calls[0][1].body);
		expect(body.voice).toBe('default_en');
	});

	it('应该在 API 错误时抛出异常', async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			text: () => Promise.resolve('Invalid API key'),
		});

		await expect(client.synthesize('test')).rejects.toThrow('TTS API error: 401');
	});
});
