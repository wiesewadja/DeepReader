/**
 * ReAct Loop Subgraph
 *
 * Replaces runStateLoop() with a LangGraph StateGraph.
 * Supports: tool calling, loop detection, forced conclusion,
 * and iteration/tool-call limits.
 */

import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import { verifyAndCleanContent } from '../utils/self-verification.js';

// === State Definition ===

export interface ToolResultRecord {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  originalResultLength: number;
  /** Extracted block_ids from result (for verification after compression) */
  extractedBlockIds?: string[];
}

export interface ReactLoopConfig {
  tools: StructuredToolInterface[];
  model: any; // ChatOpenAI instance
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

const ReactAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  iterationCount: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 0,
  }),
  toolCallCount: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 0,
  }),
  /** Queries asked per tool (for loop detection) */
  queriesAsked: Annotation<Record<string, string[]>>({
    reducer: (_, update) => update,
    default: () => ({}),
  }),
  /** Accumulated tool results for self-verification */
  toolResults: Annotation<ToolResultRecord[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),
  /** Limits passed through state for shouldContinue access */
  _maxIterations: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 8,
  }),
  _maxToolCalls: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 5,
  }),
});

type ReactState = typeof ReactAnnotation.State;

// === Max tool result length ===
const MAX_TOOL_RESULT_LENGTH = 4000;
/** Keep at most this many full ToolMessages; older ones are compressed */
const MAX_FULL_TOOL_MESSAGES = 2;

function compressToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_LENGTH) return result;
  const truncated = result.slice(0, MAX_TOOL_RESULT_LENGTH);
  const omitted = result.length - MAX_TOOL_RESULT_LENGTH;
  return `${truncated}\n\n... [已省略 ${omitted} 字符]`;
}

function extractBlockIdsFromResult(result: string): string[] {
  const ids: string[] = [];
  let match: RegExpExecArray | null;

  // 1. JSON 格式："block_id": "xxx" 或 "blockId": "xxx"
  const jsonPattern = /"block_?[Ii]d"\s*:\s*"([a-zA-Z0-9_-]+)"/g;
  while ((match = jsonPattern.exec(result)) !== null) {
    ids.push(match[1]);
  }

  // 2. Obsidian 文本格式：^blockId（裸露的脱字号）
  const textPattern = /(?:^|\s)\^([a-zA-Z0-9_-]+)(?=\s|$)/gm;
  while ((match = textPattern.exec(result)) !== null) {
    ids.push(match[1]);
  }

  return [...new Set(ids)];
}

/**
 * Compress old ToolMessages to one-line summaries, keeping only the latest N full.
 * SystemMessage and HumanMessage are always preserved.
 */
function compressMessagesForLLM(messages: BaseMessage[]): BaseMessage[] {
  if (messages.length <= 4) return messages; // too few to bother

  const toolMsgIndices: number[] = [];
  messages.forEach((m, i) => { if (m instanceof ToolMessage) toolMsgIndices.push(i); });

  if (toolMsgIndices.length <= MAX_FULL_TOOL_MESSAGES) return messages;

  // Indices to compress (all except the last MAX_FULL_TOOL_MESSAGES)
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

// === Loop Detection ===

function extractQueryKey(toolName: string, args: Record<string, unknown>): string | null {
  if ('query' in args) return String(args.query);
  if ('keywords' in args && Array.isArray(args.keywords)) {
    return [...(args.keywords as unknown[])].map(String).sort().join(',');
  }
  return null;
}

function hasLoopDetected(
  toolName: string,
  args: Record<string, unknown>,
  queriesAsked: Record<string, string[]>,
): boolean {
  const key = extractQueryKey(toolName, args);
  if (key === null) return false;
  const history = queriesAsked[toolName] ?? [];
  return history.includes(key);
}

function updateQueriesAsked(
  queriesAsked: Record<string, string[]>,
  toolName: string,
  args: Record<string, unknown>,
): Record<string, string[]> {
  const key = extractQueryKey(toolName, args);
  if (key === null) return queriesAsked;
  const history = queriesAsked[toolName] ?? [];
  if (history.includes(key)) return queriesAsked;
  return { ...queriesAsked, [toolName]: [...history, key] };
}

// === Agent Node ===

/** Parse tool call args, handling string-encoded JSON */
function parseToolCallArgs(tc: { args: string | Record<string, unknown> }): Record<string, unknown> | { _parseError: true; _raw: string } {
  try {
    return typeof tc.args === 'string' ? JSON.parse(tc.args) : tc.args;
  } catch {
    return { _parseError: true, _raw: String(tc.args) };
  }
}

async function agentNode(
  state: ReactState,
  config: RunnableConfig,
): Promise<Partial<ReactState>> {
  const reactConfig = config.configurable?.reactLoopConfig as ReactLoopConfig;
  const modelWithTools = reactConfig.model.bindTools(reactConfig.tools);
  // Compress old tool results to prevent quadratic token growth
  const compressedMessages = compressMessagesForLLM(state.messages);
  const response = await modelWithTools.invoke(compressedMessages, config);

  return {
    messages: [response],
    iterationCount: state.iterationCount + 1,
  };
}

// === Enhanced Tool Node (with loop detection + result tracking) ===

function createEnhancedToolNode(tools: StructuredToolInterface[], toolInterceptor?: ReactLoopConfig['toolInterceptor']) {
  return async function enhancedToolNode(
    state: ReactState,
    config: RunnableConfig,
  ): Promise<Partial<ReactState>> {
    const messages = state.messages as BaseMessage[];
    const lastMessage = messages[messages.length - 1] as AIMessage;
    if (!lastMessage?.tool_calls?.length) {
      return { messages: [] };
    }

    const reactConfig = config.configurable?.reactLoopConfig as ReactLoopConfig;
    const interceptor = toolInterceptor ?? reactConfig?.toolInterceptor;

    const toolResults: ToolResultRecord[] = [...state.toolResults];
    const newMessages: ToolMessage[] = [];
    let newQueries = { ...state.queriesAsked };
    let executedCount = 0;

    for (const tc of lastMessage.tool_calls) {
      const parsedArgs = parseToolCallArgs(tc);
      
      if ('_parseError' in parsedArgs) {
        newMessages.push(
          new ToolMessage({
            content: `Error: Failed to parse tool arguments: ${parsedArgs._raw}`,
            tool_call_id: tc.id ?? `fallback_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          }),
        );
        continue;
      }
      
      let args = parsedArgs;

      // Apply interceptor (e.g. scope_node_ids injection for search_book)
      if (interceptor) {
        args = interceptor(tc.name, args);
      }

      // Loop detection: replace duplicate queries with a warning
      if (hasLoopDetected(tc.name, args, state.queriesAsked)) {
        const usedQueries = (state.queriesAsked[tc.name] ?? []).map(q => `"${q}"`).join(', ');
        const loopMsg = `[Loop Detection] 检测到重复工具调用：
- 工具：${tc.name}
- 重复查询："${extractQueryKey(tc.name, args)}"
- 本次循环已使用的查询：${usedQueries}

建议：直接使用 read_book_section 的 node_ids 参数批量读取相关章节内容，避免重复搜索。`;

        newMessages.push(
          new ToolMessage({
            content: loopMsg,
            tool_call_id: tc.id ?? `fallback_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          }),
        );
        continue;
      }

      // Record query AFTER passing loop detection (before execution)
      newQueries = updateQueriesAsked(newQueries, tc.name, args);

      // Execute via shared helper
      const result = await executeSingleToolCall(tc, tools, interceptor, config);
      newMessages.push(result.msg);
      if (result.record) toolResults.push(result.record);
      executedCount++;
    }

    return {
      messages: newMessages,
      toolResults,
      queriesAsked: newQueries,
      toolCallCount: state.toolCallCount + executedCount,
    };
  };
}

// === Should Continue ===

function shouldContinue(state: ReactState): string {
  const messages = state.messages as BaseMessage[];
  const lastMessage = messages[messages.length - 1] as AIMessage;

  // No tool calls → normal end
  if (!lastMessage?.tool_calls?.length) return '__end__';
  // Max iterations reached
  if (state.iterationCount >= state._maxIterations) return '__end__';
  // Max tool calls reached
  if (state.toolCallCount >= state._maxToolCalls) return '__end__';
  // Loop detection: if ALL tool calls are duplicates, stop
  const allDuplicates = lastMessage.tool_calls.every(tc => {
    const args = parseToolCallArgs(tc);
    return hasLoopDetected(tc.name, args, state.queriesAsked);
  });
  if (allDuplicates && lastMessage.tool_calls.length > 0) return '__end__';

  return 'tools';
}

// === Forced Conclusion ===

function buildForcedConclusionPrompt(config: ReactLoopConfig, hitToolCallLimit: boolean): string {
  const limitType = hitToolCallLimit ? '工具调用' : '迭代';
  const limitValue = hitToolCallLimit ? config.maxToolCalls : config.maxIterations;

  let prompt = `你已达到${limitType}次数上限（${limitValue}次）。

现在请基于已收集的所有信息，输出你的最终分析结论。

要求：
1. 综合所有工具调用结果
2. 输出完整的分析内容，不要再次调用工具
3. 如果信息不足，基于已有信息给出尽可能完整的回答`;

  if (config.forcedConclusionContext) {
    const { pdfName, scopeNodeIds } = config.forcedConclusionContext;
    if (pdfName || (scopeNodeIds && scopeNodeIds.length > 0)) {
      prompt += `\n\n书名：${pdfName || '未知'}
可引用的章节范围：${scopeNodeIds?.join(', ') || '全书'}
请确保所有 wiki 链接格式为 [[${pdfName || '书名'}/章节文件名#^block_id|别名]]`;
    }
  }

  return prompt;
}

// === Build the subgraph ===

export function createReactLoopGraph(config: ReactLoopConfig) {
  return new StateGraph(ReactAnnotation)
    .addNode('agent', agentNode)
    .addNode('tools', createEnhancedToolNode(config.tools, config.toolInterceptor))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', shouldContinue, {
      tools: 'tools',
      __end__: '__end__',
    })
    .addEdge('tools', 'agent');
}

/**
 * Run the ReAct loop to completion, handling forced conclusion.
 *
 * @deprecated Use runPlanExecute instead — fewer LLM calls, same quality.
 * This is retained for HITL (human-in-the-loop) flows that need iterative tool use.
 *
 * It compiles and runs the graph, then applies forced conclusion
 * if the loop terminated due to iteration/tool-call limits.
 */
export async function runReactLoop(
  messages: BaseMessage[],
  config: ReactLoopConfig,
  runnableConfig?: RunnableConfig,
): Promise<{
  content: string;
  toolResults: ToolResultRecord[];
  iterations: number;
  finishReason: 'stop' | 'max_iterations' | 'max_tool_calls' | 'loop_detected';
}> {
  const graph = createReactLoopGraph(config);
  const compiled = graph.compile();

  const initialState = {
    messages,
    iterationCount: 0,
    toolCallCount: 0,
    queriesAsked: {} as Record<string, string[]>,
    toolResults: [] as ToolResultRecord[],
    _maxIterations: config.maxIterations,
    _maxToolCalls: config.maxToolCalls,
  };

  const result = await compiled.invoke(initialState, {
    ...runnableConfig,
    signal: config.signal ?? runnableConfig?.signal,
    configurable: {
      ...runnableConfig?.configurable,
      reactLoopConfig: config,
    },
  });

  const resultMessages = result.messages as BaseMessage[];
  const lastMessage = resultMessages[resultMessages.length - 1] as AIMessage;
  const hasPendingToolCalls = (lastMessage?.tool_calls?.length ?? 0) > 0;
  const hitIterationLimit = result.iterationCount >= config.maxIterations;
  const hitToolCallLimit = result.toolCallCount >= config.maxToolCalls;
  // Loop detection: all tool calls are duplicates (shouldContinue returned __end__)
  const allDuplicates = hasPendingToolCalls && (lastMessage.tool_calls ?? []).every(tc => {
    const args = parseToolCallArgs(tc);
    return hasLoopDetected(tc.name, args, result.queriesAsked);
  });

  // Forced conclusion: if loop ended with pending tool calls due to limits or loop detection
  const needsForcedConclusion = hasPendingToolCalls && (hitIterationLimit || hitToolCallLimit || allDuplicates);
  if (needsForcedConclusion && result.toolResults.length > 0) {
    // Fill in placeholder ToolMessages for pending tool calls to maintain valid message sequence
    // (OpenAI API requires ToolMessage after AIMessage with tool_calls)
    const filledMessages = [...resultMessages];
    const pendingTcIds = new Set(
      (lastMessage.tool_calls ?? []).map(tc => tc.id).filter(Boolean) as string[],
    );
    const answeredIds = new Set(
      resultMessages
        .filter((m): m is ToolMessage => m instanceof ToolMessage)
        .map(m => m.tool_call_id),
    );
    for (const tc of lastMessage.tool_calls ?? []) {
      const tcId = tc.id ?? '';
      if (!answeredIds.has(tcId)) {
        filledMessages.push(
          new ToolMessage({
            content: `[跳过] 已达调用上限，不再执行此工具。`,
            tool_call_id: tcId,
          }),
        );
      }
    }

    const forcedPrompt = buildForcedConclusionPrompt(config, hitToolCallLimit);
    const compressedForForcedConclusion = compressMessagesForLLM(filledMessages);
    const forcedResponse = await config.model.invoke([
      ...compressedForForcedConclusion,
      new HumanMessage(forcedPrompt),
    ], runnableConfig);

    let forcedContent = typeof forcedResponse.content === 'string'
      ? forcedResponse.content
      : JSON.stringify(forcedResponse.content);

    // Self-verification: remove ghost block_id references
    if (result.toolResults.length > 0) {
      const verifyResult = await verifyAndCleanContent(forcedContent, result.toolResults);
      forcedContent = verifyResult.content;
    }

    return {
      content: forcedContent,
      toolResults: result.toolResults,
      iterations: result.iterationCount,
      finishReason: allDuplicates ? 'loop_detected' as const
        : hitToolCallLimit ? 'max_tool_calls' as const
        : 'max_iterations' as const,
    };
  }

  // Normal completion
  let content = lastMessage
    ? (typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content))
    : '';

  // Self-verification: remove ghost block_id references
  if (result.toolResults.length > 0) {
    const verifyResult = await verifyAndCleanContent(content, result.toolResults);
    content = verifyResult.content;
  }

  // Limits handled above via forced conclusion; anything reaching here is normal stop
  return {
    content,
    toolResults: result.toolResults,
    iterations: result.iterationCount,
    finishReason: 'stop' as const,
  };
}

// ═══════════════════════════════════════════════════════════
// Plan-then-Execute: O(1) replacement for ReAct's O(N²)
//
// 1. Plan:  1 LLM call → model decides which tools to call
// 2. Execute: all tools run in parallel (0 LLM calls)
// 3. Synthesize: 1 LLM call → final answer from all results
//
// Total: 2 LLM calls instead of 2N (where N = ReAct iterations)
// ═══════════════════════════════════════════════════════════

function buildSynthesisPrompt(config: ReactLoopConfig): string {
  let prompt = `现在请基于你请求的所有工具执行结果，输出完整的分析结论。

要求：
1. 综合所有工具返回的信息
2. 不要再次调用任何工具
3. 如果某些结果不完整，基于已有信息给出尽可能完整的回答
4. 严格遵守 <output_rules> 中的 wiki 链接格式
5. 提取逻辑骨架：定义 → 主旨 → 论述 → 结论`;

  if (config.forcedConclusionContext) {
    const { pdfName, scopeNodeIds } = config.forcedConclusionContext;
    if (pdfName) {
      prompt += `\n\n书名：${pdfName}
请确保所有 wiki 链接格式为 [[${pdfName}/章节文件名#^block_id|自然语言别名]]`;
    }
  }

  return prompt;
}

export interface ReactLoopResult {
  content: string;
  toolResults: ToolResultRecord[];
  iterations: number;
  finishReason: 'stop' | 'max_iterations' | 'max_tool_calls' | 'loop_detected';
}

/**
 * Plan-Execute-Replan: iterative planning with bounded rounds.
 *
 * Round 1: Plan → Execute in parallel
 * Round 2 (optional): Replan based on results → Execute again
 * Final: Synthesize all gathered information
 *
 * This is a middle ground between pure Plan-then-Execute (1 round, may miss info)
 * and full ReAct (N rounds, token-expensive). Default 2 rounds covers most cases:
 * - Round 1: broad search + read known chapters
 * - Round 2: follow-up reads based on Round 1 discoveries
 *
 * LLM calls per round: 1 (plan) + 0 (parallel execute) = 1
 * Total for 2 rounds: 2 plan + 1 synthesize = 3 LLM calls (vs ReAct's 4-6)
 */
/**
 * Execute a batch of tool calls in parallel, returning messages and records.
 */
// ═══════════════════════════════════════════════════════════
// Shared tool execution helper (used by both ReAct and PlanExecute)
// ═══════════════════════════════════════════════════════════

interface SingleToolResult {
  msg: ToolMessage;
  record: ToolResultRecord | null;
}

/**
 * Execute a single tool call: parse args → intercept → invoke → compress → extract blockIds.
 * Shared by createEnhancedToolNode (sequential ReAct) and executeToolBatch (parallel PlanExecute).
 */
async function executeSingleToolCall(
  tc: any,
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
  if (interceptor) {
    args = interceptor(tc.name, args);
  }

  const tool = tools.find(t => t.name === tc.name);
  if (!tool) {
    return {
      msg: new ToolMessage({ content: `Error: Unknown tool "${tc.name}"`, tool_call_id: tcId }),
      record: null,
    };
  }

  try {
    const rawResult = await tool.invoke(args, runnableConfig);
    const resultStr = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
    const compressed = compressToolResult(resultStr);
    const extractedBlockIds = extractBlockIdsFromResult(resultStr);
    return {
      msg: new ToolMessage({ content: compressed, tool_call_id: tcId }),
      record: { toolName: tc.name, args, result: compressed, originalResultLength: resultStr.length, extractedBlockIds } as ToolResultRecord,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      msg: new ToolMessage({ content: `Error: ${errorMsg}`, tool_call_id: tcId }),
      record: null,
    };
  }
}


async function executeToolBatch(
  toolCalls: any[],
  tools: StructuredToolInterface[],
  config: ReactLoopConfig,
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

/**
 * Report planned tool calls to the user via onProgress callback.
 * Shows what the agent plans to do, giving the user a mental model of complexity.
 */
function reportPlan(
  config: ReactLoopConfig,
  toolCalls: any[],
  round: number,
  maxPlanRounds: number,
): void {
  if (!config.onProgress) return;

  const searches = toolCalls.filter(tc => tc.name === 'search_book').length;
  const reads = toolCalls.filter(tc => tc.name === 'read_book_section').length;
  const total = toolCalls.length;

  if (total === 0) return;

  const roundLabel = maxPlanRounds > 1 ? `（第 ${round + 1}/${maxPlanRounds} 轮）` : '';

  if (searches > 0 && reads > 0) {
    config.onProgress(`正在检索${roundLabel}：搜索 ${searches} 个关键词，精读 ${reads} 个章节...`);
  } else if (reads > 0) {
    config.onProgress(`正在精读${roundLabel}：${reads} 个章节...`);
  } else if (searches > 0) {
    config.onProgress(`正在搜索${roundLabel}：${searches} 个关键词...`);
  } else {
    config.onProgress(`正在检索${roundLabel}：${total} 个工具调用...`);
  }
}

/**
 * Plan-Execute-Replan: iterative planning with bounded rounds.
 *
 * Default maxPlanRounds=2 allows one follow-up round:
 *   Round 1: Plan(1 LLM) → Execute(parallel tools)
 *   Round 2: Replan(1 LLM, sees Round 1 results) → Execute(parallel tools)
 *   Final:   Synthesize(1 LLM) → output
 *
 * Total: 3 LLM calls for 2 rounds (vs ReAct's 4-6 calls).
 * If a round produces no tool calls, synthesize immediately.
 */
export async function runPlanExecute(
  messages: BaseMessage[],
  config: ReactLoopConfig,
  runnableConfig?: RunnableConfig,
): Promise<ReactLoopResult> {
  const { tools, model } = config;
  const modelWithTools = model.bindTools(tools);
  const maxPlanRounds = Math.max(1, Math.min(config.maxToolCalls, 2)); // at least 1 round, cap at 2

  const allToolResults: ToolResultRecord[] = [];
  const conversationHistory: BaseMessage[] = [...messages];
  let totalIterations = 0;

  // === Iterative Plan-Execute rounds ===
  for (let round = 0; round < maxPlanRounds; round++) {
    // Compress history to prevent token growth across rounds
    const compressedHistory = round > 0 ? compressMessagesForLLM(conversationHistory) : conversationHistory;
    
    // Round 2+ 补充检索提示
    const historyWithHint = round > 0
      ? [...compressedHistory, new HumanMessage(`基于上一轮检索结果，如有必要请补充检索更多信息。如果已足够，直接回答问题。`)]
      : compressedHistory;

    const planResponse = await modelWithTools.invoke(historyWithHint, runnableConfig);
    totalIterations++;

    // No tool calls → model answered directly or wants to synthesize
    if (!planResponse?.tool_calls?.length) {
      const content = typeof planResponse?.content === 'string'
        ? planResponse.content : JSON.stringify(planResponse?.content ?? '');
      // If first round answered directly, return it
      if (round === 0) {
        return { content, toolResults: [], iterations: totalIterations, finishReason: 'stop' };
      }
      // Later round: treat as synthesis
      if (allToolResults.length > 0) {
        const verifyResult = await verifyAndCleanContent(content, allToolResults);
        return { content: verifyResult.content, toolResults: allToolResults, iterations: totalIterations, finishReason: 'stop' };
      }
      return { content, toolResults: allToolResults, iterations: totalIterations, finishReason: 'stop' };
    }

    // === Report plan to user for transparency ===
    reportPlan(config, planResponse.tool_calls, round, maxPlanRounds);

    // Execute all planned tools in parallel
    const { messages: toolMsgs, records } = await executeToolBatch(
      planResponse.tool_calls, tools, config, runnableConfig,
    );
    allToolResults.push(...records);

    // Append to conversation history for next round
    conversationHistory.push(planResponse);
    conversationHistory.push(...toolMsgs);
  }

  // === Final: Synthesize ===
  const synthesisMessages = compressMessagesForLLM(conversationHistory);
  const synthesisPrompt = buildSynthesisPrompt(config);

  const synthesisResponse = await model.invoke([
    ...synthesisMessages,
    new HumanMessage(synthesisPrompt),
  ], runnableConfig);

  let content = typeof synthesisResponse.content === 'string'
    ? synthesisResponse.content
    : JSON.stringify(synthesisResponse.content);

  if (allToolResults.length > 0) {
    const verifyResult = await verifyAndCleanContent(content, allToolResults);
    content = verifyResult.content;
  }

  return {
    content,
    toolResults: allToolResults,
    iterations: totalIterations + 1, // +1 for synthesis
    finishReason: 'stop',
  };
}
