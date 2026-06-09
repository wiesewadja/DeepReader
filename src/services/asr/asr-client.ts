import { serviceLog } from '../../utils/logger.js';
import { fetchWithCorsFallback } from '../../utils/safe-request.js';

export interface ASRClientOptions {
	apiKey: string;
	baseUrl: string;
	model?: string;
}

export interface ASROptions {
	/** 语言：auto | zh | en */
	language?: string;
}

export class ASRClient {
	#apiKey: string;
	private baseUrl: string;
	private model: string;

	constructor(options: ASRClientOptions) {
		this.#apiKey = options.apiKey;
		this.baseUrl = options.baseUrl;
		this.model = options.model || 'mimo-v2.5-asr';
	}

	async transcribe(
		audioBase64: string,
		mimeType: string,
		options?: ASROptions,
	): Promise<string> {
		const response = await this.sendRequest(audioBase64, mimeType, options, false);

		if (!response.ok) {
			throw await this.parseError(response, 'ASR API error');
		}

		const json = await response.json();
		const text = json?.choices?.[0]?.message?.content;
		if (!text) {
			throw new Error('ASR API: 无识别结果');
		}
		return text;
	}

	async *transcribeStream(
		audioBase64: string,
		mimeType: string,
		options?: ASROptions,
	): AsyncGenerator<string> {
		const response = await this.sendRequest(audioBase64, mimeType, options, true);

		if (!response.ok) {
			throw await this.parseError(response, 'ASR streaming error');
		}

		if (!response.body) {
			throw new Error('ASR streaming: response body is null');
		}

		yield* this.readStream(response.body);
	}

	private async sendRequest(
		audioBase64: string,
		mimeType: string,
		options: ASROptions | undefined,
		stream: boolean,
	): Promise<Response> {
		const url = `${this.baseUrl}/chat/completions`;

		const body: Record<string, unknown> = {
			model: this.model,
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'input_audio',
							input_audio: {
								data: `data:${mimeType};base64,${audioBase64}`,
							},
						},
					],
				},
			],
			asr_options: {
				language: options?.language || 'auto',
			},
		};
		if (stream) body.stream = true;

		return fetchWithCorsFallback(url, {
			method: 'POST',
			headers: {
				'api-key': this.#apiKey,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		});
	}

	private async parseError(response: Response, prefix: string): Promise<Error> {
		const errText = await response.text();
		let detail = errText;
		try {
			const parsed = JSON.parse(errText);
			detail = parsed.error?.message || errText;
		} catch { /* use raw text */ }
		return new Error(`${prefix}: ${response.status} — ${detail}`);
	}

	private async *readStream(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop()!;

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith('data: ')) continue;
					const payload = trimmed.slice(6).trim();
					if (payload === '[DONE]') return;

					try {
						const json = JSON.parse(payload);
						const text = json?.choices?.[0]?.delta?.content;
						if (text) {
							yield text;
						}
					} catch { /* skip malformed chunks */ }
				}
			}
		} finally {
			reader.cancel().catch(() => {});
		}
	}
}
