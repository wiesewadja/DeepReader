/**
 * LLMClient - 支持 Tool Calling 的流式 LLM 客户端
 * 用于前端 Agent 直接调用 DeepSeek API
 */

import type { ChatMessage, ToolDefinition, StreamChunk } from './types';
import type { ITraceContext, IObservationRef } from './tracing/types';
import { agentLog } from '../utils/logger';

/**
 * LLM 客户端配置选项
 */
export interface LLMClientOptions {
  /** API 密钥 */
  apiKey: string;
  /** API 基础 URL，默认为 DeepSeek API */
  baseUrl?: string;
  /** 模型名称，如 'deepseek-chat' */
  model?: string;
  /** 服务商显示名称（用于日志） */
  providerName?: string;
}

/**
 * ModelConfig - LLM 模型配置
 * 用于 LLMClientManager 创建不同用途的客户端实例
 */
export type ModelConfig = LLMClientOptions;

export interface StreamCallbacks {
  onContent: (text: string) => void;
  onToolCall: (toolCalls: { id: string; name: string; arguments: string }[]) => void;
  onComplete: (finishReason: 'stop' | 'tool_calls' | 'length') => void;
  onError: (error: string) => void;
  onReasoning?: (text: string) => void; // 可选：处理 DeepSeek 的 reasoning_content
}

export interface StreamOptions {
  signal?: AbortSignal; // 外部传入的取消信号
  traceContext?: ITraceContext; // Langfuse 追踪上下文
}

/**
 * Response format options for structured output
 */
export interface ResponseFormat {
  type: 'json_object' | 'text';
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
  // 使用私有变量保护 API Key，防止意外序列化到日志
  #apiKey: string;
  private baseUrl: string;
  private model: string;
  private providerName: string;

  constructor(options: LLMClientOptions) {
    this.#apiKey = options.apiKey;
    this.baseUrl = options.baseUrl || 'https://api.deepseek.com';
    this.model = options.model || 'deepseek-chat';
    this.providerName = options.providerName || 'Unknown';
  }

  /**
   * 获取 API Key 的掩码版本（用于日志/调试）
   */
  get maskedApiKey(): string {
    if (!this.#apiKey || this.#apiKey.length < 8) {
      return '***';
    }
    return `${this.#apiKey.slice(0, 4)}...${this.#apiKey.slice(-4)}`;
  }

  /**
   * 防止对象被 JSON.stringify 时泄露 API Key
   */
  toJSON(): Record<string, unknown> {
    return {
      providerName: this.providerName,
      baseUrl: this.baseUrl,
      model: this.model,
      apiKey: this.maskedApiKey,
    };
  }

  /**
   * 获取 API URL（供调试日志使用）
   */
  getApiUrl(): string {
    return `${this.baseUrl}/chat/completions`;
  }

  /**
   * 获取模型名称（供调试日志使用）
   */
  getModel(): string {
    return this.model;
  }

  /**
   * 流式聊天，支持 Tool Calling
   * @param messages 对话消息列表
   * @param tools 可用的工具定义
   * @param callbacks 流式回调
   * @param options 可选配置（包括 abortSignal）
   * @returns AbortController 用于取消请求
   */
  async streamChat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    callbacks: StreamCallbacks,
    options?: StreamOptions
  ): Promise<AbortController> {
    const controller = new AbortController();

    // 如果外部提供了 AbortSignal，监听它并转发到内部的 controller
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', () => {
          controller.abort();
        });
      }
    }

    const apiUrl = `${this.baseUrl}/chat/completions`;

    // Kimi K2.5 / DeepSeek R1 等模型启用 thinking 功能时
    // 需要保留 assistant 消息中的 reasoning_content 字段
    // 只清理非 assistant 消息中的 reasoning_content（user/system 消息不应该有这个字段）
    const cleanedMessages = messages.map((msg, idx) => {
      // 打印每条消息的结构（调试用）
      agentLog(`[LLM] 消息[${idx}] role=${msg.role}, content=${(msg.content || '').substring(0, 50)}..., tool_calls=${(msg as any).tool_calls?.length || 0}, reasoning=${(msg as any).reasoning_content ? 'yes' : 'no'}`);

      // assistant 消息保留 reasoning_content
      if (msg.role === 'assistant') {
        return msg;
      }
      // 其他消息清理 reasoning_content
      const { reasoning_content, ...rest } = msg as any;
      return rest;
    });

    // 🕐 性能计时
    const t0 = performance.now();
    let ttfb = 0; // Time to First Byte
    let firstChunk = true;
    let chunkCount = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Langfuse generation 追踪
    const traceCtx = options?.traceContext;
    let genRef: IObservationRef | undefined;
    if (traceCtx) {
      genRef = traceCtx.withGeneration('llm-call', {
        model: this.model,
        metadata: { provider: this.providerName, baseUrl: this.baseUrl },
      });
    }

    // 估算输入 token 数（粗略）
    const inputEstimate = Math.round(JSON.stringify(messages).length / 2);
    agentLog(`[LLM] 🤖 使用服务商: ${this.providerName} | 模型: ${this.model} | API: ${this.baseUrl}`);
    agentLog(`[LLM] 📤 发送请求: ${messages.length} 条消息, ~${inputEstimate} tokens, ${tools.length} 个工具`);

    try {
      const fetchStart = performance.now();
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.#apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: cleanedMessages,
          tools: tools.length > 0 ? tools : undefined,
          stream: true,
        }),
        signal: controller.signal,
      });

      const fetchEnd = performance.now();
      ttfb = fetchEnd - fetchStart;
      agentLog(`[LLM] ⏱️ 请求响应: ${ttfb.toFixed(0)}ms (TTFB)`);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `API returned ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        genRef?.end({ statusMessage: errorMessage });
        callbacks.onError(errorMessage);
        return controller;
      }

      if (!response.body) {
        genRef?.end({ statusMessage: 'ReadableStream not supported' });
        callbacks.onError('ReadableStream not supported in this environment');
        return controller;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      // 用于累积 tool_calls（因为它们分块到达）
      const toolCallsMap = new Map<number, AccumulatedToolCall>();
      let finishReason: 'stop' | 'tool_calls' | 'length' = 'stop';

      // SSE buffer：用于处理跨 chunk 的不完整行
      let sseBuffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          chunkCount++;

          // 首次收到数据的日志
          if (firstChunk) {
            const firstChunkTime = performance.now() - t0;
            agentLog(`[LLM] 📥 首个数据块: ${firstChunkTime.toFixed(0)}ms`);
            firstChunk = false;
          }

          // 将新数据追加到 buffer
          sseBuffer += decoder.decode(value, { stream: true });

          // 按换行符分割，保留最后一个可能不完整的行
          const lines = sseBuffer.split('\n');
          sseBuffer = lines.pop() || ''; // 保留最后一个（可能不完整的）行

          for (const line of lines) {
            if (line.trim() === '') continue;
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

              // 处理 DeepSeek 的 reasoning_content（思考过程）
              // 忽略它，避免 API 报错 "thinking is enabled but reasoning_content is missing"
              // 如果需要显示思考过程，可以通过 onReasoning 回调
              if ((delta as any).reasoning_content && callbacks.onReasoning) {
                callbacks.onReasoning((delta as any).reasoning_content);
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

        // 处理 buffer 中剩余的内容
        if (sseBuffer.trim() !== '' && sseBuffer.startsWith('data: ')) {
          const data = sseBuffer.slice(6);
          if (data !== '[DONE]') {
            try {
              const parsed: StreamChunk = JSON.parse(data);
              const choice = parsed.choices?.[0];
              if (choice?.finish_reason) {
                finishReason = choice.finish_reason;
              }
            } catch {
              // 忽略解析错误
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

        // 🕐 流结束统计
        const totalTime = performance.now() - t0;
        const streamingTime = totalTime - ttfb;
        agentLog(`[LLM] 📊 流式统计: 总计 ${totalTime.toFixed(0)}ms | TTFB ${ttfb.toFixed(0)}ms | 流传输 ${streamingTime.toFixed(0)}ms | ${chunkCount} 个chunk | finish=${finishReason}`);

        // 结束 Langfuse generation
        genRef?.end({
          statusMessage: finishReason,
          metadata: { totalTime: totalTime.toFixed(0), ttfb: ttfb.toFixed(0), chunkCount, finishReason },
        });

        callbacks.onComplete(finishReason);
      } catch (readError) {
        if (readError instanceof Error && readError.name === 'AbortError') {
          // 请求被取消，正常情况，不视为错误
          genRef?.end({ statusMessage: 'aborted' });
          return controller;
        }
        const errMsg = readError instanceof Error ? readError.message : 'Stream read error';
        genRef?.end({ statusMessage: errMsg });
        callbacks.onError(errMsg);
      } finally {
        // 确保 reader 被正确释放
        // 使用 releaseLock() 而非 cancel()，因为 cancel() 可能抛出异常
        // releaseLock() 更安全，它允许 reader 被垃圾回收
        try {
          reader.releaseLock();
        } catch {
          // ignore - reader 可能已经释放
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      genRef?.end({ statusMessage: errorMessage });
      callbacks.onError(errorMessage);
    }

    return controller;
  }

  /**
   * 非流式聊天（用于简单场景）
   */
  async chat(
    messages: ChatMessage[],
    tools: ToolDefinition[] = [],
    responseFormat?: ResponseFormat
  ): Promise<{
    content: string;
    toolCalls: { id: string; name: string; arguments: string }[];
    finishReason: 'stop' | 'tool_calls' | 'length';
  }> {
    const apiUrl = `${this.baseUrl}/chat/completions`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        tools: tools.length > 0 ? tools : undefined,
        stream: false,
        response_format: responseFormat,
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

/**
 * LLMClientManager - 管理多个 LLM 客户端实例
 *
 * 用于支持不同认知状态使用不同的模型：
 * - main: 用于 Analytical + Formatter（深度分析）
 * - fast: 用于 Router + Inspectional（快速分类）
 */
export class LLMClientManager {
  private mainClient: LLMClient;
  private fastClient: LLMClient | null = null;

  constructor(mainConfig: ModelConfig, fastConfig?: ModelConfig) {
    this.mainClient = new LLMClient(mainConfig);
    if (fastConfig) {
      this.fastClient = new LLMClient(fastConfig);
    }
  }

  /**
   * 根据模型类型获取对应的客户端
   * 如果 fast 客户端未配置，回退到 main 客户端
   */
  getClient(modelType: 'fast' | 'main'): LLMClient {
    if (modelType === 'fast' && this.fastClient) {
      return this.fastClient;
    }
    return this.mainClient;
  }

  /**
   * 获取主客户端（用于向后兼容）
   */
  getMainClient(): LLMClient {
    return this.mainClient;
  }

  /**
   * 检查是否配置了独立的 fast 客户端
   */
  hasFastClient(): boolean {
    return this.fastClient !== null;
  }
}
