import { fetchWithCorsFallback } from '../../utils/safe-request.js';

export interface TTSClientOptions {
    apiKey: string;
    baseUrl: string;
    model?: string;
}

export interface TTSOptions {
    voice?: 'mimo_default' | 'default_zh' | 'default_en';
}

const DEFAULT_VOICE = 'default_zh';
const TTS_MODEL = 'mimo-v2-tts';

/**
 * 奚童角色语音风格提示词
 *
 * 根据 MiMo-V2-TTS 文档：
 * - user message 用于传递风格指令（可选但推荐）
 * - assistant message 放置要合成的文本
 * - 使用 <style> 标签控制整体风格
 */
const XITONG_STYLE_PROMPT = `你是奚童，一位活泼知性的年轻女孩，用户的伴读书童。你的声音清澈明亮，带着自然的亲和力和书卷气。

语音风格要求：
- 语速偏快但不急促，吐字清晰，有一种"刚读完好书迫不及待想分享"的活力感
- 偶尔会轻笑，偶尔会感叹，但整体给人的感觉是温暖、真诚、值得信赖的读书伙伴
- 发现有趣观点时，语速稍快，语气兴奋，像在分享一个惊喜
- 分析深层含义时，节奏放慢，声音沉稳，像在认真思考
- 鼓励用户阅读时，声音温暖轻柔，像在给朋友打气
- 讨论严肃话题时，端庄但亲和，不失活力`;

export class TTSClient {
    #apiKey: string;
    private baseUrl: string;
    private model: string;

    constructor(options: TTSClientOptions) {
        this.#apiKey = options.apiKey;
        this.baseUrl = options.baseUrl;
        this.model = options.model || TTS_MODEL;
    }

    async synthesize(text: string, options?: TTSOptions): Promise<ArrayBuffer> {
        const url = `${this.baseUrl}/chat/completions`;
        const voice = options?.voice || DEFAULT_VOICE;

        // 根据 MiMo-V2-TTS 文档：
        // - user message 传递风格指令
        // - assistant message 放置要合成的文本
        const response = await fetchWithCorsFallback(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.#apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    { role: 'user', content: XITONG_STYLE_PROMPT },
                    { role: 'assistant', content: text },
                ],
                audio: {
                    format: 'wav',
                    voice,
                },
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            let detail = errText;
            try { detail = JSON.parse(errText).error?.message || errText; } catch {}
            throw new Error(`TTS API error: ${response.status} — ${detail}`);
        }

        return response.arrayBuffer();
    }

    /**
     * 流式合成语音（边生成边播放）
     * 根据 MiMo-V2-TTS 文档，流式输出使用 pcm16 格式
     */
    async *synthesizeStream(text: string, options?: TTSOptions): AsyncGenerator<ArrayBuffer> {
        const url = `${this.baseUrl}/chat/completions`;
        const voice = options?.voice || DEFAULT_VOICE;

        const response = await fetchWithCorsFallback(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.#apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    { role: 'user', content: XITONG_STYLE_PROMPT },
                    { role: 'assistant', content: text },
                ],
                audio: {
                    format: 'pcm16',
                    voice,
                },
                stream: true,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            let detail = errText;
            try { detail = JSON.parse(errText).error?.message || errText; } catch {}
            throw new Error(`TTS streaming error: ${response.status} — ${detail}`);
        }

        if (!response.body) {
            throw new Error('TTS streaming: response body is null');
        }

        const reader = response.body.getReader();
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
