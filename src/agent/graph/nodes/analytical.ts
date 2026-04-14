/**
 * S2: Analytical Reading Node — LangGraph wrapper
 *
 * Wraps the existing AnalyticalState.execute() into a LangGraph node.
 * Deep analysis within locked scope using ReAct loop.
 *
 * Full ReAct subgraph integration will be in Chunk 3.
 * This skeleton delegates to the existing state for now.
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import type { CognitiveEngineState } from '../state';
import { AnalyticalState } from '../../cognitive-engine/states/analytical';
import type { SharedContext } from '../../cognitive-engine/types';

/**
 * S2 Analytical node: deep analysis with tool-augmented ReAct loop.
 *
 * Delegates to the existing AnalyticalState which handles:
 * 1. Cumulative guarantee (calls S1 if scope not set)
 * 2. Scope interceptor creation
 * 3. ReAct loop with search_book + read_book_section
 * 4. Forced conclusion on iteration limit
 *
 * The full ReAct subgraph will replace this in Chunk 3.
 */
export async function analyticalNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const analytical = new AnalyticalState();
  const ctx = config.configurable?.sharedContext as SharedContext | undefined;

  if (!ctx) {
    return {
      analysisResult: '',
      toolResultsSnapshot: [],
    };
  }

  // Sync graph state into SharedContext
  ctx.depth = state.depth as 0 | 1 | 2 | 3;
  ctx.standaloneQuery = state.rewrittenQuery || ctx.rawUserQuery;
  ctx.scopeNodeIds = state.scopeNodeIds.length > 0 ? state.scopeNodeIds : undefined;
  ctx.tocSummary = state.tocSummary || undefined;
  ctx.betterQuestion = state.betterQuestion || undefined;
  ctx.structuralAnalysis = state.structuralAnalysis || undefined;

  // Execute the existing state logic (includes ReAct loop + scope interceptor)
  await analytical.execute(ctx);

  return {
    analysisResult: ctx.analysisResult ?? '',
    toolResultsSnapshot: ctx.s2ToolResults ?? [],
  };
}
