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
import { routeByDepth, routeAfterInspectional, routeAfterAnalysis } from './edges';

// Build the graph
const workflow = new StateGraph(CognitiveEngineAnnotation)
  .addNode('router', routerNode)
  .addNode('inspectional', inspectionalNode)
  .addNode('analytical', analyticalNode)
  .addNode('syntopical', syntopicalNode)
  .addNode('visualizer', visualizerNode)
  .addNode('formatter', formatterNode)
  .addEdge(START, 'router')
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
