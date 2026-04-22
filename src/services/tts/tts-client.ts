import { fetchWithCorsFallback } from '../../utils/safe-request.js';

export interface TTSClientOptions {
    apiKey: string;
    baseUrl: string;
}

export interface TTSOptions {
    voice?: 'mimo_default' | 'default_zh' | 'default_en';
}

const DEFAULT_VOICE = 'default_zh';
const TTS_MODEL = 'mimo-v2-tts';

export class TTSClient {
    #apiKey: string;
    private baseUrl: string;

    constructor(options: TTSClientOptions) {
        this.#apiKey = options.apiKey;
        this.baseUrl = options.baseUrl;
    }

    async synthesize(text: string, options?: TTSOptions): Promise<ArrayBuffer> {
        const url = `${this.baseUrl}/chat/completions`;
        const voice = options?.voice || DEFAULT_VOICE;

        const response = await fetchWithCorsFallback(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.#apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: TTS_MODEL,
                messages: [{ role: 'user', content: text }],
                voice,
            }),
        });

        if (!response.ok) {
            throw new Error(`TTS API error: ${response.status} ${response.statusText}`);
        }

        return response.arrayBuffer();
    }
}
