/**
 * CognitiveEngine Graph State Definition
 *
 * LangGraph Annotation replacing SharedContext.
 * - Simple fields use Annotation<T>() (LastValue / overwrite semantics)
 * - messages uses messagesStateReducer (append semantics)
 */

import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';

/**
 * Reading depth levels based on Adler's "How to Read a Book" methodology.
 *
 * CASUAL (0)       — 闲聊 / 简单问答
 * INSPECTIONAL (1) — 检视阅读：宏观结构分析
 * ANALYTICAL (2)   — 分析阅读：深度探究
 * SYNTOPICAL (3)   — 主题阅读：跨书对比
 */
export enum ReadingDepth {
  CASUAL = 0,
  INSPECTIONAL = 1,
  ANALYTICAL = 2,
  SYNTOPICAL = 3,
}

/** Tool result snapshot for S2 → S4 self-verification */
export interface ToolResultSnapshot {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  originalResultLength: number;
  /** Block_ids extracted before compression (for accurate verification) */
  extractedBlockIds?: string[];
}

/** Overwrite reducer with default — keeps last-value semantics but ensures non-undefined initial state. */
function overwriteWithDefault<T>(defaultValue: T) {
	return {
		reducer: (_old: T, newVal: T) => newVal,
		default: () => defaultValue,
	};
}

export const CognitiveEngineAnnotation = Annotation.Root({
  // === Messages (append reducer, not overwrite) ===
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // === S0: Router output ===
  depth: Annotation<ReadingDepth>(),
  rewrittenQuery: Annotation<string>(),
  allowedTools: Annotation<string[]>(overwriteWithDefault([])),

  // === S1: Inspectional output ===
  tocSummary: Annotation<string>(),
  scopeNodeIds: Annotation<string[]>(overwriteWithDefault([])),
  betterQuestion: Annotation<string>(),
  structuralAnalysis: Annotation<string>(),
  suggestedKeywords: Annotation<string[]>(overwriteWithDefault([])),

  // === S2: Analytical output ===
  analysisResult: Annotation<string>(),
  toolResultsSnapshot: Annotation<ToolResultSnapshot[]>(overwriteWithDefault([])),

  // === S4: Formatter output ===
  formattedOutput: Annotation<string>(),

  // === Runtime ===
  bookId: Annotation<string>(),
  pdfName: Annotation<string>(),

  // === Proactive guidance ===
  isProactive: Annotation<boolean>(),
  proactiveTrigger: Annotation<string>(),
  highlightContext: Annotation<string[]>(overwriteWithDefault([])),

  // === Socratic mode ===
  isSocratic: Annotation<boolean>(),

  // === Error tracking ===
  nodeErrors: Annotation<Record<string, string>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
});

export type CognitiveEngineState = typeof CognitiveEngineAnnotation.State;
