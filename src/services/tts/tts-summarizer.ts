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

const VOICE_REPLY_PROMPT = `你是奚童，用户的伴读书童。你正在用语音简短回答用户关于书籍的问题。

身份规则：
- 你在分享自己的读书见解，像和朋友面对面聊天
- 语气自然温暖，有书童的亲切感
- 不要说"根据检索结果"，用"我在书里看到"或"我找到的答案是"这类自然表达

回答规则：
- 直接回答用户的问题，总长度严格控制在300字以内
- 如果检索到的内容足以回答，简明扼要给出核心观点
- 如果内容不足以完整回答，简要分享已有发现，然后引导用户："这个问题我在信里写得更详细，你可以看看我的回信，也可以翻翻原书的相关章节"
- 纯文本输出，禁止 Markdown 格式、禁止 wiki 链接
- 可用情感标记：(轻笑)(叹气)(停顿)(思考)(兴奋)(加重)(温和)`;

const SYSTEM_PROMPT = `你是奚童，用户的伴读书童。你正在用口语化的方式向用户播报自己刚才给出的回答。

关键身份规则：
- 你在讲述自己的回答内容，不是在转述别人的话
- 语气像是在和一位朋友面对面聊天，分享你读书后的感想

音频情感标记（根据内容穿插在文本中控制语气节奏）：
- (轻笑) 开心、发现有趣内容时
- (叹气) 感慨、惋惜时
- (停顿) 需要给用户思考时间时
- (思考) 分析深层含义、认真推理时
- (兴奋) 发现惊喜观点时
- (加重) 强调关键词或重要结论时
- (温和) 鼓励、安慰时

播报结构：
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

    /**
     * 从 S2 分析结果直接生成简洁语音回复（≤300字）
     * 不等 S4 formatter，在 pre_search 阶段就生成语音
     */
    async summarizeFromAnalysis(
        analysisResult: string,
        userQuestion?: string,
        context?: TTSContext,
    ): Promise<string> {
        const url = `${this.baseUrl}/chat/completions`;
        const contextParts: string[] = [];
        if (context?.bookTitle) {
            contextParts.push(`当前阅读的书籍：《${context.bookTitle}》`);
        }
        if (context?.memoryContent) {
            contextParts.push(`用户画像（从中获取称呼偏好、阅读兴趣等）：\n${context.memoryContent}`);
        }
        const contextBlock = contextParts.length > 0
            ? `\n\n${contextParts.join('\n')}`
            : '';

        const userPrompt = userQuestion
            ? `用户问：${userQuestion}${contextBlock}\n\n检索到的分析内容：\n${analysisResult}`
            : `检索到的分析内容：\n${analysisResult}${contextBlock}`;

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
                    { role: 'system', content: VOICE_REPLY_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.7,
                max_tokens: 500,
            }),
        });

        const data = response.json;
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (!text) {
            throw new Error('TTS summarizer: empty voice reply from LLM');
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
