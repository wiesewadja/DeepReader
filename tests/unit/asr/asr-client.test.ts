import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock safe-request before importing ASR client
vi.mock('@/utils/safe-request', () => ({
	fetchWithCorsFallback: vi.fn(),
}));

import { ASRClient, type ASRClientOptions, type ASROptions } from '@/services/asr/asr-client';
import { fetchWithCorsFallback } from '@/utils/safe-request';

const mockFetch = fetchWithCorsFallback as ReturnType<typeof vi.fn>;

function makeClient(overrides?: Partial<ASRClientOptions>): ASRClient {
	return new ASRClient({
		apiKey: 'test-key',
		baseUrl: 'https://api.xiaomimimo.com/v1',
		model: 'mimo-v2.5-asr',
		...overrides,
	});
}

const SAMPLE_AUDIO_B64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const MIME_WAV = 'audio/wav';

describe('ASRClient', () => {
	beforeEach(() => {
		mockFetch.mockReset();
	});

	describe('transcribe (non-streaming)', () => {
		it('sends correct request format and returns transcribed text', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: '这段话的主要观点是什么？' } }],
				}),
			});

			const client = makeClient();
			const result = await client.transcribe(SAMPLE_AUDIO_B64, MIME_WAV, {
				language: 'zh',
			});

			expect(result).toBe('这段话的主要观点是什么？');

			// Verify request format
			expect(mockFetch).toHaveBeenCalledTimes(1);
			const [url, init] = mockFetch.mock.calls[0];
			expect(url).toBe('https://api.xiaomimimo.com/v1/chat/completions');
			expect(init.method).toBe('POST');

			const body = JSON.parse(init.body as string);
			expect(body.model).toBe('mimo-v2.5-asr');
			expect(body.stream).toBeUndefined();
			expect(body.messages).toHaveLength(1);
			expect(body.messages[0].role).toBe('user');
			expect(body.messages[0].content[0].type).toBe('input_audio');
			expect(body.messages[0].content[0].input_audio.data).toBe(
				`data:${MIME_WAV};base64,${SAMPLE_AUDIO_B64}`,
			);
			expect(body.asr_options.language).toBe('zh');
		});

		it('defaults to auto language when not specified', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: 'Hello world' } }],
				}),
			});

			const client = makeClient();
			await client.transcribe(SAMPLE_AUDIO_B64, MIME_WAV);

			const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
			expect(body.asr_options.language).toBe('auto');
		});

		it('sends api-key header', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: 'test' } }],
				}),
			});

			const client = makeClient({ apiKey: 'my-secret-key' });
			await client.transcribe(SAMPLE_AUDIO_B64, MIME_WAV);

			const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
			expect(headers['api-key']).toBe('my-secret-key');
		});

		it('throws on API error with status and message', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 401,
				text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }),
			});

			const client = makeClient();
			await expect(
				client.transcribe(SAMPLE_AUDIO_B64, MIME_WAV),
			).rejects.toThrow('ASR API error: 401');
		});

		it('throws when response has no content', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					choices: [{ message: {} }],
				}),
			});

			const client = makeClient();
			await expect(
				client.transcribe(SAMPLE_AUDIO_B64, MIME_WAV),
			).rejects.toThrow('无识别结果');
		});
	});

	describe('transcribeStream (streaming)', () => {
		it('yields text deltas from SSE stream', async () => {
			const chunks = [
				'data: {"choices":[{"delta":{"content":"这段"}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"话的"}}]}\n\n',
				'data: {"choices":[{"delta":{"content":"主要观点"}}]}\n\n',
				'data: [DONE]\n\n',
			];

			const stream = new ReadableStream({
				start(controller) {
					for (const chunk of chunks) {
						controller.enqueue(new TextEncoder().encode(chunk));
					}
					controller.close();
				},
			});

			mockFetch.mockResolvedValueOnce({
				ok: true,
				body: stream,
			});

			const client = makeClient();
			const texts: string[] = [];
			for await (const text of client.transcribeStream(SAMPLE_AUDIO_B64, MIME_WAV)) {
				texts.push(text);
			}

			expect(texts).toEqual(['这段', '话的', '主要观点']);

			// Verify stream: true in request
			const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
			expect(body.stream).toBe(true);
		});

		it('handles empty stream gracefully', async () => {
			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
					controller.close();
				},
			});

			mockFetch.mockResolvedValueOnce({
				ok: true,
				body: stream,
			});

			const client = makeClient();
			const texts: string[] = [];
			for await (const text of client.transcribeStream(SAMPLE_AUDIO_B64, MIME_WAV)) {
				texts.push(text);
			}

			expect(texts).toEqual([]);
		});

		it('throws on streaming API error', async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 429,
				text: async () => JSON.stringify({ error: { message: 'Rate limited' } }),
			});

			const client = makeClient();
			await expect(
				client.transcribeStream(SAMPLE_AUDIO_B64, MIME_WAV).next(),
			).rejects.toThrow('ASR streaming error: 429');
		});
	});
});
