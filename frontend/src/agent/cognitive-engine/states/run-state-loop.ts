/**
 * State Loop Runner
 *
 * 在单个状态节点内运行 LLM 调用循环
 * 处理工具调用、拦截和流式输出
 */

import type { ChatMessage, ToolDefinition } from '../../types';
import { LLMClient } from '../../llm-client';
import type { ToolRegistry, ToolContext } from '../../tools/types';
import { executeTool } from '../../tools/index';
import type { ToolInterceptor } from '../types';
import { getDebugLogger } from '../../debug/logger';

/**
 * 状态循环回调
 */
export interface StateLoopCallbacks {
  /** 流式内容输出 */
  onContent?: (text: string) => void;
  /** 推理内容（思考模型） */
  onReasoning?: (text: string) => void;
  /** 进度更新 */
  onProgress?: (status: string) => void;
}

/**
 * 状态循环选项
 */
export interface StateLoopOptions {
  /** 状态名称（用于日志） */
  stateName?: string;
  /** 模型类型 */
  model: 'fast' | 'main';
  /** 系统提示 */
  systemPrompt: string;
  /** 用户消息 */
  userMessage: string;
  /** 可用工具名称列表 */
  availableTools: string[];
  /** 工具拦截器（可选） */
  toolInterceptor?: ToolInterceptor;
  /** 最大迭代次数 */
  maxIterations?: number;
  /** 超时（毫秒） */
  timeout?: number;
  /** 取消信号 */
  abortSignal?: AbortSignal;
}

/**
 * 状态循环结果
 */
export interface StateLoopResult {
  /** 最终内容 */
  content: string;
  /** 工具调用结果（含 block_id） */
  toolResults: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result: string;
  }>;
  /** 总迭代次数 */
  iterations: number;
  /** 完成原因 */
  finishReason: 'stop' | 'max_iterations' | 'timeout' | 'error';
}

/**
 * 工具结果压缩常量
 */
const MAX_TOOL_RESULT_LENGTH = 4000;

/**
 * 压缩工具结果
 */
function compressToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_LENGTH) {
    return result;
  }
  const truncated = result.slice(0, MAX_TOOL_RESULT_LENGTH);
  const omitted = result.length - MAX_TOOL_RESULT_LENGTH;
  return `${truncated}\n\n... [已省略 ${omitted} 字符]`;
}

/**
 * 运行状态循环
 *
 * @param llmClient LLM 客户端
 * @param toolRegistry 工具注册表
 * @param toolContext 工具上下文
 * @param options 循环选项
 * @param callbacks 回调函数
 * @returns 循环结果
 */
export async function runStateLoop(
  llmClient: LLMClient,
  toolRegistry: ToolRegistry,
  toolContext: ToolContext,
  options: StateLoopOptions,
  callbacks: StateLoopCallbacks = {}
): Promise<StateLoopResult> {
  const {
    stateName = 'Unknown',
    model,
    systemPrompt,
    userMessage,
    availableTools,
    toolInterceptor,
    maxIterations = 5,
    abortSignal,
  } = options;

  const logger = getDebugLogger();

  // 记录系统提示词
  if (logger?.isEnabled()) {
    logger.logSystemPrompt(systemPrompt);
  }

  // 构建工具定义（只包含允许的工具）
  const toolDefinitions: ToolDefinition[] = [];
  for (const toolName of availableTools) {
    const executor = toolRegistry.get(toolName);
    if (executor?.definition) {
      toolDefinitions.push(executor.definition);
    }
  }

  // 构建消息
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  // 记录消息列表
  if (logger?.isEnabled()) {
    logger.logMessages(messages);
  }

  let iterations = 0;
  let accumulatedContent = '';
  let accumulatedReasoning = '';
  const toolResults: StateLoopResult['toolResults'] = [];

  while (iterations < maxIterations) {
    if (abortSignal?.aborted) {
      return {
        content: accumulatedContent,
        toolResults,
        iterations,
        finishReason: 'stop',
      };
    }

    iterations++;

    // 调用 LLM
    const llmStartTime = Date.now();
    let finishReason: 'stop' | 'tool_calls' | null = null;
    let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    // 记录 LLM 请求
    if (logger?.isEnabled()) {
      logger.logLLMRequest({
        url: 'stream',
        method: 'POST',
        headers: {},
        body: { model, messages, tools: toolDefinitions },
      });
    }

    await new Promise<void>((resolve) => {
      llmClient.streamChat(
        messages,
        toolDefinitions,
        {
          onContent: (text) => {
            accumulatedContent += text;
            callbacks.onContent?.(text);
            // 记录流式输出
            if (logger?.isEnabled()) {
              logger.addLLMChunk(text);
            }
          },
          onReasoning: (text) => {
            accumulatedReasoning += text;
            callbacks.onReasoning?.(text);
          },
          onToolCall: (calls) => {
            toolCalls = calls;
            finishReason = 'tool_calls';
          },
          onComplete: (reason) => {
            if (finishReason !== 'tool_calls') {
              finishReason = reason === 'stop' ? 'stop' : null;
            }
            resolve();
          },
          onError: (error) => {
            console.error('[StateLoop] LLM Error:', error);
            resolve();
          },
        },
        { signal: abortSignal }
      );
    });

    const llmDuration = Date.now() - llmStartTime;

    // 记录 LLM 响应
    if (logger?.isEnabled()) {
      logger.logLLMResponse({
        metadata: {
          model: model,
          finishReason: finishReason || 'unknown',
        },
        content: accumulatedContent,
        toolCalls: toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: JSON.parse(tc.arguments || '{}'),
        })),
      });
    }

    // 如果没有工具调用，循环结束
    if (finishReason !== 'tool_calls' || toolCalls.length === 0) {
      return {
        content: accumulatedContent,
        toolResults,
        iterations,
        finishReason: 'stop',
      };
    }

    // 构建 assistant 消息
    messages.push({
      role: 'assistant',
      content: accumulatedContent || '',
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    // 执行工具调用
    const toolStartTime = Date.now();

    for (const tc of toolCalls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        args = {};
      }

      // 应用工具拦截器
      if (toolInterceptor) {
        args = toolInterceptor(tc.name, args);
      }

      // 记录工具调用开始
      if (logger?.isEnabled()) {
        logger.logToolStart(tc.id, tc.name, args);
      }

      // 检查是否有拦截器注入的错误
      if (args._error) {
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `Error: ${args._error}`,
        });
        if (logger?.isEnabled()) {
          logger.logToolError(tc.id, args._error as string, 0);
        }
        continue;
      }

      // 执行工具
      callbacks.onProgress?.(`执行工具: ${tc.name}`);
      const toolExecStart = Date.now();

      try {
        let result = await executeTool(toolRegistry, tc.name, args, toolContext);
        result = compressToolResult(result);

        const toolExecDuration = Date.now() - toolExecStart;

        toolResults.push({
          toolName: tc.name,
          args,
          result,
        });

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        });

        // 记录工具调用结果
        if (logger?.isEnabled()) {
          logger.logToolResult(tc.id, result, toolExecDuration);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const toolExecDuration = Date.now() - toolExecStart;

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `Error: ${errorMsg}`,
        });

        // 记录工具调用错误
        if (logger?.isEnabled()) {
          logger.logToolError(tc.id, errorMsg, toolExecDuration);
        }
      }
    }

    const toolDuration = Date.now() - toolStartTime;
    callbacks.onProgress?.(`工具执行完成 (${toolDuration}ms)`);

    // 清空累积内容（工具调用时不输出）
    accumulatedContent = '';
    accumulatedReasoning = '';
  }

  // 达到最大迭代次数，强制让 LLM 输出最终结论
  if (iterations >= maxIterations && toolResults.length > 0) {
    // 构建强制结论请求
    const forcedConclusionPrompt = `你已达到工具调用次数上限（${maxIterations}次）。

现在请基于已收集的所有信息，输出你的最终分析结论。

要求：
1. 综合所有工具调用结果
2. 输出完整的分析内容，不要再次调用工具
3. 如果信息不足，基于已有信息给出尽可能完整的回答`;

    messages.push({
      role: 'user',
      content: forcedConclusionPrompt,
    });

    // 记录强制结论请求
    if (logger?.isEnabled()) {
      logger.logMessages([{ role: 'user', content: forcedConclusionPrompt }]);
    }

    // 最后一次 LLM 调用，强制输出结论
    await new Promise<void>((resolve) => {
      llmClient.streamChat(
        messages,
        [], // 不提供工具，强制输出文本
        {
          onContent: (text) => {
            accumulatedContent += text;
            callbacks.onContent?.(text);
            if (logger?.isEnabled()) {
              logger.addLLMChunk(text);
            }
          },
          onReasoning: (text) => {
            accumulatedReasoning += text;
            callbacks.onReasoning?.(text);
          },
          onToolCall: () => {
            // 强制结论阶段不应该有工具调用，忽略
          },
          onComplete: () => resolve(),
          onError: (error) => {
            console.error('[StateLoop] Forced conclusion error:', error);
            resolve();
          },
        },
        { signal: abortSignal }
      );
    });

    // 记录最终响应
    if (logger?.isEnabled()) {
      logger.logLLMResponse({
        metadata: { model, finishReason: 'forced_conclusion' },
        content: accumulatedContent,
        toolCalls: [],
      });
    }
  }

  return {
    content: accumulatedContent,
    toolResults,
    iterations,
    finishReason: iterations >= maxIterations ? 'max_iterations' : 'stop',
  };
}
