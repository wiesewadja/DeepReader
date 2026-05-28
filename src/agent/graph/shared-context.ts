/**
 * SharedContext — minimal shared state for LangGraph nodes
 *
 * Migrated from cognitive-engine/types.ts and cognitive-engine/context.ts.
 * Only includes what the LangGraph path actually uses.
 */

import type { ChatMessage } from '../types';
import type { LLMClientManager } from '../llm-client';
import type { ToolContext } from '../tools/types';
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
