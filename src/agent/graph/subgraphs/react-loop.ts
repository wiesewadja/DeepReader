/**
 * ReAct Loop Subgraph
 *
 * Replaces runStateLoop() with a LangGraph StateGraph.
 * Supports: tool calling, loop detection, forced conclusion,
 * and iteration/tool-call limits.
 */

import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { parseToolCallArgs } from '../utils/tool-call-parser.js';
import { messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { verifyAndCleanContent } from '../utils/self-verification.js';
import {
  type ToolResultRecord,
  type ReactLoopConfig,
  type ReactLoopResult,
  compressMessagesForLLM,
  executeSingleToolCall,
} from './tool-execution.js';

// Re-export public interfaces from tool-execution.ts
export type { ToolResultRecord, ReactLoopConfig, ReactLoopResult } from './tool-execution.js';
export { runPlanExecute } from './plan-execute.js';

// === State Definition ===

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
  queriesAsked: Annotation<Record<string, string[]>>({
    reducer: (_, update) => update,
    default: () => ({}),
  }),
  toolResults: Annotation<ToolResultRecord[]>({
    reducer: (_, update) => update,
    default: () => [],
  }),
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

async function agentNode(
  state: ReactState,
  config: RunnableConfig,
): Promise<Partial<ReactState>> {
  const reactConfig = config.configurable?.reactLoopConfig as ReactLoopConfig;
  const modelWithTools = reactConfig.model.bindTools(reactConfig.tools);
  const compressedMessages = compressMessagesForLLM(state.messages);
  const response = await modelWithTools.invoke(compressedMessages, config);

  return {
    messages: [response],
    iterationCount: state.iterationCount + 1,
  };
}

// === Enhanced Tool Node ===

function createEnhancedToolNode(toolInterceptor?: ReactLoopConfig['toolInterceptor']) {
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
    const tools = reactConfig.tools;

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
      if (interceptor) {
        args = interceptor(tc.name, args);
      }

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

      newQueries = updateQueriesAsked(newQueries, tc.name, args);

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

  if (!lastMessage?.tool_calls?.length) return '__end__';
  if (state.iterationCount >= state._maxIterations) return '__end__';
  if (state.toolCallCount >= state._maxToolCalls) return '__end__';
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
    .addNode('tools', createEnhancedToolNode(config.toolInterceptor))
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
 */
export async function runReactLoop(
  messages: BaseMessage[],
  config: ReactLoopConfig,
  runnableConfig?: RunnableConfig,
): Promise<ReactLoopResult> {
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
  const allDuplicates = hasPendingToolCalls && (lastMessage.tool_calls ?? []).every(tc => {
    const args = parseToolCallArgs(tc);
    return hasLoopDetected(tc.name, args, result.queriesAsked);
  });

  const needsForcedConclusion = hasPendingToolCalls && (hitIterationLimit || hitToolCallLimit || allDuplicates);
  if (needsForcedConclusion && result.toolResults.length > 0) {
    const filledMessages = [...resultMessages];
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

  let content = lastMessage
    ? (typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content))
    : '';

  if (result.toolResults.length > 0) {
    const verifyResult = await verifyAndCleanContent(content, result.toolResults);
    content = verifyResult.content;
  }

  return {
    content,
    toolResults: result.toolResults,
    iterations: result.iterationCount,
    finishReason: 'stop' as const,
  };
}
