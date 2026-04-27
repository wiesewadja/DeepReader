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
const XITONG_STYLE_PROMPT = `你是奚童，一位活泼知性的年轻女孩，用户的伴读书童。请用自然、生动、有感染力的方式朗读下面的内容，不要机械念稿。

朗读导演指令：
1. 把文字当作"刚读到的精彩内容"分享给朋友，有热情但不夸张
2. 长句中间适度换气，逗号处轻停顿，句号处深呼吸
3. 遇到疑问句，尾音自然上扬，像真的在提问
4. 遇到感叹句，语气饱满但不喊叫，像发现惊喜时的轻声赞叹
5. 引号内的内容稍微加重，像引用别人的金句
6. 列表项之间节奏轻快，像逐个点数宝贝
7. 段落开头语气清新，像翻开新的一页
8. 整体语速中等偏快，但关键概念处放慢半拍，让用户听清
9. 严禁逐字念标点符号，用停顿和语气替代逗号句号的感觉
10. 每句话结尾不要拖沓，干脆利落，保持活力`;

/**
 * 为奚童朗读预处理文本：添加情感标记和自然停顿
 * MiMo TTS 2 对 <style> 标签和文本结构敏感，通过标记引导语气变化
 *
 * 处理策略：
 * 1. 清理格式噪音（markdown、wiki link 等已在外部处理）
 * 2. 用 <style> 标签包裹不同情感区域，给 TTS 明确的语气指令
 * 3. 长段落按语义切分，每 2-3 句加换行，模拟自然呼吸
 * 4. 引号统一为中文「」，提示 TTS 这是引用内容
 */
function prepareTextForXitong(text: string): string {
	// 1. 基础清理：统一换行、trim
	let processed = text
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	// 2. 引号统一为中文直角引号，提示 TTS 此处稍微加重
	processed = processed.replace(/"([^"]+)"/g, '「$1」');
	processed = processed.replace(/"([^"]+)"/g, '「$1」');

	// 3. 按段落处理，长段落切分为呼吸组（每 2-3 句）
	const paragraphs = processed.split('\n');
	const restructured: string[] = [];

	for (const para of paragraphs) {
		const trimmed = para.trim();
		if (!trimmed) continue;

		// 短段落直接保留
		if (trimmed.length < 60) {
			restructured.push(trimmed);
			continue;
		}

		// 长段落：按句子切分，每 2 句组成一个"呼吸组"
		const sentences = trimmed.split(/([。！？…])/);
		const groups: string[] = [];
		let currentGroup = '';
		let sentenceCount = 0;

		for (let i = 0; i < sentences.length; i++) {
			const piece = sentences[i];
			currentGroup += piece;

			// piece 是标点时，说明刚结束一个完整句子
			if (/^[。！？…]$/.test(piece)) {
				sentenceCount++;
				if (sentenceCount >= 2) {
					groups.push(currentGroup.trim());
					currentGroup = '';
					sentenceCount = 0;
				}
			}
		}

		// 剩余内容
		if (currentGroup.trim()) {
			groups.push(currentGroup.trim());
		}

		restructured.push(...groups);
	}

	// 4. 在段落/组之间加入「轻停顿」提示，让 TTS 知道这里是呼吸点
	return restructured.join('\n');
}

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

        // 奚童化预处理：添加情感标记和自然停顿
        const expressiveText = prepareTextForXitong(text);

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
                    { role: 'assistant', content: expressiveText },
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
            let parsed: any;
            try { parsed = JSON.parse(errText); detail = parsed.error?.message || errText; } catch {}
            // 增强调试信息：打印完整请求体和错误响应
            console.error('[TTS] API 请求失败:', {
                url,
                status: response.status,
                requestBody: { model: this.model, messages: [{ role: 'user', content: XITONG_STYLE_PROMPT.slice(0, 30) + '...' }, { role: 'assistant', content: text.slice(0, 100) + '...' }], audio: { format: 'wav', voice } },
                responseBody: parsed || errText,
            });
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

        // 奚童化预处理：添加情感标记和自然停顿
        const expressiveText = prepareTextForXitong(text);

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
                    { role: 'assistant', content: expressiveText },
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
            let parsed: any;
            try { parsed = JSON.parse(errText); detail = parsed.error?.message || errText; } catch {}
            console.error('[TTS] Streaming API 请求失败:', {
                url,
                status: response.status,
                requestBody: { model: this.model, messages: [{ role: 'user', content: XITONG_STYLE_PROMPT.slice(0, 30) + '...' }, { role: 'assistant', content: text.slice(0, 100) + '...' }], audio: { format: 'pcm16', voice }, stream: true },
                responseBody: parsed || errText,
            });
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
