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
import { ReadingDepth } from './state.js';

/**
 * Reading depth levels based on Adler's methodology
 * @deprecated Import from './state.js' instead
 */
export { ReadingDepth } from './state.js';

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
  /** @deprecated 已迁移到 CognitiveEngineState */
  depth: ReadingDepth;
  /** @deprecated 已迁移到 CognitiveEngineState */
  standaloneQuery?: string;
  /** @deprecated 已迁移到 CognitiveEngineState */
  scopeNodeIds?: string[];
  /** @deprecated 已迁移到 CognitiveEngineState */
  tocSummary?: string;
  /** @deprecated 已迁移到 CognitiveEngineState */
  betterQuestion?: string;
  /** @deprecated 已迁移到 CognitiveEngineState */
  structuralAnalysis?: string;
  /** @deprecated 已迁移到 CognitiveEngineState */
  analysisResult?: string;
  s2ToolResults?: Array<{ toolName: string; args: Record<string, unknown>; result: string; originalResultLength: number }>;
  indexId: string;
  /** @deprecated 已迁移到 CognitiveEngineState */
  pdfName: string;
  abortSignal?: AbortSignal;
  markdownFiles?: Record<string, string>;
  docDescription?: string;
  memoryContext?: string;
  llmClientManager?: LLMClientManager;
  toolContext?: ToolContext;
  recentHistorySummaries?: HistorySummary[];
  prevSearchedBlockIds?: string[];
  userProfileSummary?: string;
  /** 书单模式下的书籍 ID 列表，传入后 Syntopical 节点只搜索这些书 */
  booklistBookIds?: string[];
  /** 跨书籍模式标志（含书单模式和泛跨书模式） */
  crossBookMode?: boolean;
  /** 书架摘要（阅读顾问模式下注入用户全量书架上下文） */
  bookshelfSummary?: string;
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
  toolContext?: ToolContext;
  recentHistorySummaries?: HistorySummary[];
  prevSearchedBlockIds?: string[];
  userProfileSummary?: string;
  booklistBookIds?: string[];
  crossBookMode?: boolean;
  bookshelfSummary?: string;
}): SharedContext {
  return {
    chatHistory: params.chatHistory || [],
    rawUserQuery: params.rawUserQuery,
    depth: ReadingDepth.ANALYTICAL,
    indexId: params.indexId,
    pdfName: params.pdfName,
    abortSignal: params.abortSignal,
    markdownFiles: params.markdownFiles,
    docDescription: params.docDescription,
    memoryContext: params.memoryContext,
    llmClientManager: params.llmClientManager,
    toolContext: params.toolContext,
    recentHistorySummaries: params.recentHistorySummaries,
    prevSearchedBlockIds: params.prevSearchedBlockIds,
    userProfileSummary: params.userProfileSummary,
    booklistBookIds: params.booklistBookIds,
    crossBookMode: params.crossBookMode,
    bookshelfSummary: params.bookshelfSummary,
  };
}
