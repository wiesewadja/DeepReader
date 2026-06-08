/**
 * LangGraph Stream Processor
 *
 * 处理 LangGraph streamMode: "updates" 的流式输出，
 * 包括节点状态分发、HITL interrupt 检测、语音管线触发。
 */

import type { AgentLoopOptions , ChatMessage } from '../types.js';
import type { ReadingLevel } from '../ui/humanized-types.js';
import type { ToolResultSnapshot } from './state.js';

const NODE_STATUS_MAP: Record<string, string> = {
  router: '正在理解你的问题...',
  inspectional: '正在翻阅目录，锁定相关章节...',
  pre_search: '正在快速翻阅相关段落...',
  analytical: '正在深度分析原文...',
  formatter: '正在整理笔记...',
  syntopical: '正在跨书主题分析...',
  visualizer: '正在生成图表...',
};

const NODE_ACTION_MAP: Record<string, { type: string; level: ReadingLevel }> = {
  router:       { type: 'thinking',  level: 'elementary' },
  inspectional: { type: 'reading',   level: 'inspectional' },
  pre_search:  { type: 'reading',   level: 'analytical' },
  analytical:   { type: 'reading',   level: 'analytical' },
  formatter:    { type: 'writing',   level: 'analytical' },
  syntopical:   { type: 'reading',   level: 'syntopical' },
  visualizer:   { type: 'writing',   level: 'analytical' },
};

function getNodeStatus(nodeName: string): string {
  return NODE_STATUS_MAP[nodeName] || nodeName;
}

export interface EvalTraceData {
  nodesVisited: string[];
  depth?: number;
  toolCalls: Array<{ tool: string; args: Record<string, unknown>; resultLength: number }>;
  durationMs: number;
}

export interface StreamProcessorResult {
  messages: ChatMessage[];
  interrupted?: { nodeId: string; content: string };
  traceData?: EvalTraceData;
}

type VoicePipelineCallback = (
  formattedOutput: string,
  config: { configurable?: Record<string, unknown> },
  callbacks: AgentLoopOptions,
) => void | Promise<void>;

export async function processGraphStream(
  stream: AsyncIterable<unknown>,
  callbacks: AgentLoopOptions,
  config?: { configurable?: Record<string, unknown> },
  voicePipeline?: VoicePipelineCallback,
): Promise<StreamProcessorResult> {
  const onProgress = callbacks.onProgress || (() => {});
  const onContent = callbacks.onContent || (() => {});

  let formattedOutput = '';
  let interruptedNode: { nodeId: string; content: string } | undefined;

  // 轨迹数据收集
  const startTime = Date.now();
  const visitedNodes: string[] = [];
  let lastToolSnapshot: ToolResultSnapshot[] = [];
  let routedDepth: number | undefined;

  for await (const chunk of stream) {
    if (chunk == null || typeof chunk !== 'object') continue;

    const record = chunk as Record<string, unknown>;

    // 检测 interrupt（HITL）
    if ('__interrupt__' in record) {
      const first = (Array.isArray(record.__interrupt__) ? record.__interrupt__[0] : null) as { value?: { nodeId?: string; content?: string; question?: string } } | null;
      if (first?.value) {
        interruptedNode = {
          nodeId: first.value.nodeId || 'unknown',
          content: first.value.content || first.value.question || '',
        };
      }
      break;
    }

    // 正常节点更新: { nodeName: stateUpdate }
    const nodeNames = Object.keys(record);
    for (const nodeName of nodeNames) {
      const stateUpdate = record[nodeName] as Record<string, unknown> | null;
      if (stateUpdate == null) continue;

      onProgress(getNodeStatus(nodeName));
      visitedNodes.push(nodeName);

      // 通知表情系统
      const action = NODE_ACTION_MAP[nodeName];
      if (action && callbacks.onHumanizedProgress) {
        callbacks.onHumanizedProgress({
          mainAction: { type: action.type as any, detail: getNodeStatus(nodeName) },
          currentReadingLevel: action.level,
          generatedContent: '',
          overallProgress: 0,
        });
      }

      // 收集格式化输出（流式）
      if (stateUpdate.formattedOutput && typeof stateUpdate.formattedOutput === 'string') {
        formattedOutput = stateUpdate.formattedOutput;
        onContent(formattedOutput);
      }

      // 收集轨迹：工具调用快照（overwrite 语义，只保留最终全量）
      if (Array.isArray(stateUpdate.toolResultsSnapshot)) {
        lastToolSnapshot = stateUpdate.toolResultsSnapshot as ToolResultSnapshot[];
      }
      if (stateUpdate.depth != null && typeof stateUpdate.depth === 'number' && routedDepth === undefined) {
        routedDepth = stateUpdate.depth;
      }

    }
  }

  // S4 阶段完成后，使用 formattedOutput 生成语音
  if (callbacks.onVoiceReady && formattedOutput && voicePipeline) {
    await voicePipeline(formattedOutput, config ?? {}, callbacks);
  }

  const traceData: EvalTraceData = {
    nodesVisited: visitedNodes,
    depth: routedDepth,
    toolCalls: lastToolSnapshot.map(ts => ({
      tool: ts.toolName, args: ts.args, resultLength: ts.originalResultLength,
    })),
    durationMs: Date.now() - startTime,
  };

  if (interruptedNode) {
    return { messages: [], interrupted: interruptedNode, traceData };
  }

  callbacks.onComplete?.();

  const resultMessages: ChatMessage[] = [];
  if (formattedOutput) {
    resultMessages.push({ role: 'assistant', content: formattedOutput });
  }

  return { messages: resultMessages, traceData };
}
