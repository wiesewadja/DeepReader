/**
 * Core type definitions for the Cognitive Engine
 */

import type { ChatMessage } from '../types';
import type { LLMClient } from '../llm-client';
import type { ToolRegistry, ToolContext } from '../tools/types';

/**
 * Reading depth levels based on Adler's methodology
 */
export type ReadingDepth = 0 | 1 | 2 | 3;

/**
 * Model selection for state execution
 */
export type ModelType = 'fast' | 'main';

/**
 * Result of a single state execution
 */
export interface StateResult {
  success: boolean;
  timestamp: number;
  error?: string;
  duration?: number;
  /** 内层迭代次数（LLM 调用轮数） */
  innerIterations?: number;
}

/**
 * Search result with block_id for citations
 */
export interface SearchResult {
  node_id: string;
  block_id: string;
  text: string;
  score: number;
}

/**
 * Raw tool result for formatter
 * Extended to support TOC results (which don't have block_id)
 */
export interface RawToolResult {
  block_id?: string;
  text: string;
  toolName?: string;
}

/**
 * Shared context passed between all states
 */
export interface SharedContext {
  // ===== Chat History =====
  /** Clean history (only User + Assistant messages) */
  chatHistory: ChatMessage[];
  /** Original user query */
  rawUserQuery: string;

  // ===== S0 Output =====
  depth: ReadingDepth;
  detectedIntents: string[];
  /** Rewritten standalone query */
  standaloneQuery?: string;

  // ===== S1 Output =====
  /** Locked chapter scope */
  scopeNodeIds?: string[];
  /** TOC summary reasoning */
  tocSummary?: string;

  // ===== S2 Output =====
  /** Raw search results with block_id (from search_doc) or tool results (from get_toc) */
  rawResults?: RawToolResult[];
  /** Analysis conclusion */
  analysisResult?: string;

  // ===== S3 Output (deferred) =====
  globalPassages?: SearchResult[];
  syntopicalInsight?: string;

  // ===== Runtime =====
  indexId: string;
  pdfName: string;
  abortSignal?: AbortSignal;
  markdownFiles?: Record<string, string>;

  // ===== Engine Dependencies =====
  /** LLM client for API calls */
  llmClient?: LLMClient;
  /** Tool registry for tool execution */
  toolRegistry?: ToolRegistry;
  /** Tool context for tool execution */
  toolContext?: ToolContext;

  // ===== State Execution Tracking =====
  executedStates: Set<string>;
  stateResults: Map<string, StateResult>;

  // ===== Methods =====
  markStateExecuted(stateName: string, success: boolean, error?: string, duration?: number, innerIterations?: number): void;
  needsStateExecution(stateName: string): boolean;
  isStateSuccessful(stateName: string): boolean;
}

/**
 * Options for state node execution
 */
export interface StateNodeOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

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
 * Tool interceptor function type
 */
export type ToolInterceptor = (
  toolName: string,
  toolArgs: Record<string, unknown>
) => Record<string, unknown>;