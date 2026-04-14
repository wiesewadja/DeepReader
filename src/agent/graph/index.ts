/**
 * Cognitive Engine — LangGraph StateGraph
 *
 * Main graph compiling S0→S1→S2→S4 nodes with conditional edges.
 * Supports both MemorySaver (in-memory) and FileCheckpointer (persistent).
 */

import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { CognitiveEngineAnnotation } from './state';
import { routerNode } from './nodes/router';
import { inspectionalNode } from './nodes/inspectional';
import { analyticalNode } from './nodes/analytical';
import { formatterNode } from './nodes/formatter';
import { routeByDepth, routeAfterInspectional } from './edges';
import type { FileCheckpointer } from './checkpointer';

// Build the graph
const workflow = new StateGraph(CognitiveEngineAnnotation)
  .addNode('router', routerNode)
  .addNode('inspectional', inspectionalNode)
  .addNode('analytical', analyticalNode)
  .addNode('formatter', formatterNode)
  .addEdge(START, 'router')
  .addConditionalEdges('router', routeByDepth, {
    casual: END,
    inspectional: 'inspectional',
    analytical: 'analytical',
  })
  .addConditionalEdges('inspectional', routeAfterInspectional, {
    continue: 'analytical',
    done: 'formatter',
  })
  .addEdge('analytical', 'formatter')
  .addEdge('formatter', END);

/**
 * Default in-memory cognitive engine (no persistence across restarts).
 */
export const cognitiveEngine = workflow.compile({
  checkpointer: new MemorySaver(),
});

/**
 * Create a cognitive engine with a persistent FileCheckpointer.
 *
 * Use this when you need interrupt recovery across Obsidian restarts.
 */
export function createCognitiveEngine(checkpointer: FileCheckpointer | MemorySaver) {
  return workflow.compile({ checkpointer });
}

export type { CognitiveEngineAnnotation, CognitiveEngineState } from './state';
