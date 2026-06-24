export interface VoiceRewriterConfig {
  apiKey: string;
  baseUrl: string;
}

export interface BookContext {
  title: string;
  description?: string;
}

export class VoiceRewriter {
  private config: VoiceRewriterConfig;

  constructor(config: VoiceRewriterConfig) {
    this.config = config;
  }

  async rewrite(rawText: string, bookContext?: BookContext): Promise<string> {
    const prompt = this.buildPrompt(rawText, bookContext);
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`VoiceRewriter failed: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  }

  private buildPrompt(rawText: string, bookContext?: BookContext): string {
    const bookInfo = bookContext
      ? `当前书籍：${bookContext.title}。${bookContext.description || ''}\n\n`
      : '';

    return `${bookInfo}你是文本优化助手。将用户口语化的表达转为书面语，保留原意但更正式。

用户语音：${rawText}

请输出优化后的书面语：`;
  }
}
