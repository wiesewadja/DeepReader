/**
 * S4: Formatter Node — LangGraph wrapper
 *
 * Wraps the existing FormatterState.execute() into a LangGraph node.
 * Transforms raw analysis into formatted Obsidian notes with streaming.
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import type { CognitiveEngineState } from '../state';
import { FormatterState } from '../../cognitive-engine/states/formatter';
import type { SharedContext, EngineCallbacks } from '../../cognitive-engine/types';

/**
 * S4 Formatter node: transforms analysis into Obsidian-formatted output.
 *
 * Delegates to the existing FormatterState which handles:
 * 1. System prompt with character persona ("奚童")
 * 2. Injecting history, analysis, TOC, structural analysis
 * 3. Streaming output via callbacks
 * 4. Self-verification of block_id citations
 */
export async function formatterNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const callbacks = config.configurable?.callbacks as EngineCallbacks | undefined;
  const formatter = new FormatterState(callbacks);
  const ctx = config.configurable?.sharedContext as SharedContext | undefined;

  if (!ctx) {
    return {
      formattedOutput: state.analysisResult || '',
    };
  }

  // Sync graph state into SharedContext
  ctx.depth = state.depth as 0 | 1 | 2 | 3;
  ctx.standaloneQuery = state.rewrittenQuery || ctx.rawUserQuery;
  ctx.scopeNodeIds = state.scopeNodeIds.length > 0 ? state.scopeNodeIds : undefined;
  ctx.tocSummary = state.tocSummary || undefined;
  ctx.betterQuestion = state.betterQuestion || undefined;
  ctx.structuralAnalysis = state.structuralAnalysis || undefined;
  ctx.analysisResult = state.analysisResult || undefined;
  ctx.s2ToolResults = state.toolResultsSnapshot.length > 0 ? state.toolResultsSnapshot : undefined;

  // Execute the existing state logic (includes streaming + self-verification)
  await formatter.execute(ctx);

  return {
    formattedOutput: ctx.analysisResult ?? '',
  };
}
