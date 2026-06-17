/**
 * Cognitive Engine — LangGraph StateGraph
 *
 * Main graph compiling S0→S1→S2/S3→S4 nodes with conditional edges.
 *
 * S0: Router (depth classification + intent routing)
 * S1: Inspectional (TOC analysis, scope narrowing)
 * S2: Analytical (single-book deep analysis)
 * S3: Syntopical (multi-book fusion analysis)
 * S4: Formatter (output formatting)
 */

import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { routeFromStart, routeAfterInspectional, routeAfterPreSearch, routeAfterAnalysis } from './edges';
import { NODE_NAMES, EDGE_KEYS } from './node-names';
import { advisorNode } from './nodes/advisor';
import { analyticalNode } from './nodes/analytical';
import { preSearchNode } from './nodes/analytical-pre-search';
import { formatterNode } from './nodes/formatter';
import { inspectionalNode } from './nodes/inspectional';
import { syntopicalNode } from './nodes/syntopical';
import { visualizerNode } from './nodes/visualizer';
import { CognitiveEngineAnnotation } from './state';
import { safeNode } from './utils/safe-node.js';

// S1 fallback: empty data with error flag — downstream checks nodeErrors to detect failure
const safeInspectional = safeNode(NODE_NAMES.INSPECTIONAL, inspectionalNode, (state) => ({
  scopeNodeIds: [],
  tocSummary: '',
  betterQuestion: state.rewrittenQuery,
  structuralAnalysis: '',
  suggestedKeywords: [],
}));

// S2-Pre fallback: pass through scope without pre-search
const safePreSearch = safeNode(NODE_NAMES.PRE_SEARCH, preSearchNode, (state) => ({
  validatedScopeNodeIds: state.scopeNodeIds ?? [],
  preSearchBlock: '',
  earlyStopContent: '',
  toolResultsSnapshot: [],
}));

// S2 fallback: empty analysis — formatter will handle gracefully
const safeAnalytical = safeNode(NODE_NAMES.ANALYTICAL, analyticalNode, () => ({
  analysisResult: '',
  toolResultsSnapshot: [],
}));

// S4 fallback: last resort — show raw query result or error message
const safeFormatter = safeNode(NODE_NAMES.FORMATTER, formatterNode, (state) => ({
  formattedOutput: state.analysisResult || state.rewrittenQuery || '抱歉，处理您的请求时遇到了问题，请重试。',
}));

// Build the graph
const workflow = new StateGraph(CognitiveEngineAnnotation)
  .addNode(NODE_NAMES.INSPECTIONAL, safeInspectional)
  .addNode(NODE_NAMES.PRE_SEARCH, safePreSearch)
  .addNode(NODE_NAMES.ANALYTICAL, safeAnalytical)
  .addNode(NODE_NAMES.SYNTOPICAL, safeNode(NODE_NAMES.SYNTOPICAL, syntopicalNode, () => ({
    analysisResult: '',
    toolResultsSnapshot: [],
  })))
  .addNode(NODE_NAMES.ADVISOR, safeNode(NODE_NAMES.ADVISOR, advisorNode, () => ({
    analysisResult: '',
    toolResultsSnapshot: [],
  })))
  .addNode(NODE_NAMES.VISUALIZER, safeNode(NODE_NAMES.VISUALIZER, visualizerNode, (state) => ({
    analysisResult: state.analysisResult || '',
  })))
  .addNode(NODE_NAMES.FORMATTER, safeFormatter)
  .addConditionalEdges(START, routeFromStart, {
    [NODE_NAMES.INSPECTIONAL]: NODE_NAMES.INSPECTIONAL,
    [NODE_NAMES.FORMATTER]: NODE_NAMES.FORMATTER,
    [NODE_NAMES.ADVISOR]: NODE_NAMES.ADVISOR,
  })
  .addConditionalEdges(NODE_NAMES.INSPECTIONAL, routeAfterInspectional, {
    [NODE_NAMES.PRE_SEARCH]: NODE_NAMES.PRE_SEARCH,
    [NODE_NAMES.SYNTOPICAL]: NODE_NAMES.SYNTOPICAL,
    [NODE_NAMES.VISUALIZER]: NODE_NAMES.VISUALIZER,
    [EDGE_KEYS.DONE]: NODE_NAMES.FORMATTER,
  })
  .addConditionalEdges(NODE_NAMES.PRE_SEARCH, routeAfterPreSearch, {
    [NODE_NAMES.FORMATTER]: NODE_NAMES.FORMATTER,
    [NODE_NAMES.ANALYTICAL]: NODE_NAMES.ANALYTICAL,
    [NODE_NAMES.VISUALIZER]: NODE_NAMES.VISUALIZER,
  })
  .addConditionalEdges(NODE_NAMES.ANALYTICAL, routeAfterAnalysis, {
    [NODE_NAMES.VISUALIZER]: NODE_NAMES.VISUALIZER,
    [NODE_NAMES.FORMATTER]: NODE_NAMES.FORMATTER,
  })
  .addConditionalEdges(NODE_NAMES.SYNTOPICAL, routeAfterAnalysis, {
    [NODE_NAMES.VISUALIZER]: NODE_NAMES.VISUALIZER,
    [NODE_NAMES.FORMATTER]: NODE_NAMES.FORMATTER,
  })
  .addEdge(NODE_NAMES.VISUALIZER, NODE_NAMES.FORMATTER)
  .addEdge(NODE_NAMES.ADVISOR, NODE_NAMES.FORMATTER)
  .addEdge(NODE_NAMES.FORMATTER, END);

export const cognitiveEngine = workflow.compile({
  checkpointer: new MemorySaver(),
});

export type { CognitiveEngineAnnotation, CognitiveEngineState } from './state';
