/**
 * 节点 typed I/O 接口定义
 *
 * 为每个图节点定义明确的输入（从 state 读取的字段）和输出（返回的字段）。
 * 节点内部使用这些接口解构 state，而非直接访问 CognitiveEngineState。
 *
 * 注意：不改 LangGraph 签名（保持 `(state, config) => Promise<Partial<State>>`），
 * 仅在节点内部用 typed 解构提高可读性和类型安全。
 */

import type { BaseMessage } from '@langchain/core/messages';
import type { ToolResultSnapshot } from './state';

// ============ S0: Router ============

export interface RouterInput {
  messages: BaseMessage[];
  allowedTools: string[];
  pdfName: string;
}

export interface RouterOutput {
  depth: number;
  rewrittenQuery: string;
  allowedTools: string[];
}

// ============ S1: Inspectional ============

export interface InspectionalInput {
  bookId: string;
  pdfName: string;
  rewrittenQuery: string;
  depth: number;
}

export interface InspectionalOutput {
  scopeNodeIds: string[];
  tocSummary: string;
  betterQuestion: string;
  structuralAnalysis: string;
  suggestedKeywords: string[];
}

// ============ S2: Analytical ============

export interface AnalyticalInput {
  scopeNodeIds: string[];
  pdfName: string;
  tocSummary: string;
  rewrittenQuery: string;
  betterQuestion: string;
  suggestedKeywords: string[];
}

export interface AnalyticalOutput {
  analysisResult: string;
  toolResultsSnapshot: ToolResultSnapshot[];
}

// ============ S3: Syntopical ============

export interface SyntopicalInput {
  rewrittenQuery: string;
}

export interface SyntopicalOutput {
  analysisResult: string;
  toolResultsSnapshot: ToolResultSnapshot[];
}

// ============ Visualizer ============

export interface VisualizerInput {
  analysisResult: string;
  structuralAnalysis: string;
  rewrittenQuery: string;
  pdfName: string;
}

export interface VisualizerOutput {
  analysisResult: string;
}

// ============ S4: Formatter ============

export interface FormatterInput {
  analysisResult: string;
  structuralAnalysis: string;
  rewrittenQuery: string;
  pdfName: string;
  isProactive: boolean;
  proactiveTrigger: string;
  isSocratic: boolean;
  depth: number;
  tocSummary: string;
  betterQuestion: string;
  scopeNodeIds: string[];
  toolResultsSnapshot: ToolResultSnapshot[];
  highlightContext: string[];
}

export interface FormatterOutput {
  formattedOutput: string;
}
