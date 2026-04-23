export interface TTSClientOptions {
    apiKey: string;
    baseUrl: string;
    model?: string;
}

export interface TTSOptions {
    voice?: string;
}

/**
 * 奚童角色导演模式描述（MiMo V2.5 Director Mode）
 *
 * 三个维度：Character（角色）、Scene（场景）、Guidance（指导）
 * 放在 user message 中，控制语音的音色、情感和节奏
 */
const XITONG_DIRECTOR_PROMPT = `[Character]
你是奚童，一位年轻女性，用户的伴读书童。你故意用低沉的男性化声音说话，带着一种俏皮的模仿感。
你用刻意压低的嗓音说话，但偶尔会不小心露出本来的清亮声线，这种反差显得很可爱。
语速平缓不急促，吐字清晰，有一种"故意装成熟但藏不住活力"的感觉。

[Scene]
你正在和一位朋友面对面聊天，分享你读书后的感想和心得。
氛围轻松愉快，像在一个安静的午后，两个人坐在书架旁喝茶聊书。

[Guidance]
- 发现有趣观点时，语速稍快，语气兴奋，像在分享一个惊喜，偶尔会忍不住露出本来的女声
- 分析深层含义时，刻意压低声音装深沉，但偶尔会轻笑破功
- 鼓励用户阅读时，故意用低沉温柔的"大叔音"，但听起来反而很可爱
- 讨论严肃话题时，努力维持男性化声线，但激动时会恢复原本声音
- 句间自然停顿，不要抢读，给人消化信息的时间`;

const DEFAULT_VOICE = '茉莉';
const TTS_MODEL = 'mimo-v2.5-tts';

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

        const reqBody = JSON.stringify({
            model: this.model,
            messages: [
                { role: 'user', content: XITONG_DIRECTOR_PROMPT },
                { role: 'assistant', content: text },
            ],
            audio: {
                format: 'wav',
                voice,
            },
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

    async *synthesizeStream(text: string, options?: TTSOptions): AsyncGenerator<ArrayBuffer> {
        const url = `${this.baseUrl}/chat/completions`;
        const voice = options?.voice || DEFAULT_VOICE;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.#apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                stream: true,
                messages: [
                    { role: 'user', content: XITONG_DIRECTOR_PROMPT },
                    { role: 'assistant', content: text },
                ],
                audio: {
                    format: 'pcm16',
                    voice,
                },
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            let detail = errText;
            try { detail = JSON.parse(errText).error?.message || errText; } catch {}
            throw new Error(`TTS streaming error: ${response.status} — ${detail}`);
        }

        if (!response.body) {
            throw new Error('TTS streaming: response body is null (ReadableStream not supported)');
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

    /**
     * 分段并行合成：将长文本按句切分，并发调用 synthesize，拼接 WAV PCM
     */
    async synthesizeParallel(text: string, options?: TTSOptions, concurrency = 3): Promise<ArrayBuffer> {
        const segments = splitTextToSegments(text);
        if (segments.length <= 1) {
            return this.synthesize(text, options);
        }

        const results: ArrayBuffer[] = [];
        let index = 0;

        const worker = async (): Promise<void> => {
            while (index < segments.length) {
                const i = index++;
                results[i] = await this.synthesize(segments[i], options);
            }
        };

        const workers = Array.from({ length: Math.min(concurrency, segments.length) }, () => worker());
        await Promise.all(workers);

        return concatWavBuffers(results);
    }
}

const SEGMENT_RE = /[^。！？!?.]+[。！？!?.]?/g;
const MAX_SEGMENT_CHARS = 300;

function splitTextToSegments(text: string): string[] {
    const raw = text.match(SEGMENT_RE);
    if (!raw) return [text];

    const segments: string[] = [];
    let buffer = '';
    for (const s of raw) {
        buffer += s;
        if (buffer.length >= MAX_SEGMENT_CHARS) {
            segments.push(buffer);
            buffer = '';
        }
    }
    if (buffer.trim()) segments.push(buffer);
    return segments.length > 0 ? segments : [text];
}

function concatWavBuffers(wavs: ArrayBuffer[]): ArrayBuffer {
    if (wavs.length === 0) return new ArrayBuffer(0);
    if (wavs.length === 1) return wavs[0];

    // 所有 WAV 共享相同参数（24000Hz, 16bit, mono），拼接 PCM 数据
    let totalPcmLen = 0;
    const pcmSlices: Uint8Array[] = [];
    for (const wav of wavs) {
        const pcm = new Uint8Array(wav, 44); // skip WAV header
        pcmSlices.push(pcm);
        totalPcmLen += pcm.length;
    }

    // 复用第一个 WAV 的 header，更新长度字段
    const header = new Uint8Array(wavs[0], 0, 44);
    const combined = new ArrayBuffer(44 + totalPcmLen);
    const view = new DataView(combined);

    // 复制 header
    new Uint8Array(combined).set(header);

    // 更新 RIFF chunk size (offset 4): 36 + pcmDataLength
    view.setUint32(4, 36 + totalPcmLen, true);
    // 更新 data chunk size (offset 40): pcmDataLength
    view.setUint32(40, totalPcmLen, true);

    // 拼接 PCM 数据
    let offset = 44;
    for (const pcm of pcmSlices) {
        new Uint8Array(combined, offset).set(pcm);
        offset += pcm.length;
    }

    return combined;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
