/**
 * S1: Inspectional Reading Node — LangGraph wrapper
 *
 * Wraps the existing InspectionalState.execute() into a LangGraph node.
 * Loads tree.json, selects scope chapters, generates TOC summary.
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import type { CognitiveEngineState } from '../state';
import { InspectionalState } from '../../cognitive-engine/states/inspectional';
import type { SharedContext } from '../../cognitive-engine/types';

/**
 * S1 Inspectional node: reads tree.json, selects scope, generates TOC summary.
 *
 * Delegates to the existing InspectionalState which handles:
 * 1. Loading tree.json from .pageindex/{bookId}/
 * 2. Converting to OutlineNode[] and formatting
 * 3. LLM-based scope selection and structural analysis
 *
 * The node maps LangGraph state → SharedContext fields, executes,
 * then maps SharedContext mutations → LangGraph state update.
 */
export async function inspectionalNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const inspectional = new InspectionalState();
  const ctx = config.configurable?.sharedContext as SharedContext | undefined;

  if (!ctx) {
    // No SharedContext available (e.g. testing) — return defaults
    return {
      scopeNodeIds: [],
      tocSummary: '',
      betterQuestion: '',
      structuralAnalysis: '',
    };
  }

  // Sync relevant graph state into SharedContext
  ctx.depth = state.depth as 0 | 1 | 2 | 3;
  ctx.standaloneQuery = state.rewrittenQuery || ctx.rawUserQuery;

  // Execute the existing state logic
  await inspectional.execute(ctx);

  // Map SharedContext mutations back to graph state
  return {
    scopeNodeIds: ctx.scopeNodeIds ?? [],
    tocSummary: ctx.tocSummary ?? '',
    betterQuestion: ctx.betterQuestion ?? '',
    structuralAnalysis: ctx.structuralAnalysis ?? '',
  };
}
