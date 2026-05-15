/**
 * Cognitive Engine — LangGraph StateGraph
 *
 * Main graph compiling S0→S1→S2/S3→Visualizer→S4 nodes with conditional edges.
 *
 * S0: Router (depth classification + intent routing)
 * S1: Inspectional (TOC analysis, scope narrowing)
 * S2: Analytical (single-book deep analysis)
 * S3: Syntopical (multi-book fusion analysis)
 * Visualizer: Convert analysis to Excalidraw diagram (when diagram intent detected)
 * S4: Formatter (output formatting)
 */

import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { CognitiveEngineAnnotation } from './state';
import { routerNode } from './nodes/router';
import { inspectionalNode } from './nodes/inspectional';
import { analyticalNode } from './nodes/analytical';
import { syntopicalNode } from './nodes/syntopical';
import { visualizerNode } from './nodes/visualizer';
import { formatterNode } from './nodes/formatter';
import { routeFromStart, routeByDepth, routeAfterInspectional, routeAfterAnalysis } from './edges';
import { safeNode } from './utils/safe-node.js';
import { NODE_NAMES, EDGE_KEYS } from './node-names';

// S1 fallback: empty data with error flag — downstream checks nodeErrors to detect failure
const safeInspectional = safeNode(NODE_NAMES.INSPECTIONAL, inspectionalNode, (state) => ({
  scopeNodeIds: [],
  tocSummary: '',
  betterQuestion: state.rewrittenQuery,
  structuralAnalysis: '',
  suggestedKeywords: [],
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
  .addNode(NODE_NAMES.ROUTER, routerNode)
  .addNode(NODE_NAMES.INSPECTIONAL, safeInspectional)
  .addNode(NODE_NAMES.ANALYTICAL, safeAnalytical)
  .addNode(NODE_NAMES.SYNTOPICAL, safeNode(NODE_NAMES.SYNTOPICAL, syntopicalNode, () => ({
    analysisResult: '',
    toolResultsSnapshot: [],
  })))
  .addNode(NODE_NAMES.VISUALIZER, visualizerNode)
  .addNode(NODE_NAMES.FORMATTER, safeFormatter)
  .addConditionalEdges(START, routeFromStart, {
    [NODE_NAMES.ROUTER]: NODE_NAMES.ROUTER,
    [NODE_NAMES.INSPECTIONAL]: NODE_NAMES.INSPECTIONAL,
  })
  .addConditionalEdges(NODE_NAMES.ROUTER, routeByDepth, {
    [NODE_NAMES.FORMATTER]: NODE_NAMES.FORMATTER,
    [NODE_NAMES.INSPECTIONAL]: NODE_NAMES.INSPECTIONAL,
  })
  .addConditionalEdges(NODE_NAMES.INSPECTIONAL, routeAfterInspectional, {
    [EDGE_KEYS.CONTINUE]: NODE_NAMES.ANALYTICAL,
    [NODE_NAMES.SYNTOPICAL]: NODE_NAMES.SYNTOPICAL,
    [NODE_NAMES.VISUALIZER]: NODE_NAMES.VISUALIZER,
    [EDGE_KEYS.DONE]: NODE_NAMES.FORMATTER,
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
  .addEdge(NODE_NAMES.FORMATTER, END);

export const cognitiveEngine = workflow.compile({
  checkpointer: new MemorySaver(),
});

export type { CognitiveEngineAnnotation, CognitiveEngineState } from './state';
