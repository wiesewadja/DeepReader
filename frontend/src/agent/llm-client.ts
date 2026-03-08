/**
 * LLMClient - 支持 Tool Calling 的流式 LLM 客户端
 * 用于前端 Agent 直接调用 DeepSeek API
 */

import type { ChatMessage, ToolDefinition, StreamChunk } from './types';

export interface LLMClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface StreamCallbacks {
  onContent: (text: string) => void;
  onToolCall: (toolCalls: { id: string; name: string; arguments: string }[]) => void;
  onComplete: (finishReason: 'stop' | 'tool_calls' | 'length') => void;
  onError: (error: string) => void;
}

/**
 * 用于累积流式响应中的 tool_calls
 */
interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export class LLMClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(options: LLMClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl || 'https://api.deepseek.com';
    this.model = options.model || 'deepseek-chat';
  }

  /**
   * 流式聊天，支持 Tool Calling
   * @param messages 对话消息列表
   * @param tools 可用的工具定义
   * @param callbacks 流式回调
   * @returns AbortController 用于取消请求
   */
  async streamChat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    callbacks: StreamCallbacks
  ): Promise<AbortController> {
    const controller = new AbortController();

    const apiUrl = `${this.baseUrl}/chat/completions`;

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          tools: tools.length > 0 ? tools : undefined,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `API returned ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        callbacks.onError(errorMessage);
        return controller;
      }

      if (!response.body) {
        callbacks.onError('ReadableStream not supported in this environment');
        return controller;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      // 用于累积 tool_calls（因为它们分块到达）
      const toolCallsMap = new Map<number, AccumulatedToolCall>();
      let finishReason: 'stop' | 'tool_calls' | 'length' = 'stop';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter((line) => line.trim() !== '');

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed: StreamChunk = JSON.parse(data);
              const choice = parsed.choices?.[0];
              if (!choice) continue;

              // 处理 finish_reason
              if (choice.finish_reason) {
                finishReason = choice.finish_reason;
              }

              const delta = choice.delta;

              // 处理文本内容
              if (delta.content) {
                callbacks.onContent(delta.content);
              }

              // 处理 tool_calls（增量累积）
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index;

                  // 获取或创建累积的 tool call
                  let accumulated = toolCallsMap.get(idx);
                  if (!accumulated) {
                    accumulated = { id: '', name: '', arguments: '' };
                    toolCallsMap.set(idx, accumulated);
                  }

                  // 累积各个字段
                  if (tc.id) {
                    accumulated.id = tc.id;
                  }
                  if (tc.function?.name) {
                    accumulated.name = tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    accumulated.arguments += tc.function.arguments;
                  }
                }
              }
            } catch {
              // 忽略解析错误，继续处理下一个 chunk（SSE chunk 边界问题）
            }
          }
        }

        // 流结束，处理累积的 tool_calls
        if (toolCallsMap.size > 0) {
          const toolCalls = Array.from(toolCallsMap.values()).filter(
            (tc) => tc.id && tc.name
          );
          if (toolCalls.length > 0) {
            callbacks.onToolCall(toolCalls);
          }
        }

        callbacks.onComplete(finishReason);
      } catch (readError) {
        if (readError instanceof Error && readError.name === 'AbortError') {
          // 请求被取消，正常情况，不视为错误
          return controller;
        }
        callbacks.onError(readError instanceof Error ? readError.message : 'Stream read error');
      } finally {
        // 确保 reader 被释放
        try {
          reader.cancel();
        } catch {
          // ignore
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      callbacks.onError(errorMessage);
    }

    return controller;
  }

  /**
   * 非流式聊天（用于简单场景）
   */
  async chat(messages: ChatMessage[], tools: ToolDefinition[] = []): Promise<{
    content: string;
    toolCalls: { id: string; name: string; arguments: string }[];
    finishReason: 'stop' | 'tool_calls' | 'length';
  }> {
    const apiUrl = `${this.baseUrl}/chat/completions`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        tools: tools.length > 0 ? tools : undefined,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error('No choices in response');
    }

    const toolCalls: { id: string; name: string; arguments: string }[] = [];
    if (choice.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
    }

    return {
      content: choice.message?.content || '',
      toolCalls,
      finishReason: choice.finish_reason || 'stop',
    };
  }
}
