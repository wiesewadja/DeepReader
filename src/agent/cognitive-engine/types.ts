/**
 * Core type definitions for the Cognitive Engine
 */

import type { ChatMessage } from '../types';
import type { LLMClient, LLMClientManager } from '../llm-client';
import type { ToolRegistry, ToolContext } from '../tools/types';
import type { ITraceContext } from '../tracing/types';

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
  /** TOC summary reasoning with search keyword suggestions */
  tocSummary?: string;
  /** Better rephrased question for S2/S4 */
  betterQuestion?: string;
  /** 全书结构分析（深度1时由 S1 生成，用于 S4 直接输出） */
  structuralAnalysis?: string;

  // ===== S2 Output =====
  /** Analysis conclusion (may S2 Analytical) */
  analysisResult?: string;
  /**
   * S2 阶段收集的工具调用结果（Requirement 1.9）
   * 供 S4 FormatterState 进行 block_id 验证
   */
  s2ToolResults?: Array<{ toolName: string; args: Record<string, unknown>; result: string; originalResultLength: number }>;

  // ===== S3 Output (deferred) =====
  globalPassages?: SearchResult[];
  syntopicalInsight?: string;

  // ===== Runtime =====
  indexId: string;
  pdfName: string;
  abortSignal?: AbortSignal;
  markdownFiles?: Record<string, string>;
  /** 全书摘要（LLM 生成的文档描述，帮助 S1 更好地判断意图） */
  docDescription?: string;
  /** 长期记忆上下文（来自 MEMORY.md，用于 S4 个性化输出） */
  memoryContext?: string;

  // ===== Engine Dependencies =====
  /** LLM client manager for multi-model support */
  llmClientManager?: LLMClientManager;
  /** @deprecated Use llmClientManager instead */
  llmClient?: LLMClient;
  /** Tool registry for tool execution */
  toolRegistry?: ToolRegistry;
  /** Tool context for tool execution */
  toolContext?: ToolContext;

  // ===== Tracing =====
  /** Langfuse trace context for observability */
  traceContext?: ITraceContext;

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