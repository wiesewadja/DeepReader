/**
 * State Loop Runner
 *
 * 在单个状态节点内运行 LLM 调用循环
 * 处理工具调用、拦截和流式输出
 */

import type { ChatMessage, ToolDefinition } from '../../types';
import { LLMClient, LLMClientManager } from '../../llm-client';
import type { ToolRegistry, ToolContext } from '../../tools/types';
import { executeTool } from '../../tools/index';
import type { ToolInterceptor } from '../types';
import type { ITraceContext } from '../../tracing/types';

/**
 * 工具名称到用户友好动作的简化映射
 */
const TOOL_ACTION_MAP: Record<string, (args: Record<string, unknown>) => string> = {
  search_book: (args) => `搜索「${String(args.query || '').slice(0, 15)}」`,
  read_book_section: (args) => `精读「${String(args.node_ids || args.heading || '章节').toString().slice(0, 15)}」`,
  search_read_books: (args) => `跨书查找「${String(args.query || '').slice(0, 10)}」`,
};

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
  /** 最大迭代次数（LLM 调用次数） */
  maxIterations?: number;
  /** 最大工具调用次数（硬约束） */
  maxToolCalls?: number;
  /** 超时（毫秒） */
  timeout?: number;
  /** 取消信号 */
  abortSignal?: AbortSignal;
  /** Langfuse trace context for observability */
  traceContext?: ITraceContext;
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
  finishReason: 'stop' | 'max_iterations' | 'max_tool_calls' | 'timeout' | 'error';
}

/**
 * 工具结果压缩常量
 */
const MAX_TOOL_RESULT_LENGTH = 8000;

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
 */
export async function runStateLoop(
  llmClientManager: LLMClientManager,
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
    maxToolCalls,
    abortSignal,
    traceContext: traceCtx,
  } = options;

  // Create root span for this state loop execution
  const loopSpan = traceCtx?.withSpan(`state-loop-${stateName}`, {
    input: {
      systemPrompt,
      userMessage,
      availableTools,
    },
    metadata: {
      model,
      maxIterations,
      maxToolCalls,
    },
  });

  // 根据模型类型选择客户端
  const llmClient = llmClientManager.getClient(model);

  // 构建工具定义
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

  // Record system prompt and messages via tracing

  let iterations = 0;
  let totalToolCalls = 0;
  let accumulatedContent = '';
  let accumulatedReasoning = '';
  const toolResults: StateLoopResult['toolResults'] = [];
  let hitToolCallLimit = false; // 标记是否达到工具调用限制
  let llmError: string | null = null; // 记录 LLM 错误

  while (iterations < maxIterations) {
    if (abortSignal?.aborted) {
      return {
        content: accumulatedContent,
        toolResults,
        iterations,
        finishReason: 'stop',
      };
    }

    // 如果已达到工具调用限制，跳出循环
    if (maxToolCalls !== undefined && totalToolCalls >= maxToolCalls) {
      hitToolCallLimit = true;
      break;
    }

    iterations++;

    // 开始 LLM 交互
    const llmStartTime = Date.now();
    let finishReason: 'stop' | 'tool_calls' | null = null;
    let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    const llmGen = loopSpan?.withGeneration(`llm-${stateName}-iter${iterations}`, {
      model: llmClient.getModel(),
      input: {
        systemPrompt,
        userMessage,
        toolCount: toolDefinitions.length,
        toolNames: toolDefinitions.map(t => t.function.name),
      },
    });

await new Promise<void>((resolve) => {
        llmClient.streamChat(
          messages,
          toolDefinitions,
          {
            onContent: (text) => {
              accumulatedContent += text;
              callbacks.onContent?.(text);
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
              llmError = error;
              resolve();
            },
          },
          { signal: abortSignal, traceContext: loopSpan }
        );
      });

    const llmDuration = Date.now() - llmStartTime;

    // End LLM generation observation
    llmGen?.end({
      output: {
        content: accumulatedContent,
        finishReason: finishReason || 'stop',
        ...(finishReason === 'tool_calls' ? { toolCallNames: toolCalls.map(tc => tc.name) } : {}),
        ...(accumulatedReasoning ? { reasoning: accumulatedReasoning } : {}),
      },
      metadata: {
        duration: llmDuration,
        contentLength: accumulatedContent.length,
        toolCallCount: toolCalls.length,
      },
    });

    // 如果没有工具调用，循环结束
    if (finishReason !== 'tool_calls' || toolCalls.length === 0) {
      // 如果 LLM 出错且无内容，返回错误信息
      if (llmError && !accumulatedContent) {
        return {
          content: `[LLM 调用失败: ${llmError}]`,
          toolResults,
          iterations,
          finishReason: 'error',
        };
      }
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

    // 执行工具调用（并行执行）
    const toolStartTime = Date.now();

    // 预处理所有工具调用：解析参数、应用拦截器
    const preparedCalls = toolCalls.map(tc => {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        args = {};
      }

      const originalArgs = { ...args };

      // 应用工具拦截器
      let interceptorNote: string | undefined;
      if (toolInterceptor) {
        const interceptedArgs = toolInterceptor(tc.name, args);
        if (JSON.stringify(interceptedArgs) !== JSON.stringify(originalArgs)) {
          interceptorNote = `scopeNodeIds 注入`;
        }
        args = interceptedArgs;
      }

      return { tc, args, originalArgs, interceptorNote };
    });

    // 检查工具调用次数限制，决定哪些需要执行
    const callsToExecute: typeof preparedCalls = [];
    const callsToSkip: typeof preparedCalls = [];

    for (const prepared of preparedCalls) {
      if (maxToolCalls !== undefined && totalToolCalls >= maxToolCalls) {
        callsToSkip.push(prepared);
      } else {
        callsToExecute.push(prepared);
        totalToolCalls++;
      }
    }

    // 记录跳过的工具调用
    for (const { tc } of callsToSkip) {
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: `已达到工具调用次数上限（${maxToolCalls}次），此工具调用被跳过。`,
      });
    }

    // 🚀 并行执行所有工具调用
    // 显示更详细的工具调用信息
    const toolNames = callsToExecute.map(c => {
      const actionFn = TOOL_ACTION_MAP[c.tc.name];
      return actionFn ? actionFn(c.args) : c.tc.name;
    });
    callbacks.onProgress?.(`🔧 ${toolNames.join(' · ')}`);
    const executionResults = await Promise.all(
      callsToExecute.map(async ({ tc, args, originalArgs, interceptorNote }) => {
        const toolExecStart = Date.now();

        // Create tool span
        const interceptorApplied = interceptorNote !== undefined;
        const toolSpan = loopSpan?.withSpan(`tool-${tc.name}`, {
          input: {
            toolName: tc.name,
            args,
            ...(interceptorApplied ? { originalArgs } : {}),
          },
          ...(interceptorApplied ? { metadata: { interceptorApplied: true } } : {}),
        });

        try {
          const rawResult = await executeTool(toolRegistry, tc.name, args, toolContext);
          const compressedResult = compressToolResult(rawResult);

          const toolExecDuration = Date.now() - toolExecStart;

          toolSpan?.end({
            output: {
              status: 'success',
              result: rawResult,
              resultLength: rawResult.length,
            },
            metadata: {
              duration: toolExecDuration,
              originalResultLength: rawResult.length,
              compressedResultLength: compressedResult.length,
            },
          });

          return { tc, result: compressedResult, error: null, duration: toolExecDuration };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          const toolExecDuration = Date.now() - toolExecStart;

          toolSpan?.end({
            level: 'ERROR',
            output: { status: 'error', error: errorMsg },
            metadata: { duration: toolExecDuration },
          });

          return { tc, result: null, error: errorMsg, duration: toolExecDuration };
        }
      })
    );

    // 将所有执行结果添加到消息和结果列表（保持原始顺序）
    for (const execResult of executionResults) {
      const { tc, result, error } = execResult;

      const toolResultContent = error
        ? `Error: ${error}`
        : result || '(无结果)';

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: toolResultContent,
      });

      if (result) {
        toolResults.push({
          toolName: tc.name,
          args: preparedCalls.find(p => p.tc.id === tc.id)!.args,
          result,
        });
      }
    }

    const toolDuration = Date.now() - toolStartTime;
    callbacks.onProgress?.(`工具执行完成 (${toolDuration}ms)`);

    // 如果达到工具调用限制，标记并准备结束
    if (maxToolCalls !== undefined && totalToolCalls >= maxToolCalls) {
      hitToolCallLimit = true;
    }

    // 清空累积内容
    accumulatedContent = '';
    accumulatedReasoning = '';
  }

  // 达到最大迭代次数或工具调用限制，强制输出结论
  const needsForcedConclusion = (iterations >= maxIterations || hitToolCallLimit) && toolResults.length > 0;
  if (needsForcedConclusion) {
    const limitType = hitToolCallLimit ? '工具调用' : '迭代';
    const limitValue = hitToolCallLimit ? maxToolCalls : maxIterations;
    const forcedConclusionPrompt = `你已达到${limitType}次数上限（${limitValue}次）。

现在请基于已收集的所有信息，输出你的最终分析结论。

要求：
1. 综合所有工具调用结果
2. 输出完整的分析内容，不要再次调用工具
3. 如果信息不足，基于已有信息给出尽可能完整的回答`;

    messages.push({
      role: 'user',
      content: forcedConclusionPrompt,
    });

    const forcedSpan = loopSpan?.withSpan('forced-conclusion');

    await new Promise<void>((resolve) => {
      llmClient.streamChat(
        messages,
        [],
        {
          onContent: (text) => {
            accumulatedContent += text;
            callbacks.onContent?.(text);
          },
          onReasoning: (text) => {
            accumulatedReasoning += text;
            callbacks.onReasoning?.(text);
          },
          onToolCall: () => {
            // 强制结论阶段不应该有工具调用
          },
          onComplete: () => resolve(),
          onError: (error) => {
            console.error('[StateLoop] Forced conclusion error:', error);
            resolve();
          },
        },
        { signal: abortSignal, traceContext: forcedSpan }
      );
    });

    forcedSpan?.end({
      output: { finishReason: 'forced_conclusion' },
      metadata: { contentLength: accumulatedContent.length },
    });
  }

  // 确定完成原因
  let finishReason: StateLoopResult['finishReason'] = 'stop';
  if (hitToolCallLimit) {
    finishReason = 'max_tool_calls';
  } else if (iterations >= maxIterations) {
    finishReason = 'max_iterations';
  }

  // 结束 loop span
  loopSpan?.end({
    output: { finishReason },
    metadata: { iterations, totalToolCalls },
  });

  return {
    content: accumulatedContent,
    toolResults,
    iterations,
    finishReason,
  };
}
