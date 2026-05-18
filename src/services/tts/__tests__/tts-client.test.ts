import { describe, it, expect, vi, beforeEach } from 'vitest';
import { base64Encode } from './test-utils.js';

// V2.5 API 返回 JSON，包含 base64 音频数据
function mockV25Response() {
	const audioBase64 = btoa('fake-audio-data');
	return {
		ok: true,
		json: () => Promise.resolve({
			choices: [{ message: { audio: { data: audioBase64 } } }],
		}),
	};
}

describe('TTSClient', () => {
	let client: any;
	const mockApiKey = 'test-mimo-key';

	beforeEach(async () => {
		vi.restoreAllMocks();
		vi.resetModules();

		vi.stubGlobal('fetch', vi.fn());

		const { TTSClient } = await import('../tts-client');
		client = new TTSClient({
			apiKey: mockApiKey,
			baseUrl: 'https://api.xiaomimimo.com/v1',
		});
	});

	it('应该使用 mimo-v2.5-tts 模型', async () => {
		(global.fetch as any).mockResolvedValue(mockV25Response());

		await client.synthesize('你好', {
			voiceProfile: { voice: '冰糖' },
		});

		const callArgs = (global.fetch as any).mock.calls[0][1];
		const body = JSON.parse(callArgs.body);
		expect(body.model).toBe('mimo-v2.5-tts');
	});

	it('应该将 voiceProfile 中的音色传给 API', async () => {
		(global.fetch as any).mockResolvedValue(mockV25Response());

		await client.synthesize('hello', {
			voiceProfile: { voice: '茉莉' },
		});

		const callArgs = (global.fetch as any).mock.calls[0][1];
		const body = JSON.parse(callArgs.body);
		expect(body.audio.voice).toBe('茉莉');
	});

	it('应该将 styleText 作为 user message 传递', async () => {
		(global.fetch as any).mockResolvedValue(mockV25Response());

		await client.synthesize('测试内容', {
			voiceProfile: { voice: '冰糖' },
			styleText: '你是奚童，温暖知性的伴读书童。',
		});

		const callArgs = (global.fetch as any).mock.calls[0][1];
		const body = JSON.parse(callArgs.body);
		expect(body.messages[0]).toEqual({ role: 'user', content: '你是奚童，温暖知性的伴读书童。' });
		expect(body.messages[1]).toEqual({ role: 'assistant', content: '测试内容' });
	});

	it('没有 styleText 时只发 assistant message', async () => {
		(global.fetch as any).mockResolvedValue(mockV25Response());

		await client.synthesize('测试内容', {
			voiceProfile: { voice: '冰糖' },
		});

		const callArgs = (global.fetch as any).mock.calls[0][1];
		const body = JSON.parse(callArgs.body);
		expect(body.messages).toHaveLength(1);
		expect(body.messages[0].role).toBe('assistant');
		expect(body.messages[0].content).toBe('测试内容');
	});

	it('应该从 JSON 响应中解析 base64 音频数据', async () => {
		const fakeBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // RIFF
		const audioBase64 = btoa(String.fromCharCode(...fakeBytes));
		(global.fetch as any).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({
				choices: [{ message: { audio: { data: audioBase64 } } }],
			}),
		});

		const result = await client.synthesize('你好', {
			voiceProfile: { voice: '冰糖' },
		});
		expect(result).toBeInstanceOf(ArrayBuffer);
	});

	it('应该在 API 错误时抛出包含详情的异常', async () => {
		(global.fetch as any).mockResolvedValue({
			ok: false,
			status: 400,
			text: () => Promise.resolve('{"error":{"message":"Invalid voice parameter"}}'),
		});

		await expect(client.synthesize('test', {
			voiceProfile: { voice: '冰糖' },
		})).rejects.toThrow('TTS API error: 400 — Invalid voice parameter');
	});
});
