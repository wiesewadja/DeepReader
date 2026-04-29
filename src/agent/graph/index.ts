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

// S1 fallback: empty data with error flag — downstream checks nodeErrors to detect failure
const safeInspectional = safeNode('inspectional', inspectionalNode, (state) => ({
  scopeNodeIds: [],
  tocSummary: '',
  betterQuestion: state.rewrittenQuery,
  structuralAnalysis: '',
  suggestedKeywords: [],
}));

// S2 fallback: empty analysis — formatter will handle gracefully
const safeAnalytical = safeNode('analytical', analyticalNode, () => ({
  analysisResult: '',
  toolResultsSnapshot: [],
}));

// S4 fallback: last resort — show raw query result or error message
const safeFormatter = safeNode('formatter', formatterNode, (state) => ({
  formattedOutput: state.analysisResult || state.rewrittenQuery || '抱歉，处理您的请求时遇到了问题，请重试。',
}));

// Build the graph
const workflow = new StateGraph(CognitiveEngineAnnotation)
  .addNode('router', routerNode)
  .addNode('inspectional', safeInspectional)
  .addNode('analytical', safeAnalytical)
  .addNode('syntopical', safeNode('syntopical', syntopicalNode, () => ({
    analysisResult: '',
    toolResultsSnapshot: [],
  })))
  .addNode('visualizer', visualizerNode)
  .addNode('formatter', safeFormatter)
  .addConditionalEdges(START, routeFromStart, {
    router: 'router',
    inspectional: 'inspectional',
  })
  .addConditionalEdges('router', routeByDepth, {
    formatter: 'formatter',
    inspectional: 'inspectional',
  })
  .addConditionalEdges('inspectional', routeAfterInspectional, {
    continue: 'analytical',
    syntopical: 'syntopical',
    visualizer: 'visualizer',
    done: 'formatter',
  })
  .addConditionalEdges('analytical', routeAfterAnalysis, {
    visualizer: 'visualizer',
    formatter: 'formatter',
  })
  .addConditionalEdges('syntopical', routeAfterAnalysis, {
    visualizer: 'visualizer',
    formatter: 'formatter',
  })
  .addEdge('visualizer', 'formatter')
  .addEdge('formatter', END);

export const cognitiveEngine = workflow.compile({
  checkpointer: new MemorySaver(),
});

export type { CognitiveEngineAnnotation, CognitiveEngineState } from './state';
