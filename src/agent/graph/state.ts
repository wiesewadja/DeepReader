/**
 * CognitiveEngine Graph State Definition
 *
 * LangGraph Annotation replacing SharedContext.
 * - Simple fields use Annotation<T>() (LastValue / overwrite semantics)
 * - messages uses messagesStateReducer (append semantics)
 */

import type { BaseMessage } from '@langchain/core/messages';
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BookSearchResultV2 } from '../../pageindex/book-types.js';

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

/**
 * Engine mode.
 * 'normal'    — standard query-answer flow
 * 'proactive' — ask guiding questions instead of answering
 * 'socratic'  — dialogue mode with follow-up questions
 */
export type EngineMode = 'normal' | 'proactive' | 'socratic';

/** Tool result snapshot for S2 → S4 self-verification */
export interface ToolResultSnapshot {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  originalResultLength: number;
  /** Block_ids extracted before compression (for accurate verification) */
  extractedBlockIds?: string[];
}

/** Structured node error for unified degradation */
export interface NodeError {
  message: string;
  recoverable: boolean;
  fallbackAction: 'global_search' | 'skip_to_formatter' | 'abort';
}

/** Friendly user hints keyed by node name */
export const NODE_ERROR_HINTS: Record<string, string> = {
  inspectional: '⚠️ 结构分析暂时不可用，已使用全书范围搜索。',
  analytical: '⚠️ 深度分析暂时不可用，已提供基础回答。',
  pre_search: '⚠️ 预检索暂时不可用，已直接进行深度分析。',
  visualizer: '⚠️ 图表生成遇到问题。',
  syntopical: '⚠️ 主题阅读暂时不可用。',
};

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
  // 双源写入：可由 S2 Analytical (ReAct/PlanExecute) 写入，也可由 S2-Pre 早停
  // 路径直接生成。两者的 LLM 质量不可比——S2-Pre 早停用的是 mainModel 一次性
  // 输出（非 ReAct 工具循环），可能比 S2 ReAct 的结论更不严谨。L5（见下方
  // verifiedFullBookHits + utils/claim-verifier.ts）会在下一轮自动复核这种
  // 来自 S2-Pre 早停路径的"未出现"声明并触发状态机重启。
  analysisResult: Annotation<string>(),
  toolResultsSnapshot: Annotation<ToolResultSnapshot[]>(overwriteWithDefault([])),

  // === S2-pre: Pre-search intermediate ===
  preSearchBlock: Annotation<string>(),
  earlyStopContent: Annotation<string>(),
  validatedScopeNodeIds: Annotation<string[]>(overwriteWithDefault([])),
  nodeFileMap: Annotation<Record<string, string>>(overwriteWithDefault({})),
  prevSearchedBlockIds: Annotation<string[]>(overwriteWithDefault([])),
  queryVector: Annotation<number[] | null>(overwriteWithDefault(null as number[] | null)),

  // === S4: Formatter output ===
  formattedOutput: Annotation<string>(),

  // === Runtime ===
  bookId: Annotation<string>(),
  pdfName: Annotation<string>(),

  // === Correction / hard-override signals ===
  // Set by Router when the user's message looks like a pushback
  // ("不，这里就有这个概念", "再搜索下" ...). Downstream nodes use this
  // to (a) force ANALYTICAL path, (b) bypass early-stop, and
  // (c) re-include the current chapter in scope.
  correctionDetected: Annotation<boolean>(overwriteWithDefault(false)),

  // === Visualizer 自主触发 ===
  // 由 S0 Router 设置：LLM 判断本次回答是否适合配 Excalidraw 图表。
  // 不依赖用户明说"画图"——只要概念/流程/框架/关系类问题，router 主动 visualize=true。
  // edges 用 (userHasDiagramIntent || shouldVisualize) 决定是否走 VISUALIZER 节点。
  shouldVisualize: Annotation<boolean>(overwriteWithDefault(false)),

  // === L5: Full-book negative-claim verification ===
  // Set by S2-Pre when the pre-searched analysisResult (carried via
  // the S1→S2 hand-off, see edge wiring) shows a negative claim
  // ("未出现" etc.) and the full-book verification search surfaced
  // meaningful hits. The routing layer (routeAfterPreSearch) checks
  // this to force a state-machine restart at S2 Analytical — so
  // S2 can do its own ReAct reasoning with the new evidence,
  // rather than S4 patching a wrong answer. See
  // utils/claim-verifier.ts:75 for the detection + search.
  verifiedFullBookHits: Annotation<BookSearchResultV2[]>(overwriteWithDefault([])),

  // === Proactive guidance ===
  proactiveTrigger: Annotation<string>(),
  highlightContext: Annotation<string[]>(overwriteWithDefault([])),

  // === Unified mode ===
  mode: Annotation<EngineMode>(overwriteWithDefault('normal' as EngineMode)),

  // === Reading advisor mode ===
  wereadAvailable: Annotation<boolean>(overwriteWithDefault(false)),

  // === Booklist (cross-book) mode ===
  crossBookMode: Annotation<boolean>(overwriteWithDefault(false)),

  // === Error tracking ===
  nodeErrors: Annotation<Record<string, NodeError | string>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
});

export type CognitiveEngineState = typeof CognitiveEngineAnnotation.State;
