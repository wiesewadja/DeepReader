import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TTSClient } from '@/services/tts/tts-client.js';

describe('TTSClient — VoiceDesign 模式', () => {
	const mockResponse = {
		ok: true,
		json: async () => ({
			choices: [{ message: { audio: { data: 'dGVzdA==' } } }],
		}),
	};

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('预置音色模式：audio 包含 voice 字段', async () => {
		const captured = captureRequestBody('mimo-v2.5-tts', mockResponse);
		const client = new TTSClient({ apiKey: 'test', baseUrl: 'https://api.test.com/v1', model: 'mimo-v2.5-tts' });
		await client.synthesize('你好', { voiceProfile: { voice: '冰糖' } });

		const body = await captured;
		expect(body.audio).toHaveProperty('voice', '冰糖');
		expect(body.audio).toHaveProperty('format', 'wav');
	});

	it('VoiceDesign 模式：audio 不包含 voice 字段', async () => {
		const captured = captureRequestBody('mimo-v2.5-tts-voicedesign', mockResponse);
		const client = new TTSClient({ apiKey: 'test', baseUrl: 'https://api.test.com/v1', model: 'mimo-v2.5-tts-voicedesign' });
		await client.synthesize('你好', { voiceProfile: { voice: '' }, styleText: '温柔女声' });

		const body = await captured;
		expect(body.audio).not.toHaveProperty('voice');
		expect(body.audio).toHaveProperty('format', 'wav');
	});

	it('VoiceDesign 模式：styleText 放在 user message', async () => {
		const captured = captureRequestBody('mimo-v2.5-tts-voicedesign', mockResponse);
		const client = new TTSClient({ apiKey: 'test', baseUrl: 'https://api.test.com/v1', model: 'mimo-v2.5-tts-voicedesign' });
		await client.synthesize('你好世界', { voiceProfile: { voice: '' }, styleText: '温柔的女声' });

		const body = await captured;
		expect(body.messages[0]).toEqual({ role: 'user', content: '温柔的女声' });
		expect(body.messages[1]).toEqual({ role: 'assistant', content: '你好世界' });
	});
});

function captureRequestBody(model: string, mockResp: any): Promise<any> {
	let capturedBody: any;
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
		capturedBody = JSON.parse(init.body);
		return mockResp as any;
	});
	return new Promise((resolve) => {
		const check = setInterval(() => {
			if (capturedBody) {
				clearInterval(check);
				resolve(capturedBody);
			}
		}, 10);
	});
}
