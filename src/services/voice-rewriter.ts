export interface VoiceRewriterConfig {
  apiKey: string;
  baseUrl: string;
  model?: string;
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

  async *rewrite(rawText: string, bookContext?: BookContext, signal?: AbortSignal): AsyncGenerator<string> {
    const prompt = this.buildPrompt(rawText, bookContext);
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model ?? 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`VoiceRewriter failed: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('VoiceRewriter: no response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // skip malformed chunks
          }
        }
      }
    }
  }

  private buildPrompt(rawText: string, bookContext?: BookContext): string {
    const bookInfo = bookContext
      ? `当前书籍：${bookContext.title}。${bookContext.description || ''}\n\n`
      : '';

    return `你是文本优化助手。将用户口语化的表达转为书面语，保留原意但更正式。

${bookInfo}用户语音：${rawText}

请输出优化后的书面语：`;
  }
}
