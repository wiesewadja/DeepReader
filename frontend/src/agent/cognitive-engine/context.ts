/**
 * SharedContext implementation for the Cognitive Engine
 */

import type { SharedContext, StateResult, ReadingDepth, SearchResult } from './types';
import type { ChatMessage } from '../types';
import type { LLMClient } from '../llm-client';
import type { ToolRegistry, ToolContext } from '../tools/types';

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
  // Engine dependencies
  llmClient?: LLMClient;
  toolRegistry?: ToolRegistry;
  toolContext?: ToolContext;
}): SharedContextImpl {
  return new SharedContextImpl(
    params.indexId,
    params.pdfName,
    params.rawUserQuery,
    params.chatHistory || [],
    params.markdownFiles,
    params.abortSignal,
    params.llmClient,
    params.toolRegistry,
    params.toolContext
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
  rawResults?: SearchResult[];
  analysisResult?: string;

  // S3 output (deferred)
  globalPassages?: SearchResult[];
  syntopicalInsight?: string;

  // Runtime
  indexId: string;
  pdfName: string;
  abortSignal?: AbortSignal;
  markdownFiles?: Record<string, string>;

  // Engine Dependencies
  llmClient?: LLMClient;
  toolRegistry?: ToolRegistry;
  toolContext?: ToolContext;

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
    llmClient?: LLMClient,
    toolRegistry?: ToolRegistry,
    toolContext?: ToolContext
  ) {
    this.indexId = indexId;
    this.pdfName = pdfName;
    this.rawUserQuery = rawUserQuery;
    this.chatHistory = chatHistory;
    this.markdownFiles = markdownFiles;
    this.abortSignal = abortSignal;
    this.llmClient = llmClient;
    this.toolRegistry = toolRegistry;
    this.toolContext = toolContext;
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
    duration?: number
  ): void {
    this.executedStates.add(stateName);
    this.stateResults.set(stateName, {
      success,
      timestamp: Date.now(),
      error,
      duration,
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