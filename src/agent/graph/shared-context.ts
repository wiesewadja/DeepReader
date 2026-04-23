/**
 * SharedContext — minimal shared state for LangGraph nodes
 *
 * Migrated from cognitive-engine/types.ts and cognitive-engine/context.ts.
 * Only includes what the LangGraph path actually uses.
 */

import type { ChatMessage } from '../types';
import type { LLMClientManager } from '../llm-client';
import type { ToolRegistry, ToolContext } from '../tools/types';
import type { HistorySummary } from './utils/history-summarizer';

/**
 * Reading depth levels based on Adler's methodology
 */
export type ReadingDepth = 0 | 1 | 2 | 3;

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
  depth: ReadingDepth;
  standaloneQuery?: string;
  scopeNodeIds?: string[];
  tocSummary?: string;
  betterQuestion?: string;
  structuralAnalysis?: string;
  analysisResult?: string;
  s2ToolResults?: Array<{ toolName: string; args: Record<string, unknown>; result: string; originalResultLength: number }>;
  indexId: string;
  pdfName: string;
  abortSignal?: AbortSignal;
  markdownFiles?: Record<string, string>;
  docDescription?: string;
  memoryContext?: string;
  llmClientManager?: LLMClientManager;
  toolRegistry?: ToolRegistry;
  toolContext?: ToolContext;
  recentHistorySummaries?: HistorySummary[];
  prevSearchedBlockIds?: string[];
  userProfile?: string;
}

/**
 * Factory function to create a new SharedContext
 */
export function createSharedContext(params: {
  indexId: string;
  pdfName: string;
  rawUserQuery: string;
  chatHistory?: ChatMessage[];
  markdownFiles?: Record<string, string>;
  abortSignal?: AbortSignal;
  docDescription?: string;
  memoryContext?: string;
  llmClientManager?: LLMClientManager;
  toolRegistry?: ToolRegistry;
  toolContext?: ToolContext;
  recentHistorySummaries?: HistorySummary[];
  prevSearchedBlockIds?: string[];
  userProfile?: string;
}): SharedContext {
  return {
    chatHistory: params.chatHistory || [],
    rawUserQuery: params.rawUserQuery,
    depth: 2,
    indexId: params.indexId,
    pdfName: params.pdfName,
    abortSignal: params.abortSignal,
    markdownFiles: params.markdownFiles,
    docDescription: params.docDescription,
    memoryContext: params.memoryContext,
    llmClientManager: params.llmClientManager,
    toolRegistry: params.toolRegistry,
    toolContext: params.toolContext,
    recentHistorySummaries: params.recentHistorySummaries,
    prevSearchedBlockIds: params.prevSearchedBlockIds,
    userProfile: params.userProfile,
  };
}
