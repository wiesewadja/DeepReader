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
  /**
   * 记忆整合回调（可选）
   * 当检测到需要整合时调用，传入当前消息和 lastConsolidated 索引
   * 返回新的 lastConsolidated 索引
   */
  onMemoryConsolidation?: (messages: ChatMessage[], lastConsolidated: number) => Promise<number>;
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
  const llmPercent = Math.round((metrics.llmMs / metrics.totalMs) * 100);
  const toolsPercent = Math.round((metrics.toolsMs / metrics.totalMs) * 100);
  const tokenDelta = metrics.tokenEstimate.end - metrics.tokenEstimate.start;

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                            📊 Agent 性能分析报告                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
│ 用户问题: ${metrics.userQuestion.slice(0, 60).padEnd(60)}│
├──────────────────────────────────────────────────────────────────────────────┤
│ ⏱️  总耗时: ${(metrics.totalMs / 1000).toFixed(1)}s                                                            │
│    ├─ 🤖 LLM 调用: ${(metrics.llmMs / 1000).toFixed(1)}s (${llmPercent}%)                                            │
│    └─ 🔧 工具执行: ${(metrics.toolsMs / 1000).toFixed(1)}s (${toolsPercent}%)                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ 📦 Token 估算: ${metrics.tokenEstimate.start} → ${metrics.tokenEstimate.end} (${tokenDelta >= 0 ? '+' : ''}${tokenDelta})                                    │
│ 🔄 迭代次数: ${metrics.iterations}                                                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ 🔧 工具调用详情:                                                              │`.trim());

  if (metrics.toolCalls.length === 0) {
    console.log('│    (无)                                                                      │');
  } else {
    metrics.toolCalls.forEach((tc, idx) => {
      const compressed = tc.resultChars !== tc.compressedChars
        ? ` → ${tc.compressedChars} (压缩 ${(100 - Math.round(tc.compressedChars / tc.resultChars * 100))}%)`
        : '';
      console.log(`│    [${idx + 1}] ${tc.name.padEnd(20)} ${(tc.duration / 1000).toFixed(1)}s, ${tc.resultChars}字符${compressed}`);
    });
  }

  console.log(`╚══════════════════════════════════════════════════════════════════════════════╝
`);
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
 * 性能优化常量
 */
const MAX_TOOL_RESULT_LENGTH = 8000;  // 工具结果最大长度（字符）
const MAX_CONTEXT_TOKENS = 40000;     // 消息历史最大 token 数

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
  let workingMessages = [...messages];
  let hadError = false; // 跟踪是否发生了错误

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

    // 依次执行每个 tool call
    const toolsStartTime = Date.now();
    for (const tc of toolCalls) {
      const toolStartTime = Date.now();
      agentLog(`\n[AgentLoop] ▶ 执行: ${tc.name}`);

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        args = {};
      }

      try {
        const result = await executeTool(toolRegistry, tc.name, args, context);
        const duration = Date.now() - toolStartTime;
        const resultLength = result.length;

        // 压缩工具结果（防止 token 膨胀）
        const compressedResult = compressToolResult(result);
        const compressedLength = compressedResult.length;

        // 记录工具调用指标
        toolCallMetrics.push({
          name: tc.name,
          duration,
          resultChars: resultLength,
          compressedChars: compressedLength,
        });

        // 日志
        agentLog(`[AgentLoop] ✓ ${tc.name}: ${formatDuration(duration)}, ${resultLength}字符${resultLength !== compressedLength ? ` → ${compressedLength} (压缩${Math.round((1 - compressedLength / resultLength) * 100)}%)` : ''}`);

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
          content: compressedResult,
        });
      } catch (error) {
        const duration = Date.now() - toolStartTime;
        const errorMsg = error instanceof Error ? error.message : String(error);

        // 记录失败的工具调用指标
        toolCallMetrics.push({
          name: tc.name,
          duration,
          resultChars: 0,
          compressedChars: 0,
        });

        agentLog(`[AgentLoop] ✗ 失败: ${tc.name} (${formatDuration(duration)}) → ${errorMsg}`);

        // 添加错误结果
        workingMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `Error: ${errorMsg}`,
        });
      }
    }
    const toolsDuration = Date.now() - toolsStartTime;
    toolsTotalTime += toolsDuration;

    // 迭代结束统计
    const iterationDuration = Date.now() - iterationStartTime;
    agentLog(`\n[AgentLoop] 📊 迭代 ${iterations} 完成，耗时: ${formatDuration(iterationDuration)}`);
    agentLog(`[AgentLoop] 📊 当前消息历史: ${workingMessages.length} 条, 估算 tokens: ~${estimateTokens(workingMessages)}`);

    // 管理消息历史（防止 token 无限增长）
    workingMessages = manageMessageHistory(workingMessages);
  }

  if (iterations >= maxIterations) {
    agentLog('[AgentLoop] ⚠️ 达到最大迭代次数，即将结束');
    options.onProgress('达到最大轮数，正在总结...');
  }

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
