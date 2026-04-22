import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('TTSClient', () => {
	let client: any;
	const mockApiKey = 'test-mimo-key';

	beforeEach(async () => {
		vi.restoreAllMocks();
		vi.resetModules();

		// Mock fetch to return JSON with base64 audio
		vi.stubGlobal('fetch', vi.fn());

		const { TTSClient } = await import('../tts-client');
		client = new TTSClient({
			apiKey: mockApiKey,
			baseUrl: 'https://api.xiaomimimo.com/v1',
		});
	});

	it('应该从 JSON 响应中提取 base64 音频', async () => {
		// "UklGRiQqEg==" is RIFF WAV header base64
		const mockAudioB64 = 'UklGRiQqEgBXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQAqEg==';
		(global.fetch as any).mockResolvedValue({
			ok: true,
			headers: { get: () => 'application/json' },
			json: () => Promise.resolve({
				choices: [{ message: { audio: { data: mockAudioB64 } } }],
			}),
		});

		const result = await client.synthesize('你好');
		expect(result).toBeInstanceOf(ArrayBuffer);
		expect(result.byteLength).toBeGreaterThan(0);
		// Verify RIFF header
		const view = new Uint8Array(result);
		expect(String.fromCharCode(view[0], view[1], view[2], view[3])).toBe('RIFF');
	});

	it('应该支持自定义 voice', async () => {
		const mockAudioB64 = 'UklGRiQqEgBXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQAqEg==';
		(global.fetch as any).mockResolvedValue({
			ok: true,
			headers: { get: () => 'application/json' },
			json: () => Promise.resolve({
				choices: [{ message: { audio: { data: mockAudioB64 } } }],
			}),
		});

		await client.synthesize('hello', { voice: 'default_en' });

		const callArgs = (global.fetch as any).mock.calls[0][1];
		const body = JSON.parse(callArgs.body);
		expect(body.voice).toBe('default_en');
	});

	it('应该在 API 错误时抛出包含详情的异常', async () => {
		(global.fetch as any).mockResolvedValue({
			ok: false,
			status: 400,
			text: () => Promise.resolve('{"error":{"message":"Invalid voice parameter"}}'),
		});

		await expect(client.synthesize('test')).rejects.toThrow('TTS API error: 400 — Invalid voice parameter');
	});

	it('应该在 JSON 响应无音频数据时报错', async () => {
		(global.fetch as any).mockResolvedValue({
			ok: true,
			headers: { get: () => 'application/json' },
			json: () => Promise.resolve({ choices: [{ message: { content: 'no audio' } }] }),
		});

		await expect(client.synthesize('test')).rejects.toThrow('no audio data');
	});
});
