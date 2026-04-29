/**
 * CognitiveEngine Graph State Definition
 *
 * LangGraph Annotation replacing SharedContext.
 * - Simple fields use Annotation<T>() (LastValue / overwrite semantics)
 * - messages uses messagesStateReducer (append semantics)
 */

import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';

/** Tool result snapshot for S2 → S4 self-verification */
export interface ToolResultSnapshot {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  originalResultLength: number;
  /** Block_ids extracted before compression (for accurate verification) */
  extractedBlockIds?: string[];
}

export const CognitiveEngineAnnotation = Annotation.Root({
  // === Messages (append reducer, not overwrite) ===
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // === S0: Router output ===
  depth: Annotation<number>(),
  rewrittenQuery: Annotation<string>(),
  allowedTools: Annotation<string[]>(),

  // === S1: Inspectional output ===
  tocSummary: Annotation<string>(),
  scopeNodeIds: Annotation<string[]>(),
  betterQuestion: Annotation<string>(),
  structuralAnalysis: Annotation<string>(),
  suggestedKeywords: Annotation<string[]>(),

  // === S2: Analytical output ===
  analysisResult: Annotation<string>(),
  toolResultsSnapshot: Annotation<ToolResultSnapshot[]>(),

  // === S4: Formatter output ===
  formattedOutput: Annotation<string>(),

  // === Runtime ===
  bookId: Annotation<string>(),
  pdfName: Annotation<string>(),

  // === Proactive guidance ===
  isProactive: Annotation<boolean>(),
  proactiveTrigger: Annotation<string>(),
  highlightContext: Annotation<string[]>(),

  // === Socratic mode ===
  isSocratic: Annotation<boolean>(),

  // === Error tracking ===
  nodeErrors: Annotation<Record<string, string>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
});

export type CognitiveEngineState = typeof CognitiveEngineAnnotation.State;
