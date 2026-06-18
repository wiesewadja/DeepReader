import { serviceLog } from '../../utils/logger.js';
import { fetchWithCorsFallback } from '../../utils/safe-request.js';

export interface TTSClientOptions {
    apiKey: string;
    baseUrl: string;
    model?: string;
}

export interface TTSVoiceOptions {
    /** 音色 ID（冰糖/茉莉/苏打/白桦/mimo_default） */
    voice: string;
}

export interface TTSOptions {
    voiceProfile: TTSVoiceOptions;
    /** 导演模式提示词（放入 role:user），格式：角色/场景/指导 */
    styleText?: string;
}

export interface ITTSSynthesizer {
    synthesize(text: string, options: TTSOptions): Promise<ArrayBuffer>;
    synthesizeStream(text: string, options: TTSOptions, signal?: AbortSignal): AsyncGenerator<ArrayBuffer>;
}

export class TTSClient implements ITTSSynthesizer {
    #apiKey: string;
    private baseUrl: string;
    private model: string;

    constructor(options: TTSClientOptions) {
        this.#apiKey = options.apiKey;
        this.baseUrl = options.baseUrl;
        this.model = options.model || 'mimo-v2.5-tts';
    }

    async synthesize(text: string, options: TTSOptions): Promise<ArrayBuffer> {
        const url = `${this.baseUrl}/chat/completions`;

        const isVoiceDesign = this.model.includes('voicedesign');
        const audioConfig: any = { format: 'wav' };
        if (!isVoiceDesign) {
            audioConfig.voice = options.voiceProfile.voice;
        }

        const body: any = {
            model: this.model,
            messages: [
                ...(options.styleText ? [{ role: 'user' as const, content: options.styleText }] : []),
                { role: 'assistant' as const, content: text },
            ],
            audio: audioConfig,
        };

        const response = await fetchWithCorsFallback(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.#apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errText = await response.text();
            let detail = errText;
            let parsed: any;
            try { parsed = JSON.parse(errText); detail = parsed.error?.message || errText; } catch {}
            serviceLog.error('[TTS] API 请求失败:', {
                url,
                status: response.status,
                requestBody: { model: this.model, messages: body.messages, audio: body.audio },
                responseBody: parsed || errText,
            });
            throw new Error(`TTS API error: ${response.status} — ${detail}`);
        }

        const json = await response.json();
        const audioB64 = json?.choices?.[0]?.message?.audio?.data;
        if (!audioB64) {
            throw new Error('TTS API: 响应中无音频数据');
        }

        return base64ToArrayBuffer(audioB64);
    }

    async *synthesizeStream(text: string, options: TTSOptions, signal?: AbortSignal): AsyncGenerator<ArrayBuffer> {
        const url = `${this.baseUrl}/chat/completions`;

        const isVoiceDesign = this.model.includes('voicedesign');
        const audioConfig: any = { format: 'pcm16' };
        if (!isVoiceDesign) {
            audioConfig.voice = options.voiceProfile.voice;
        }

        const body: any = {
            model: this.model,
            messages: [
                ...(options.styleText ? [{ role: 'user' as const, content: options.styleText }] : []),
                { role: 'assistant' as const, content: text },
            ],
            audio: audioConfig,
            stream: true,
        };

        const response = await fetchWithCorsFallback(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.#apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            const errText = await response.text();
            let detail = errText;
            let parsed: any;
            try { parsed = JSON.parse(errText); detail = parsed.error?.message || errText; } catch {}
            serviceLog.error('[TTS] Streaming API 请求失败:', {
                url,
                status: response.status,
                requestBody: { model: this.model, messages: body.messages, audio: body.audio, stream: true },
                responseBody: parsed || errText,
            });
            throw new Error(`TTS streaming error: ${response.status} — ${detail}`);
        }

        if (!response.body) {
            throw new Error('TTS streaming: response body is null');
        }

        yield* this.readStream(response.body);
    }

    private async *readStream(body: ReadableStream<Uint8Array>): AsyncGenerator<ArrayBuffer> {
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
                        const audioB64 = json?.choices?.[0]?.delta?.audio?.data;
                        if (audioB64) {
                            yield base64ToArrayBuffer(audioB64);
                        }
                    } catch {}
                }
            }
        } finally {
            reader.cancel().catch(() => {});
        }
    }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
