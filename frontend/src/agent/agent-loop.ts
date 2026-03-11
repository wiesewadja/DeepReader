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
import { agentLog } from '../utils/logger';
import {
  validateAndCorrectLinks,
  extractReferencedChapters,
} from './utils/link-validator.js';
import {
  updateReadingProgress,
  FAMILIARITY_DELTAS,
} from './utils/book-note.js';

// 导出日志函数供控制台使用
export { setModuleEnabled, setModulesEnabled, getModuleConfig } from '../utils/logger';

export interface AgentLoopOptions {
  maxIterations?: number; // default 10
  abortSignal?: AbortSignal; // 用于取消请求
  onContent: (text: string) => void;
  onProgress: (status: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
  /**
   * 当 AI 回复完成时调用（包含完整内容）
   * 用于校验链接和更新熟悉度
   */
  onContentComplete?: (content: string) => Promise<string>;
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
      agentLog('[AgentLoop] Aborted by signal');
      break;
    }

    // 如果之前发生了错误，终止循环
    if (hadError) {
      agentLog('[AgentLoop] Error occurred, terminating loop');
      break;
    }

    iterations++;

    // 详细的迭代开始日志
    agentLog(`\n${'='.repeat(60)}`);
    agentLog(`[AgentLoop] 迭代 ${iterations}/${maxIterations}`);
    agentLog(`[AgentLoop] 消息历史: ${workingMessages.length} 条, 工具: ${tools.length} 个`);

    // 记录最后一条用户消息的内容（用于理解上下文）
    const lastUserMsg = [...workingMessages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
      const contentPreview = typeof lastUserMsg.content === 'string'
        ? lastUserMsg.content.slice(0, 100)
        : '(复杂内容)';
      agentLog(`[AgentLoop] 用户问题: "${contentPreview}${contentPreview.length >= 100 ? '...' : ''}"`);
    }

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
      agentLog(`[AgentLoop] 完成. finishReason=${finishReason}, 内容长度=${accumulatedContent.length}`);

      // 调用内容完成回调（用于链接校验和熟悉度更新）
      if (options.onContentComplete && accumulatedContent) {
        try {
          await options.onContentComplete(accumulatedContent);
        } catch (err) {
          agentLog('[AgentLoop] onContentComplete 回调失败:', err);
        }
      }

      options.onComplete();
      break;
    }

    // 详细的工具调用日志
    agentLog(`\n${'─'.repeat(60)}`);
    agentLog(`[AgentLoop] 🤖 LLM 决定调用 ${toolCalls.length} 个工具:`);
    toolCalls.forEach((tc, idx) => {
      agentLog(`  [${idx + 1}] ${tc.name}`);
      // 尝试解析参数并显示关键信息
      try {
        const args = JSON.parse(tc.arguments);
        const keyParams = Object.entries(args)
          .slice(0, 3) // 最多显示3个参数
          .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v.slice(0, 30)}${v.length > 30 ? '...' : ''}"` : JSON.stringify(v)}`)
          .join(', ');
        agentLog(`      参数: ${keyParams}${Object.keys(args).length > 3 ? ', ...' : ''}`);
      } catch {
        agentLog(`      参数: (解析失败)`);
      }
    });
    agentLog(`${'─'.repeat(60)}\n`);

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
      const startTime = Date.now();
      agentLog(`\n[AgentLoop] ▶ 开始执行: ${tc.name}`);
      options.onProgress(`正在执行: ${tc.name}...`);

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        args = {};
      }

      try {
        const result = await executeTool(toolRegistry, tc.name, args, context);
        const duration = Date.now() - startTime;

        // 简洁的成功日志
        const resultPreview = result.length > 100
          ? `${result.slice(0, 100)}... (${result.length} chars)`
          : result;
        agentLog(`[AgentLoop] ✓ 完成: ${tc.name} (${duration}ms) → ${resultPreview}`);

        // 检查是否返回了隐藏消息（用于用户画像更新等）
        try {
          const parsed = JSON.parse(result);
          if (parsed.success && parsed.hiddenMessage) {
            // 注入隐藏消息到对话历史（不显示但发送给 LLM）
            workingMessages.push({
              role: parsed.hiddenMessage.role,
              content: parsed.hiddenMessage.content,
              hidden: true,
            });
            agentLog(`[AgentLoop] 📝 隐藏消息: "${parsed.hiddenMessage.content.slice(0, 50)}..."`);
          }
        } catch {
          // 不是 JSON 格式，正常处理
        }

        // 添加 tool result 消息
        workingMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : String(error);
        agentLog(`[AgentLoop] ✗ 失败: ${tc.name} (${duration}ms) → ${errorMsg}`);

        // 添加错误结果
        workingMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `Error: ${errorMsg}`,
        });
      }
    }
  }

  if (iterations >= maxIterations) {
    agentLog('[AgentLoop] ⚠️ 达到最大迭代次数，即将结束');
    options.onProgress('达到最大轮数，正在总结...');
  }

  return workingMessages;
}
