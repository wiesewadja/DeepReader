import type { TTSOptions } from './tts-client.js';
import { serviceLog } from '../../utils/logger.js';

export interface MiniMaxVoiceSetting {
    voice_id: string;
    speed?: number;
    vol?: number;
    pitch?: number;
    emotion?: string;
}

export interface MiniMaxAudioSetting {
    format: 'mp3' | 'pcm' | 'flac' | 'wav' | 'pcmu_raw' | 'pcmu_wav' | 'opus';
    sample_rate?: number;
    bitrate?: number;
    channel?: 1 | 2;
}

export interface MiniMaxTTSRequest {
    model: string;
    text: string;
    stream: boolean;
    voice_setting: MiniMaxVoiceSetting;
    audio_setting: MiniMaxAudioSetting;
    subtitle_enable?: boolean;
}

export class MiniMaxTTSClient {
    #apiKey: string;
    private baseUrl: string;
    private model: string;

    constructor(options: { apiKey: string; baseUrl: string; model?: string }) {
        this.#apiKey = options.apiKey;
        this.baseUrl = options.baseUrl;
        this.model = options.model || 'speech-02-hd';
    }

    async synthesize(text: string, options: TTSOptions): Promise<ArrayBuffer> {
        const url = `${this.baseUrl}/t2a_v2`;

        const body: MiniMaxTTSRequest = {
            model: this.model,
            text,
            stream: false,
            voice_setting: {
                voice_id: options.voiceProfile.voice || 'female-tianmei',
                speed: 1.0,
                vol: 1.0,
                pitch: 0,
            },
            audio_setting: {
                format: 'wav',
                sample_rate: 24000,
                channel: 1,
            },
        };

        const response = await fetch(url, {
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
            try {
                const parsed = JSON.parse(errText);
                detail = parsed.base_resp?.status_msg || parsed.error?.message || errText;
            } catch {}
            serviceLog.error('[MiniMaxTTS] API 请求失败:', {
                url,
                status: response.status,
                responseBody: detail,
            });
            throw new Error(`MiniMax TTS error: ${response.status} — ${detail}`);
        }

        const json = await response.json();
        const baseResp = json?.base_resp || {};
        if (baseResp.status_code && baseResp.status_code !== 0) {
            throw new Error(`MiniMax TTS error: ${baseResp.status_code} — ${baseResp.status_msg || '未知错误'}`);
        }
        const hexData: string | undefined = json?.data?.audio || json?.audio;
        if (!hexData || typeof hexData !== 'string') {
            throw new Error('MiniMax TTS: 响应中无音频数据');
        }
        return hexToArrayBuffer(hexData);
    }

    async *synthesizeStream(text: string, options: TTSOptions): AsyncGenerator<ArrayBuffer> {
        const url = `${this.baseUrl}/t2a_v2`;

        const body: MiniMaxTTSRequest = {
            model: this.model,
            text,
            stream: true,
            voice_setting: {
                voice_id: options.voiceProfile.voice || 'female-tianmei',
                speed: 1.0,
                vol: 1.0,
                pitch: 0,
            },
            audio_setting: {
                format: 'pcm',
                sample_rate: 24000,
                channel: 1,
            },
        };

        const response = await fetch(url, {
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
            try {
                const parsed = JSON.parse(errText);
                detail = parsed.base_resp?.status_msg || parsed.error?.message || errText;
            } catch {}
            serviceLog.error('[MiniMaxTTS] Streaming API 请求失败:', {
                url,
                status: response.status,
                responseBody: detail,
            });
            throw new Error(`MiniMax TTS streaming error: ${response.status} — ${detail}`);
        }

        if (!response.body) {
            throw new Error('MiniMax TTS streaming: response body is null');
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
                        const hexData: string | undefined = json?.data?.audio || json?.audio;
                        if (hexData && typeof hexData === 'string') {
                            yield hexToArrayBuffer(hexData);
                        }
                    } catch {}
                }
            }
        } finally {
            reader.cancel().catch(() => {});
        }
    }
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
    const clean = hex.replace(/\s/g, '');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
        bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
    }
    return bytes.buffer;
}
