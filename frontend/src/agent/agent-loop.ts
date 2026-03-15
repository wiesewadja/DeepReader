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
} from './utils/link-validator.js';
import { HumanizedProgressAdapter } from './ui/humanized-adapter.js';
import type { HumanizedProgress } from './ui/humanized-types.js';

// 导出日志函数供控制台使用
export { setModuleEnabled, setModulesEnabled, getModuleConfig } from '../utils/logger';

export interface AgentLoopOptions {
  maxIterations?: number; // default 6 (reduced from 20 for faster response)
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
  /**
   * 拟人化进度回调（可选）
   * 用于在 UI 中显示用户友好的状态
   */
  onHumanizedProgress?: (progress: HumanizedProgress) => void;
}

// ============================================================================
// 性能分析日志系统
// ============================================================================

interface PerformanceMetrics {
  totalMs: number;
  llmMs: number;
  toolsMs: number;
  iterations: number;
  toolCalls: Array<{ name: string; duration: number; resultChars: number; compressedChars: number }>;
  tokenEstimate: { start: number; end: number };
  userQuestion: string;
}

/**
 * 打印清晰简洁的性能分析报告
 */
function printPerformanceReport(metrics: PerformanceMetrics): void {
  // 使用 agentLog 而不是 console.log，确保日志可控
  agentLog('╔══════════════════════════════════════════════════════════════════════════════╗');
  agentLog('║                            📊 Agent 性能分析报告                              ║');
  agentLog('╠══════════════════════════════════════════════════════════════════════════════╣');

  const questionPreview = metrics.userQuestion.length > 55
    ? metrics.userQuestion.slice(0, 55) + '...'
    : metrics.userQuestion;
  agentLog(`║ 用户问题: ${questionPreview.padEnd(69)}║`);

  agentLog('├──────────────────────────────────────────────────────────────────────────────┤');

  const llmPercent = Math.round((metrics.llmMs / metrics.totalMs) * 100);
  const toolsPercent = Math.round((metrics.toolsMs / metrics.totalMs) * 100);
  const tokenDelta = metrics.tokenEstimate.end - metrics.tokenEstimate.start;

  agentLog(`║ ⏱️  总耗时: ${(metrics.totalMs / 1000).toFixed(1)}s                                                              ║`);
  agentLog(`║    ├─ 🤖 LLM 调用: ${(metrics.llmMs / 1000).toFixed(1)}s (${llmPercent}%)                                            ║`);
  agentLog(`║    └─ 🔧 工具执行: ${(metrics.toolsMs / 1000).toFixed(1)}s (${toolsPercent}%)                                            ║`);
  agentLog('├──────────────────────────────────────────────────────────────────────────────┤');
  agentLog(`║ 📦 Token 估算: ${metrics.tokenEstimate.start} → ${metrics.tokenEstimate.end} (${tokenDelta >= 0 ? '+' : ''}${tokenDelta})`.padEnd(69) + '║');
  agentLog(`║ 🔄 迭代次数: ${metrics.iterations}`.padEnd(69) + '║');
  agentLog('├──────────────────────────────────────────────────────────────────────────────┤');
  agentLog('║ 🔧 工具调用详情:                                                              ║');

  if (metrics.toolCalls.length === 0) {
    agentLog('║    (无工具调用)                                                              ║');
  } else {
    metrics.toolCalls.forEach((tc, idx) => {
      const compressed = tc.resultChars !== tc.compressedChars
        ? ` → ${tc.compressedChars} (压缩 ${100 - Math.round(tc.compressedChars / tc.resultChars * 100)}%)`
        : '';
      const line = `║    [${idx + 1}] ${tc.name.padEnd(18)} ${(tc.duration / 1000).toFixed(1)}s, ${tc.resultChars}字符${compressed}`;
      agentLog(line.padEnd(78) + '║');
    });
  }

  agentLog('╚══════════════════════════════════════════════════════════════════════════════╝');
}

/**
 * 格式化耗时（毫秒转换为可读格式）
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

/**
 * 估算消息历史的 token 数（粗略估算：1 token ≈ 1.5 中文字符或 4 英文字符）
 */
export function estimateTokens(messages: ChatMessage[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    }
    // 工具调用和结果也计入
    if (msg.tool_calls) {
      totalChars += JSON.stringify(msg.tool_calls).length;
    }
  }
  // 粗略估算：中文字符/1.5 + 英文字符/4
  return Math.round(totalChars / 2);
}

/**
 * 延迟函数（用于重试退避）
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 性能优化常量
 */
const MAX_TOOL_RESULT_LENGTH = 4000;  // 工具结果最大长度（字符）- 降低以减少 token 膨胀
const MAX_CONTEXT_TOKENS = 20000;     // 消息历史最大 token 数 - 降低以更早触发压缩
const TOOL_MAX_RETRIES = 2;           // 工具失败最大重试次数

/**
 * 压缩工具结果（防止 token 膨胀）
 */
function compressToolResult(result: string, maxLength: number = MAX_TOOL_RESULT_LENGTH): string {
  if (result.length <= maxLength) {
    return result;
  }
  const truncated = result.slice(0, maxLength);
  const omitted = result.length - maxLength;
  return `${truncated}\n\n... [已省略 ${omitted} 字符，完整内容可再次查询]`;
}

/**
 * 管理消息历史（防止 token 无限增长）
 *
 * 策略：
 * 1. 保留系统消息和最新的用户消息
 * 2. 压缩旧的工具调用结果
 * 3. 移除过期的隐藏消息
 */
function manageMessageHistory(messages: ChatMessage[]): ChatMessage[] {
  const currentTokens = estimateTokens(messages);

  if (currentTokens <= MAX_CONTEXT_TOKENS) {
    return messages;
  }

  agentLog(`[AgentLoop] ⚠️ Token 超限 (${currentTokens} > ${MAX_CONTEXT_TOKENS})，开始压缩历史...`);

  const managedMessages: ChatMessage[] = [];
  let savedTokens = 0;
  const targetTokens = MAX_CONTEXT_TOKENS * 0.8; // 压缩到 80%

  // 从后往前处理，保留最新的消息
  const reversedMessages = [...messages].reverse();

  for (const msg of reversedMessages) {
    const msgTokens = estimateTokens([msg]);

    // 如果已经节省了足够的 token，直接保留剩余消息
    if (savedTokens >= currentTokens - targetTokens) {
      managedMessages.unshift(msg);
      continue;
    }

    // 处理 tool 结果消息 - 进一步压缩
    if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 2000) {
      const furtherCompressed = compressToolResult(msg.content, 2000);
      managedMessages.unshift({
        ...msg,
        content: furtherCompressed,
      });
      savedTokens += msgTokens - estimateTokens([{ ...msg, content: furtherCompressed }]);
      continue;
    }

    // 移除旧的隐藏消息（不重要的上下文）
    if (msg.hidden) {
      savedTokens += msgTokens;
      agentLog(`[AgentLoop] 🗑️ 移除隐藏消息: "${msg.content?.slice(0, 30)}..."`);
      continue;
    }

    // 其他消息直接保留
    managedMessages.unshift(msg);
  }

  const newTokens = estimateTokens(managedMessages);
  agentLog(`[AgentLoop] ✅ 嶈息历史压缩完成: ${messages.length} -> ${managedMessages.length} 条, ${currentTokens} -> ${newTokens} tokens`);

  return managedMessages;
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
 * 4. 最多执行 20 轮
 */
export async function runAgentLoop(
  client: LLMClient,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  toolRegistry: ToolRegistry,
  context: ToolContext,
  options: AgentLoopOptions
): Promise<ChatMessage[]> {
  const maxIterations = options.maxIterations || 10;  // Balanced for complex tasks with skills
  let iterations = 0;
  let workingMessages = [...messages];
  let hadError = false; // 跟踪是否发生了错误
  let completedNormally = false; // 跟踪是否正常完成（非强制总结）

  // 拟人化进度适配器（可选）
  const humanizer = options.onHumanizedProgress
    ? new HumanizedProgressAdapter()
    : null;

  agentLog(`[AgentLoop] humanizer 状态: ${humanizer ? '已创建' : '未创建'}, onHumanizedProgress: ${options.onHumanizedProgress ? '已提供' : '未提供'}`);

  // 设置 markdown 文件映射（用于显示章节名称）
  if (humanizer && context.markdownFiles) {
    humanizer.setMarkdownFiles(context.markdownFiles);
  }

  // 🕐 总计时
  const totalStartTime = Date.now();
  let llmTotalTime = 0;      // LLM 调用总耗时
  let toolsTotalTime = 0;     // 工具执行总耗时

  // 📊 性能指标收集
  const startTokens = estimateTokens(workingMessages);
  const toolCallMetrics: Array<{ name: string; duration: number; resultChars: number; compressedChars: number }> = [];

  // 提取用户问题（用于报告）
  const userQuestion = [...messages].reverse().find(m => m.role === 'user');
  const questionText = typeof userQuestion?.content === 'string'
    ? userQuestion.content.slice(0, 60)
    : '(复杂内容)';

  // 初始化拟人化状态
  if (humanizer) {
    humanizer.setIteration(0, maxIterations);
    options.onHumanizedProgress?.(humanizer.toHumanizedProgress());
  }

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
    const iterationStartTime = Date.now();

    // 更新拟人化状态
    if (humanizer) {
      humanizer.setIteration(iterations, maxIterations);
      options.onHumanizedProgress?.(humanizer.toHumanizedProgress());
    }

    // 迭代开始（简洁日志）
    agentLog(`\n[AgentLoop] ┓ agentsetIterationContext 迭代 ${iterations}/${maxIterations}`);

    let accumulatedContent = '';
    let finishReason: 'stop' | 'tool_calls' | 'length' | null = null;
    let toolCalls: { id: string; name: string; arguments: string }[] = [];

    // 🕐 调用 LLM（流式）- 记录耗时
    const llmStartTime = Date.now();
    agentLog(`[AgentLoop] 🤖 开始调用 LLM...`);

    await new Promise<void>((resolve) => {
      client.streamChat(
        workingMessages,
        tools,
        {
          onContent: (text) => {
            accumulatedContent += text;
            options.onContent(text);
            // 更新拟人化内容状态
            if (humanizer) {
              humanizer.updateContent(accumulatedContent);
              options.onHumanizedProgress?.(humanizer.toHumanizedProgress());
            }
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

    const llmDuration = Date.now() - llmStartTime;
    llmTotalTime += llmDuration;
    agentLog(`[AgentLoop] 🤖 LLM 响应完成: ${formatDuration(llmDuration)}, finishReason=${finishReason}`);

    // 如果没有 tool_calls，循环结束
    if (finishReason !== 'tool_calls' || toolCalls.length === 0) {
      const iterationDuration = Date.now() - iterationStartTime;
      const totalDuration = Date.now() - totalStartTime;

      agentLog(`\n[AgentLoop] ✅ 对话完成`);
      agentLog(`[AgentLoop] 📊 本轮耗时: ${formatDuration(iterationDuration)}`);
      agentLog(`[AgentLoop] 📊 总耗时: ${formatDuration(totalDuration)} (LLM: ${formatDuration(llmTotalTime)}, 工具: ${formatDuration(toolsTotalTime)})`);
      agentLog(`[AgentLoop] 📊 回复长度: ${accumulatedContent.length} 字符`);

      // 调用内容完成回调（用于链接校验和熟悉度更新）
      if (options.onContentComplete && accumulatedContent) {
        try {
          const correctedContent = await options.onContentComplete(accumulatedContent);
          // 如果回调返回了纠正后的内容，使用纠正后的版本
          if (correctedContent && correctedContent !== accumulatedContent) {
            accumulatedContent = correctedContent;
          }
        } catch (err) {
          agentLog('[AgentLoop] onContentComplete 回调失败:', err);
        }
      }

      // 将最终的 assistant 消息添加到历史（关键：确保最终回复被保存）
      if (accumulatedContent) {
        workingMessages.push({
          role: 'assistant',
          content: accumulatedContent,
        });
      }

      options.onComplete();
      completedNormally = true;  // 标记为正常完成
      break;
    }

    // 详细的工具调用日志
    agentLog(`\n${'─'.repeat(60)}`);
    agentLog(`[AgentLoop] 🔧 LLM 决定调用 ${toolCalls.length} 个工具:`);
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

    // 🚀 并行执行所有 tool calls（而非串行）
    const toolsStartTime = Date.now();

    // 记录所有工具调用开始（拟人化）
    const toolCallIds: string[] = [];
    for (const tc of toolCalls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        args = {};
      }
      agentLog(`\n[AgentLoop] ▶ 执行: ${tc.name}`);
      if (humanizer) {
        const id = humanizer.recordToolStart(tc.name, args);
        toolCallIds.push(id || tc.name);
        const progress = humanizer.toHumanizedProgress();
        agentLog(`[AgentLoop] onHumanizedProgress 调用: mainAction=${progress.mainAction.detail}`);
        options.onHumanizedProgress?.(progress);
      }
    }

    // 并行执行所有工具
    const toolResults = await Promise.all(
      toolCalls.map(async (tc, index) => {
        const toolStartTime = Date.now();

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.arguments);
        } catch {
          args = {};
        }

        try {
          // 工具执行（带重试机制）
          let result: string | null = null;
          let lastError: Error | null = null;

          for (let attempt = 0; attempt <= TOOL_MAX_RETRIES; attempt++) {
            try {
              result = await executeTool(toolRegistry, tc.name, args, context);
              break;
            } catch (error) {
              lastError = error as Error;
              if (attempt < TOOL_MAX_RETRIES) {
                const delayMs = 1000 * (attempt + 1);
                agentLog(`[AgentLoop] ⚠️ 工具失败，重试 ${attempt + 1}/${TOOL_MAX_RETRIES}... (${tc.name})`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
              }
            }
          }

          if (result === null) {
            throw lastError;
          }

          const duration = Date.now() - toolStartTime;
          const resultLength = result.length;

          return {
            success: true,
            toolCallId: tc.id,
            toolName: tc.name,
            humanizerId: toolCallIds[index],
            result,
            duration,
            resultLength,
          };
        } catch (error) {
          const duration = Date.now() - toolStartTime;
          const errorMsg = error instanceof Error ? error.message : String(error);

          return {
            success: false,
            toolCallId: tc.id,
            toolName: tc.name,
            humanizerId: toolCallIds[index],
            error: errorMsg,
            duration,
          };
        }
      })
    );

    // 处理所有结果
    for (const res of toolResults) {
      if (res.success) {
        // 记录工具调用指标
        toolCallMetrics.push({
          name: res.toolName,
          duration: res.duration,
          resultChars: res.resultLength!,
          compressedChars: res.resultLength!,
        });

        // 记录工具调用完成（拟人化）
        if (humanizer) {
          humanizer.recordToolComplete(res.humanizerId, res.duration);
          options.onHumanizedProgress?.(humanizer.toHumanizedProgress());
        }

        agentLog(`[AgentLoop] ✓ ${res.toolName}: ${formatDuration(res.duration)}, ${res.resultLength || 0}字符`);

        // 检查是否返回了隐藏消息
        try {
          const parsed = JSON.parse(res.result!);
          if (parsed.success && parsed.hiddenMessage) {
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
          tool_call_id: res.toolCallId,
          content: res.result!,
        });
      } else {
        // 记录失败的工具调用指标
        toolCallMetrics.push({
          name: res.toolName,
          duration: res.duration,
          resultChars: 0,
          compressedChars: 0,
        });

        // 记录工具调用失败（拟人化）
        if (humanizer) {
          humanizer.recordToolFailed(res.humanizerId);
          options.onHumanizedProgress?.(humanizer.toHumanizedProgress());
        }

        agentLog(`[AgentLoop] ✗ 失败: ${res.toolName} (${formatDuration(res.duration)}) → ${res.error}`);

        workingMessages.push({
          role: 'tool',
          tool_call_id: res.toolCallId,
          content: `Error: ${res.error}\n\n请尝试其他方法，或简化你的请求。`,
        });
      }
    }

    const toolsDuration = Date.now() - toolsStartTime;
    toolsTotalTime += toolsDuration;

    // 迭代结束统计
    const iterationDuration = Date.now() - iterationStartTime;
    agentLog(`\n[AgentLoop] 📊 迭代 ${iterations} 完成，耗时: ${formatDuration(iterationDuration)} (并行执行 ${toolCalls.length} 个工具)`);
    agentLog(`[AgentLoop] 📊 当前消息历史: ${workingMessages.length} 条, 估算 tokens: ~${estimateTokens(workingMessages)}`);

    // 🔄 循环内压缩： 当 token 超过阈值时，提前压缩以保持上下文大小可控
    const currentTokens = estimateTokens(workingMessages);
    if (currentTokens > MAX_CONTEXT_TOKENS) {
      agentLog(`[AgentLoop] ⚠️ Token 超限 (${currentTokens} > ${MAX_CONTEXT_TOKENS})，执行循环内压缩...`);
      workingMessages = manageMessageHistory(workingMessages);
      agentLog(`[AgentLoop] ✅ 压缩后: ${workingMessages.length} 条, tokens: ~${estimateTokens(workingMessages)}`);
    }
  }

  // 只有在非正常完成且达到最大迭代次数时才强制总结
  if (!completedNormally && iterations >= maxIterations) {
    agentLog('[AgentLoop] ⚠️ 达到最大迭代次数，强制生成总结...');

    // 强制生成总结性回复
    const forceSummaryMessage: ChatMessage = {
      role: 'user',
      content: '基于已收集的信息，请立即给出你的回答。使用已获取的资料，不要继续搜索。',
    };
    workingMessages.push(forceSummaryMessage);

    let summaryContent = '';
    let summaryFinishReason: 'stop' | 'tool_calls' | 'length' = 'stop';

    const summaryStartTime = Date.now();
    agentLog('[AgentLoop] 🤖 开始强制总结调用...');

    await new Promise<void>((resolve) => {
      client.streamChat(
        workingMessages,
        [], // 不传工具，强制 LLM 直接回复
        {
          onContent: (text) => {
            summaryContent += text;
            options.onContent(text);
          },
          onToolCall: () => {
            // 不应该有工具调用，因为没传工具
          },
          onComplete: (reason) => {
            summaryFinishReason = reason;
            resolve();
          },
          onError: (error) => {
            options.onError(error);
            resolve();
          },
        },
        { signal: options.abortSignal }
      );
    });

    const summaryDuration = Date.now() - summaryStartTime;
    llmTotalTime += summaryDuration;
    agentLog(`[AgentLoop] 🤖 强制总结完成: ${formatDuration(summaryDuration)}, 内容长度: ${summaryContent.length}`);

    // 添加总结消息到历史
    if (summaryContent) {
      workingMessages.push({
        role: 'assistant',
        content: summaryContent,
      });

      // 调用内容完成回调
      if (options.onContentComplete) {
        try {
          const correctedContent = await options.onContentComplete(summaryContent);
          if (correctedContent && correctedContent !== summaryContent) {
            summaryContent = correctedContent;
          }
        } catch (err) {
          agentLog('[AgentLoop] onContentComplete 回调失败:', err);
        }
      }
    }

    options.onComplete();
  }

  // 循环结束后统一管理消息历史（防止 token 无限增长）
  // 保留对话过程中的完整上下文，只在最后压缩
  workingMessages = manageMessageHistory(workingMessages);
  agentLog(`[AgentLoop] 📊 最终消息历史: ${workingMessages.length} 条`);

  // 最终统计 - 打印清晰的性能报告
  const totalDuration = Date.now() - totalStartTime;
  const endTokens = estimateTokens(workingMessages);

  const metrics: PerformanceMetrics = {
    totalMs: totalDuration,
    llmMs: llmTotalTime,
    toolsMs: toolsTotalTime,
    iterations: iterations,
    toolCalls: toolCallMetrics,
    tokenEstimate: { start: startTokens, end: endTokens },
    userQuestion: questionText,
  };
  printPerformanceReport(metrics);

  return workingMessages;
}
