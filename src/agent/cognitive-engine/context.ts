/**
 * SharedContext implementation for the Cognitive Engine
 */

import type { SharedContext, StateResult, ReadingDepth, SearchResult } from './types';
import type { ChatMessage } from '../types';
import type { LLMClient, LLMClientManager } from '../llm-client';
import type { ToolRegistry, ToolContext } from '../tools/types';
import type { HistorySummary } from './utils/history-summarizer';

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
  llmClient?: LLMClient;
  llmClientManager?: LLMClientManager;
  toolRegistry?: ToolRegistry;
  toolContext?: ToolContext;
  recentHistorySummaries?: HistorySummary[];
  prevSearchedBlockIds?: string[];
}): SharedContextImpl {
  return new SharedContextImpl(
    params.indexId,
    params.pdfName,
    params.rawUserQuery,
    params.chatHistory || [],
    params.markdownFiles,
    params.abortSignal,
    params.docDescription,
    params.memoryContext,
    params.llmClient,
    params.llmClientManager,
    params.toolRegistry,
    params.toolContext,
    params.recentHistorySummaries,
    params.prevSearchedBlockIds
  );
}

/**
 * SharedContext implementation with tracking methods
 */
export class SharedContextImpl implements SharedContext {
  // Chat history
  chatHistory: ChatMessage[];
  rawUserQuery: string;

  // S0 output
  depth: ReadingDepth = 2;
  detectedIntents: string[] = [];
  standaloneQuery?: string;

  // S1 output
  scopeNodeIds?: string[];
  tocSummary?: string;

  // S2 output
  analysisResult?: string;

  // S3 output (deferred)
  globalPassages?: SearchResult[];
  syntopicalInsight?: string;

  // Runtime
  indexId: string;
  pdfName: string;
  abortSignal?: AbortSignal;
  markdownFiles?: Record<string, string>;
  /** 全书摘要（帮助 S1 更好地判断意图） */
  docDescription?: string;
  /** 长期记忆上下文（用于 S4 个性化输出） */
  memoryContext?: string;

  // Engine Dependencies
  llmClient?: LLMClient;
  llmClientManager?: LLMClientManager;
  toolRegistry?: ToolRegistry;
  toolContext?: ToolContext;

  // S2 History Support
  recentHistorySummaries?: HistorySummary[];
  prevSearchedBlockIds?: string[];

  // State tracking
  executedStates: Set<string>;
  stateResults: Map<string, StateResult>;

  constructor(
    indexId: string,
    pdfName: string,
    rawUserQuery: string,
    chatHistory: ChatMessage[],
    markdownFiles?: Record<string, string>,
    abortSignal?: AbortSignal,
    docDescription?: string,
    memoryContext?: string,
    llmClient?: LLMClient,
    llmClientManager?: LLMClientManager,
    toolRegistry?: ToolRegistry,
    toolContext?: ToolContext,
    recentHistorySummaries?: HistorySummary[],
    prevSearchedBlockIds?: string[]
  ) {
    this.indexId = indexId;
    this.pdfName = pdfName;
    this.rawUserQuery = rawUserQuery;
    this.chatHistory = chatHistory;
    this.markdownFiles = markdownFiles;
    this.abortSignal = abortSignal;
    this.docDescription = docDescription;
    this.memoryContext = memoryContext;
    this.llmClient = llmClient;
    this.llmClientManager = llmClientManager;
    this.toolRegistry = toolRegistry;
    this.toolContext = toolContext;
    this.recentHistorySummaries = recentHistorySummaries;
    this.prevSearchedBlockIds = prevSearchedBlockIds;
    this.executedStates = new Set();
    this.stateResults = new Map();
  }

  /**
   * Mark a state as executed
   */
  markStateExecuted(
    stateName: string,
    success: boolean,
    error?: string,
    duration?: number,
    innerIterations?: number
  ): void {
    this.executedStates.add(stateName);
    this.stateResults.set(stateName, {
      success,
      timestamp: Date.now(),
      error,
      duration,
      innerIterations,
    });
  }

  /**
   * Check if a state needs execution
   */
  needsStateExecution(stateName: string): boolean {
    return !this.executedStates.has(stateName);
  }

  /**
   * Check if a state executed successfully
   */
  isStateSuccessful(stateName: string): boolean {
    return this.stateResults.get(stateName)?.success ?? false;
  }
}