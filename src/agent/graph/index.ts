/**
 * Cognitive Engine — LangGraph StateGraph
 *
 * Main graph compiling S0→S1→S2/S3→S4 nodes with conditional edges.
 *
 * S0: Router (depth classification)
 * S1: Inspectional (TOC analysis, scope narrowing)
 * S2: Analytical (single-book deep analysis)
 * S3: Syntopical (multi-book fusion analysis)
 * S4: Formatter (output formatting)
 */

import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { CognitiveEngineAnnotation } from './state';
import { routerNode } from './nodes/router';
import { inspectionalNode } from './nodes/inspectional';
import { analyticalNode } from './nodes/analytical';
import { syntopicalNode } from './nodes/syntopical';
import { formatterNode } from './nodes/formatter';
import { routeByDepth, routeAfterInspectional } from './edges';

// Build the graph
const workflow = new StateGraph(CognitiveEngineAnnotation)
  .addNode('router', routerNode)
  .addNode('inspectional', inspectionalNode)
  .addNode('analytical', analyticalNode)
  .addNode('syntopical', syntopicalNode)
  .addNode('formatter', formatterNode)
  .addEdge(START, 'router')
  .addConditionalEdges('router', routeByDepth, {
    formatter: 'formatter',
    inspectional: 'inspectional',
  })
  .addConditionalEdges('inspectional', routeAfterInspectional, {
    continue: 'analytical',
    syntopical: 'syntopical',
    done: 'formatter',
  })
  .addEdge('analytical', 'formatter')
  .addEdge('syntopical', 'formatter')
  .addEdge('formatter', END);

export const cognitiveEngine = workflow.compile({
  checkpointer: new MemorySaver(),
});

export type { CognitiveEngineAnnotation, CognitiveEngineState } from './state';
