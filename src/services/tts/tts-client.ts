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

        const reqBody = JSON.stringify({
            model: TTS_MODEL,
            messages: [
                { role: 'user', content: '请朗读以下内容' },
                { role: 'assistant', content: text },
            ],
            voice,
        });

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.#apiKey}`,
                'Content-Type': 'application/json',
            },
            body: reqBody,
        });

        if (!response.ok) {
            const errText = await response.text();
            let detail = errText;
            try { detail = JSON.parse(errText).error?.message || errText; } catch {}
            throw new Error(`TTS API error: ${response.status} — ${detail}`);
        }

        const contentType = response.headers.get('content-type') || '';

        // Mimo TTS 返回 JSON，音频在 choices[0].message.audio.data (base64 WAV)
        if (contentType.includes('application/json')) {
            const data = await response.json();
            const audioB64 = data?.choices?.[0]?.message?.audio?.data;
            if (!audioB64) {
                throw new Error('TTS API: no audio data in response');
            }
            return base64ToArrayBuffer(audioB64);
        }

        // 直接返回二进制音频（如果 API 返回原始音频）
        return await response.arrayBuffer();
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
