/**
 * 共享工具执行逻辑
 *
 * ReAct Loop 和 Plan-Execute 共用的工具调用执行、
 * 结果压缩、block_id 提取等功能。
 */

import { ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ChatOpenAI } from '@langchain/openai';
import { MAX_TOOL_RESULT_LENGTH, MAX_FULL_TOOL_MESSAGES, TOOL_EXECUTION_TIMEOUT_MS } from '../../config/agent-constants.js';
import type { ToolCallLike } from '../utils/tool-call-parser.js';
import { parseToolCallArgs } from '../utils/tool-call-parser.js';

// ============ Types ============

export interface ToolResultRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  originalResultLength: number;
  /** Extracted block_ids from result (for verification after compression) */
  extractedBlockIds?: string[];
}

export interface SubgraphConfig {
  tools: StructuredToolInterface[];
  model: ChatOpenAI;
  maxIterations: number;
  maxToolCalls: number;
  /** Forced conclusion context (book name + scope) */
  forcedConclusionContext?: {
    pdfName?: string;
    scopeNodeIds?: string[];
  };
  /** Tool argument interceptor (e.g. scope_node_ids injection) */
  toolInterceptor?: (toolName: string, args: Record<string, unknown>) => Record<string, unknown>;
  /** Abort signal for cancellation / timeout */
  signal?: AbortSignal;
  /** Progress callback for UI notifications (e.g. plan complexity) */
  onProgress?: (message: string) => void;
}

export interface SubgraphResult {
  content: string;
  toolResults: ToolResultRecord[];
  iterations: number;
  finishReason: 'stop' | 'max_iterations' | 'max_tool_calls' | 'loop_detected';
}

// ============ Compression ============

export function compressToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_LENGTH) return result;
  const truncated = result.slice(0, MAX_TOOL_RESULT_LENGTH);
  const omitted = result.length - MAX_TOOL_RESULT_LENGTH;
  return `${truncated}\n\n... [已省略 ${omitted} 字符]`;
}

export function extractBlockIdsFromResult(result: string): string[] {
  const ids: string[] = [];
  let match: RegExpExecArray | null;

  const jsonPattern = /"block_?[Ii]d"\s*:\s*"([a-zA-Z0-9_-]+)"/g;
  while ((match = jsonPattern.exec(result)) !== null) {
    ids.push(match[1]);
  }

  const textPattern = /(?:^|\s)\^([a-zA-Z0-9_-]+)(?=\s|$)/gm;
  while ((match = textPattern.exec(result)) !== null) {
    ids.push(match[1]);
  }

  return [...new Set(ids)];
}

export function compressMessagesForLLM(messages: BaseMessage[]): BaseMessage[] {
  if (messages.length <= 4) return messages;

  const toolMsgIndices: number[] = [];
  messages.forEach((m, i) => { if (m instanceof ToolMessage) toolMsgIndices.push(i); });

  if (toolMsgIndices.length <= MAX_FULL_TOOL_MESSAGES) return messages;

  const compressIndices = new Set(toolMsgIndices.slice(0, -MAX_FULL_TOOL_MESSAGES));

  return messages.map((m, i) => {
    if (!compressIndices.has(i) || !(m instanceof ToolMessage)) return m;
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const summary = content.length > 150 ? content.slice(0, 150) + '...' : content;
    return new ToolMessage({
      content: `[已压缩] ${summary}`,
      tool_call_id: m.tool_call_id,
    });
  });
}

// ============ Tool Execution ============

interface SingleToolResult {
  msg: ToolMessage;
  record: ToolResultRecord | null;
}

/**
 * 工具执行超时包裹：在唯一执行落点 race，覆盖单工具（executeSingleToolCall）
 * 与批量（executeToolBatch → Promise.all）两条路径。超时 reject 会被
 * executeSingleToolCall 的 try/catch 捕捉，转成 ToolMessage 错误，不会拖垮整轮。
 */
function invokeWithTimeout(
  tool: StructuredToolInterface,
  args: Record<string, unknown>,
  runnableConfig?: RunnableConfig,
): Promise<unknown> {
  const timer = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Tool "${tool.name}" timed out after ${TOOL_EXECUTION_TIMEOUT_MS}ms`)),
      TOOL_EXECUTION_TIMEOUT_MS,
    ),
  );
  return Promise.race([tool.invoke(args, runnableConfig), timer]);
}

export async function executeSingleToolCall(
  tc: ToolCallLike,
  tools: StructuredToolInterface[],
  interceptor: ((toolName: string, args: Record<string, unknown>) => Record<string, unknown>) | undefined,
  runnableConfig?: RunnableConfig,
): Promise<SingleToolResult> {
  const tcId = tc.id ?? `fallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const parsedArgs = parseToolCallArgs(tc);

  if ('_parseError' in parsedArgs) {
    return {
      msg: new ToolMessage({ content: `Error: Failed to parse tool arguments: ${parsedArgs._raw}`, tool_call_id: tcId }),
      record: null,
    };
  }

  let args = parsedArgs;
  const toolName = tc.name ?? tc.function?.name ?? '';
  if (interceptor) {
    args = interceptor(toolName, args);
  }

  const tool = tools.find(t => t.name === toolName);
  if (!tool) {
    return {
      msg: new ToolMessage({ content: `Error: Unknown tool "${toolName}"`, tool_call_id: tcId }),
      record: null,
    };
  }

  try {
    const rawResult = await invokeWithTimeout(tool, args, runnableConfig);
    const resultStr = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
    const compressed = compressToolResult(resultStr);
    const extractedBlockIds = extractBlockIdsFromResult(resultStr);
    return {
      msg: new ToolMessage({ content: compressed, tool_call_id: tcId }),
      record: { toolName, args, result: compressed, originalResultLength: resultStr.length, extractedBlockIds } as ToolResultRecord,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      msg: new ToolMessage({ content: `Error: ${errorMsg}`, tool_call_id: tcId }),
      record: null,
    };
  }
}

export async function executeToolBatch(
  toolCalls: ToolCallLike[],
  tools: StructuredToolInterface[],
  config: SubgraphConfig,
  runnableConfig?: RunnableConfig,
): Promise<{ messages: ToolMessage[]; records: ToolResultRecord[] }> {
  const execResults = await Promise.all(
    toolCalls.map(tc => executeSingleToolCall(tc, tools, config.toolInterceptor, runnableConfig))
  );
  const msgs: ToolMessage[] = [];
  const records: ToolResultRecord[] = [];
  for (const r of execResults) {
    if (r.msg) msgs.push(r.msg);
    if (r.record) records.push(r.record);
  }
  return { messages: msgs, records };
}

// ============ Progress Reporting ============

export function reportPlan(
  config: SubgraphConfig,
  toolCalls: ToolCallLike[],
  round: number,
  maxPlanRounds: number,
): void {
  if (!config.onProgress) return;

  const searches = toolCalls.filter(tc => tc.name === 'search_book').length;
  const reads = toolCalls.filter(tc => tc.name === 'read_book_section').length;
  const total = toolCalls.length;

  if (total === 0) return;

  const roundHint = round === 0 ? '首次' : '再次';

  if (searches > 0 && reads > 0) {
    config.onProgress(`${roundHint}翻找相关段落，找到 ${searches} 处，精读 ${reads} 个章节...`);
  } else if (reads > 0) {
    config.onProgress(`${roundHint}精读 ${reads} 个章节...`);
  } else if (searches > 0) {
    config.onProgress(`${roundHint}翻找 ${searches} 个关键词...`);
  } else {
    config.onProgress(`${roundHint}查阅...`);
  }
}
