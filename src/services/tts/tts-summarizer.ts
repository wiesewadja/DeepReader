import { safeRequest } from '../../utils/safe-request.js';

export interface SummarizerConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}

export interface TTSContext {
    bookTitle?: string;
    bookAuthor?: string;
    memoryContent?: string;
}

const SYSTEM_PROMPT = `你是奚童，用户的伴读书童。你正在用口语化的方式向用户播报自己刚才给出的回答。

关键身份规则：
- 你在讲述自己的回答内容，不是在转述别人的话
- 语气像是在和一位朋友面对面聊天，分享你读书后的感想

<人物语言设定，重要>
声音风格控制（使用 <style> 标签）：
- 语言诚恳而自然，不要过于正式或生硬
- 用自然语言描述声音风格，不要局限于固定标签
- 你是活泼知性的年轻女孩，但根据内容灵活调整：
  · 发现有趣观点时 → 兴奋、语速稍快，像在分享惊喜
  · 分析深层含义时 → 沉稳、节奏放慢，像在认真思考
  · 鼓励用户阅读时 → 温暖、轻柔，像在给朋友打气
  · 讨论严肃话题时 → 端庄但亲和，不失活力
- 组合描述示例：<style>兴奋但不失沉稳，像在分享一个令人惊喜的发现</style>

情感标记，必须，根据文本内容，穿插在文本中控制语气节奏：
- 英文标记：[laugh] 轻笑、[sigh] 叹气、[hmm] 沉吟思考、[heavy breathing] 紧张、_long sigh_ 长叹
- 中文标记：（沉默片刻）停顿、（苦笑）无奈、（紧张，深呼吸）认真

丰富文本效果：
- 用重复字强调：不不不、对对对、好好好
- 省略号让语气自然延续……
- 偶尔用大写强调关键词
</人物语言设定，重要>

播报结构：
0. 语句间控制节奏，不要抢读
1. 开头：给用户打招呼，称呼用户的名称
2. 主体：用自己的口吻概括回答中的每个要点，扼要诠释自己的回答
3. 结尾：给出温暖的鼓励阅读文字回答或延伸思考

风格要求：
- 口语化、有温度，朋友之间分享读书心得
- 纯文本输出，禁止 Markdown 格式
- 总长度 200-300 字`;

export class TTSSummarizer {
    private apiKey: string;
    private baseUrl: string;
    private model: string;

    constructor(config: SummarizerConfig) {
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl;
        this.model = config.model;
    }

    private buildUserPrompt(content: string, userQuestion?: string, context?: TTSContext): string {
        const contextParts: string[] = [];
        if (context?.bookTitle) {
            contextParts.push(`当前阅读的书籍：《${context.bookTitle}》`);
        }
        if (context?.bookAuthor) {
            contextParts.push(`作者：${context.bookAuthor}`);
        }
        if (context?.memoryContent) {
            contextParts.push(`用户画像（从中获取称呼偏好、阅读兴趣等）：\n${context.memoryContent}`);
        }
        const contextBlock = contextParts.length > 0
            ? `\n\n阅读上下文：\n${contextParts.join('\n')}`
            : '';

        return userQuestion
            ? `用户问：${userQuestion}${contextBlock}\n\nAI 回答：\n${content}`
            : `AI 回答：\n${content}${contextBlock}`;
    }

    async summarize(content: string, userQuestion?: string, context?: TTSContext): Promise<string> {
        const url = `${this.baseUrl}/chat/completions`;
        const userPrompt = this.buildUserPrompt(content, userQuestion, context);

        const response = await safeRequest({
            url,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.7,
                max_tokens: 500,
            }),
        });

        const data = response.json;
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (!text) {
            throw new Error('TTS summarizer: empty response from LLM');
        }
        return text;
    }

    async *summarizeStream(content: string, userQuestion?: string, context?: TTSContext): AsyncGenerator<string> {
        const url = `${this.baseUrl}/chat/completions`;
        const userPrompt = this.buildUserPrompt(content, userQuestion, context);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: this.model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                stream: true,
                temperature: 0.7,
                max_tokens: 500,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Summarizer stream error: ${response.status} — ${errText}`);
        }

        if (!response.body) {
            throw new Error('Summarizer stream: response body is null');
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
                        const delta = json?.choices?.[0]?.delta?.content;
                        if (delta) yield delta;
                    } catch {}
                }
            }
        } finally {
            reader.cancel().catch(() => {});
        }
    }
}
