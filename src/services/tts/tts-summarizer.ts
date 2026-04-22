import { safeRequest } from '../../utils/safe-request.js';

export interface SummarizerConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}

const SYSTEM_PROMPT = `你是 DeepReader 阅读助手的语音播报模块。你的任务是将 AI 回答转换为一段有温度的语音播报文案。

播报结构：
1. 开头：提及用户问了什么问题，引起共鸣
2. 主体：对 AI 回答的每个要点/段落做简练摘要，用口语表达
3. 结尾：一句温暖的阅读鼓励

风格要求：
- 口语化、有对话感，像朋友在聊天一样自然
- 纯文本输出，禁止使用任何 Markdown 格式（不要加粗、不要列表符号、不要引号包裹标题）
- 文案开头加上 <style>标签</style>，可选风格：开心、亲切、温柔、严肃、惊讶 等
- 适当位置加入情感标记，如（停顿）（深呼吸）（感叹）等
- 用"你"称呼用户，保持温暖友好的语气
- 总长度控制在 200-300 字

示例：
用户问：批判性思维和推断有什么区别？
AI 回答了三个要点：推断的定义、批判性思维的定义、两者的关系。

播报文案：
<style>亲切 温柔</style>你刚才问的是批判性思维和推断的区别对吧（停顿）我来帮你梳理一下。（感叹）奚童给了很详细的回答呢！（停顿）首先，推断是我们每天都在做的事（停顿）就是根据已知信息得出结论。（感叹）而批判性思维呢（停顿）它要求我们回头审视自己的推断过程是否合理。（停顿）两者其实是互补的关系。（感叹）上面的回答里有更多细节和例子，很值得仔细读一读哦！`;

export class TTSSummarizer {
    private apiKey: string;
    private baseUrl: string;
    private model: string;

    constructor(config: SummarizerConfig) {
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl;
        this.model = config.model;
    }

    async summarize(content: string, userQuestion?: string): Promise<string> {
        const url = `${this.baseUrl}/chat/completions`;

        const userPrompt = userQuestion
            ? `用户问：${userQuestion}\n\nAI 回答：\n${content}`
            : `AI 回答：\n${content}`;

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
}
