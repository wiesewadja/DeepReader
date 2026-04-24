import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('TTSClient', () => {
	let client: any;
	const mockApiKey = 'test-mimo-key';

	beforeEach(async () => {
		vi.restoreAllMocks();
		vi.resetModules();

		// Mock fetchWithCorsFallback to return ArrayBuffer
		vi.stubGlobal('fetch', vi.fn());

		const { TTSClient } = await import('../tts-client');
		client = new TTSClient({
			apiKey: mockApiKey,
			baseUrl: 'https://api.xiaomimimo.com/v1',
		});
	});

	it('应该直接返回 ArrayBuffer 音频数据', async () => {
		// 创建一个简单的 WAV ArrayBuffer
		const mockAudioBuffer = new ArrayBuffer(100);
		const view = new Uint8Array(mockAudioBuffer);
		// 写入 RIFF 头
		view[0] = 0x52; // R
		view[1] = 0x49; // I
		view[2] = 0x46; // F
		view[3] = 0x46; // F

		(global.fetch as any).mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(mockAudioBuffer),
		});

		const result = await client.synthesize('你好');
		expect(result).toBeInstanceOf(ArrayBuffer);
		expect(result.byteLength).toBe(100);
	});

	it('应该支持自定义 voice', async () => {
		const mockAudioBuffer = new ArrayBuffer(100);
		(global.fetch as any).mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(mockAudioBuffer),
		});

		await client.synthesize('hello', { voice: 'default_en' });

		const callArgs = (global.fetch as any).mock.calls[0][1];
		const body = JSON.parse(callArgs.body);
		expect(body.audio.voice).toBe('default_en');
		expect(body.model).toBe('mimo-v2-tts');
	});

	it('应该在 API 错误时抛出包含详情的异常', async () => {
		(global.fetch as any).mockResolvedValue({
			ok: false,
			status: 400,
			text: () => Promise.resolve('{"error":{"message":"Invalid voice parameter"}}'),
		});

		await expect(client.synthesize('test')).rejects.toThrow('TTS API error: 400 — Invalid voice parameter');
	});

	it('应该使用默认 voice (default_zh)', async () => {
		const mockAudioBuffer = new ArrayBuffer(100);
		(global.fetch as any).mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(mockAudioBuffer),
		});

		await client.synthesize('测试');

		const callArgs = (global.fetch as any).mock.calls[0][1];
		const body = JSON.parse(callArgs.body);
		expect(body.audio.voice).toBe('default_zh');
	});

	it('应该使用 user message 传递风格指令', async () => {
		const mockAudioBuffer = new ArrayBuffer(100);
		(global.fetch as any).mockResolvedValue({
			ok: true,
			arrayBuffer: () => Promise.resolve(mockAudioBuffer),
		});

		await client.synthesize('测试内容');

		const callArgs = (global.fetch as any).mock.calls[0][1];
		const body = JSON.parse(callArgs.body);
		expect(body.messages).toHaveLength(2);
		expect(body.messages[0].role).toBe('user');
		expect(body.messages[0].content).toContain('奚童');
		expect(body.messages[1].role).toBe('assistant');
		expect(body.messages[1].content).toBe('测试内容');
	});
});
