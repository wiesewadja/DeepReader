/**
 * SharedContext — minimal shared state for LangGraph nodes
 *
 * Migrated from cognitive-engine/types.ts and cognitive-engine/context.ts.
 * Only includes what the LangGraph path actually uses.
 */

import type { LLMClientManager } from '../llm-client';
import type { ToolContext } from '../tools/types';
import type { ChatMessage } from '../types';
import type { HistorySummary } from './utils/history-summarizer';

/**
 * Callbacks for engine progress reporting
 */
export interface EngineCallbacks {
  onProgress: (status: string) => void;
  onContent: (text: string) => void;
  onReasoning?: (text: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
  /**
   * 图表生成开始时同步触发（visualizer 节点内）。
   * 前端用于标记"本次回复会附带图表"，占位气泡延迟到 formatter onComplete 后才创建
   * （避免文字流式输出时就冒出空的画图气泡，体验割裂）。
   */
  onDiagramStart?: () => void;
  /**
   * 图表生成完成时异步触发（visualizer 节点的 fire-and-forget 任务内）。
   * embed 形如 "![[Excalidraw/xxx.excalidraw.md]]"。
   */
  onDiagramReady?: (embed: string) => void;
  /**
   * 图表生成失败/超时异步触发（visualizer fire-and-forget 任务内）。
   * 前端用于把占位气泡替换为失败提示，并重置 diagramPending 等状态，避免占位永远卡住。
   */
  onDiagramFailed?: (reason: string) => void;
}

/**
 * Shared context passed to graph nodes via config.configurable.
 * Contains runtime data and dependencies.
 */
export interface SharedContext {
  chatHistory: ChatMessage[];
  rawUserQuery: string;
  tocSummary?: string;
  betterQuestion?: string;
  s2ToolResults?: Array<{ toolName: string; args: Record<string, unknown>; result: string; originalResultLength: number }>;
  abortSignal?: AbortSignal;
  memoryContext?: string;
  llmClientManager?: LLMClientManager;
  toolContext?: ToolContext;
  recentHistorySummaries?: HistorySummary[];
  prevSearchedBlockIds?: string[];
  userProfileSummary?: string;
}

/**
 * Factory function to create a new SharedContext
 */
export function createSharedContext(params: {
  rawUserQuery: string;
  chatHistory?: ChatMessage[];
  abortSignal?: AbortSignal;
  memoryContext?: string;
  llmClientManager?: LLMClientManager;
  toolContext?: ToolContext;
  recentHistorySummaries?: HistorySummary[];
  prevSearchedBlockIds?: string[];
  userProfileSummary?: string;
}): SharedContext {
  return {
    chatHistory: params.chatHistory || [],
    rawUserQuery: params.rawUserQuery,
    abortSignal: params.abortSignal,
    memoryContext: params.memoryContext,
    llmClientManager: params.llmClientManager,
    toolContext: params.toolContext,
    recentHistorySummaries: params.recentHistorySummaries,
    prevSearchedBlockIds: params.prevSearchedBlockIds,
    userProfileSummary: params.userProfileSummary,
  };
}
