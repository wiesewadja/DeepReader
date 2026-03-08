/**
 * AgentLoop - Agent 核心执行循环
 *
 * 职责：
 * 1. 调用 LLM 并处理流式响应
 * 2. 当收到 tool_calls 时，执行工具并将结果添加到消息历史
 * 3. 循环直到 LLM 返回 stop 或达到最大轮数
 */

import type { ChatMessage, ToolDefinition } from './types';
import { LLMClient } from './llm-client';
import type { ToolRegistry, ToolContext } from './tools/types';
import { executeTool } from './tools/index';
import { log } from '../utils/logger';

export interface AgentLoopOptions {
  maxIterations?: number; // default 10
  abortSignal?: AbortSignal; // 用于取消请求
  onContent: (text: string) => void;
  onProgress: (status: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

/**
 * 运行 Agent 执行循环
 *
 * @param client LLM 客户端实例
 * @param messages 对话消息历史
 * @param tools 可用工具定义列表
 * @param toolRegistry 工具注册表
 * @param context 工具执行上下文
 * @param options 配置选项（回调、最大轮数等）
 * @returns 更新后的消息历史
 *
 * 执行流程：
 * 1. 调用 LLM with tools
 * 2. 如果返回 tool_calls，执行工具并循环
 * 3. 如果返回 stop，结束循环
 * 4. 最多执行 10 轮
 */
export async function runAgentLoop(
  client: LLMClient,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  toolRegistry: ToolRegistry,
  context: ToolContext,
  options: AgentLoopOptions
): Promise<ChatMessage[]> {
  const maxIterations = options.maxIterations || 10;
  let iterations = 0;
  const workingMessages = [...messages];
  let hadError = false; // 跟踪是否发生了错误

  while (iterations < maxIterations) {
    // 检查是否被取消
    if (options.abortSignal?.aborted) {
      log('[AgentLoop] Aborted by signal');
      break;
    }

    // 如果之前发生了错误，终止循环
    if (hadError) {
      log('[AgentLoop] Error occurred, terminating loop');
      break;
    }

    iterations++;
    log(`[AgentLoop] Iteration ${iterations}/${maxIterations}`);
    log(`[AgentLoop] 当前消息数: ${workingMessages.length}`);
    log(`[AgentLoop] 可用工具数: ${tools.length}`);

    let accumulatedContent = '';
    let finishReason: 'stop' | 'tool_calls' | 'length' | null = null;
    let toolCalls: { id: string; name: string; arguments: string }[] = [];

    // 调用 LLM（流式）
    await new Promise<void>((resolve) => {
      client.streamChat(
        workingMessages,
        tools,
        {
          onContent: (text) => {
            accumulatedContent += text;
            options.onContent(text);
          },
          onToolCall: (calls) => {
            toolCalls = calls;
            finishReason = 'tool_calls';
          },
          onComplete: (reason) => {
            // 只有在没有收到 tool_calls 时才更新 finishReason
            if (finishReason !== 'tool_calls') {
              finishReason = reason;
            }
            resolve();
          },
          onError: (error) => {
            hadError = true;
            options.onError(error);
            resolve();
          },
        },
        { signal: options.abortSignal } // 传递取消信号
      );
    });

    // 如果没有 tool_calls，循环结束
    if (finishReason !== 'tool_calls' || toolCalls.length === 0) {
      log(`[AgentLoop] No more tool calls, finishing. finishReason=${finishReason}, toolCalls.length=${toolCalls.length}`);
      log(`[AgentLoop] accumulatedContent 长度: ${accumulatedContent.length}`);
      options.onComplete();
      break;
    }

    log(`[AgentLoop] 收到 ${toolCalls.length} 个工具调用:`, toolCalls.map(tc => tc.name).join(', '));

    // 构建 assistant 消息（包含 tool_calls）
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: accumulatedContent || '',
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      })),
    };
    workingMessages.push(assistantMessage);

    // 依次执行每个 tool call
    for (const tc of toolCalls) {
      log(`[AgentLoop] Executing tool: ${tc.name}`);
      options.onProgress(`正在执行: ${tc.name}...`);

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        args = {};
      }

      const result = await executeTool(toolRegistry, tc.name, args, context);

      // 添加 tool result 消息
      workingMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  if (iterations >= maxIterations) {
    log('[AgentLoop] Reached max iterations');
    options.onProgress('达到最大轮数，正在总结...');
  }

  return workingMessages;
}
