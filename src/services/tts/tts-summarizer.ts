import { safeRequest } from '../../utils/safe-request.js';

export interface SummarizerConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}

const SUMMARY_PROMPT = `你是 DeepReader 阅读助手的语音播报模块。将以下 AI 回答转换为一段简短的语音播报文案。

要求：
1. 口语化、有对话感，像朋友在聊天一样自然
2. 保留核心观点，不超过 80 字
3. 根据内容选择合适的情绪风格，在文案开头加上 <style>标签</style>
   可选风格：开心、亲切、温柔、严肃、惊讶 等
4. 在文案中适当位置加入情感标记，如（停顿）（深呼吸）（感叹）等
5. 用"你"称呼用户，保持温暖友好的语气

示例输出：
<style>亲切 开心</style>这本书的核心观点是（停顿）它认为阅读不应该只是被动接受，而应该主动与作者对话。（感叹）这个视角真的很棒！

AI 回答：
`;

export class TTSSummarizer {
    private apiKey: string;
    private baseUrl: string;
    private model: string;

    constructor(config: SummarizerConfig) {
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl;
        this.model = config.model;
    }

    async summarize(content: string): Promise<string> {
        const url = `${this.baseUrl}/chat/completions`;

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
                    { role: 'user', content: SUMMARY_PROMPT + content },
                ],
                temperature: 0.7,
                max_tokens: 200,
            }),
        });

        const data = response.json;
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (!text) {
            throw new Error('TTS summarizer: empty response from LLM');
        }
        return text;
    }
}
