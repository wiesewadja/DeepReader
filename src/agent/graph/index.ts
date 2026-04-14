/**
 * Cognitive Engine — LangGraph StateGraph
 *
 * Main graph compiling S0→S1→S2→S4 nodes with conditional edges.
 * Uses MemorySaver for in-memory checkpointing (Chunk 5 will add FileCheckpointer).
 */

import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { CognitiveEngineAnnotation } from './state';
import { routerNode } from './nodes/router';
import { inspectionalNode } from './nodes/inspectional';
import { analyticalNode } from './nodes/analytical';
import { formatterNode } from './nodes/formatter';
import { routeByDepth, routeAfterInspectional } from './edges';

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
 * Compiled cognitive engine graph.
 *
 * Usage:
 * ```typescript
 * import { HumanMessage } from '@langchain/core/messages';
 *
 * const stream = await cognitiveEngine.stream(
 *   {
 *     messages: [new HumanMessage('这本书讲了什么？')],
 *     bookId: 'abc12345',
 *     pdfName: '如何阅读一本书',
 *   },
 *   {
 *     configurable: {
 *       thread_id: 'session-1',
 *       fastModel: fastChatModel,
 *       sharedContext: sharedCtx,
 *     },
 *   },
 * );
 * ```
 *
 * configurable fields:
 * - thread_id: unique session identifier for checkpointing
 * - fastModel: ChatOpenAI instance for S0/S1 (fast/cheap)
 * - mainModel: ChatOpenAI instance for S2/S4 (strong)
 * - sharedContext: existing SharedContext for delegating to legacy state classes
 * - chatHistory: recent chat messages for router context
 * - callbacks: EngineCallbacks for streaming output
 * - enableHumanReview: boolean (used in Chunk 4)
 */
export const cognitiveEngine = workflow.compile({
  checkpointer: new MemorySaver(),
});

export type { CognitiveEngineAnnotation, CognitiveEngineState } from './state';
