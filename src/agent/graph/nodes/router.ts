/**
 * S0: Router Node — LangGraph wrapper
 *
 * Wraps the existing RouterState.execute() into a LangGraph node.
 * Calls the fast model to classify depth and rewrite query.
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import { PROMPT_S0_ROUTER, buildRouterUserMessage } from '../prompts/router-prompt';
import { extractJSON } from '../utils/parse.js';
import { agentLog as log } from '../../../utils/logger.js';
import { hasSyntopicalKeywords } from '../../utils/syntopical-search.js';

interface RouterOutput {
  depth: number;
  standalone_query?: string;
  reason?: string;
}

function extractLastHumanMessage(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.getType() === 'human' && typeof m.content === 'string') {
      return m.content;
    }
  }
  return '';
}

/**
 * S0 Router node: classifies reading depth and rewrites query.
 *
 * Uses the fast model and parses JSON from text output
 * (avoids withStructuredOutput which requires json_schema support).
 * Falls back to depth=2 (analytical) on any error.
 */
export async function routerNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const fastModel = config.configurable?.fastModel;
  const chatHistory = config.configurable?.chatHistory ?? [];
  const rawQuery = extractLastHumanMessage(state.messages);

  // Fallback when model is not available (e.g. testing)
  if (!fastModel) {
    return {
      depth: 2,
      rewrittenQuery: rawQuery,
    };
  }

  try {
    const sharedContext = config.configurable?.sharedContext as any;
    const docDescription = sharedContext?.docDescription as string | undefined;
    const userMessage = buildRouterUserMessage(rawQuery, chatHistory, state.pdfName || undefined, docDescription);

    const response = await fastModel.invoke([
      { role: 'system', content: PROMPT_S0_ROUTER },
      { role: 'user', content: userMessage },
    ], config);

    const text = typeof response.content === 'string' ? response.content : '';
    const parsed = extractJSON(text);

    const depth = parsed?.depth ?? 2;
    const standaloneQuery = parsed?.standalone_query || rawQuery;

    // Hybrid trigger: keywords pre-check + LLM classification
    const candidateSyntopical = hasSyntopicalKeywords(rawQuery);
    const effectiveDepth = candidateSyntopical ? 3 : depth;

    log(`[S0 Router] depth=${effectiveDepth}, candidateSyntopical=${candidateSyntopical}, query="${standaloneQuery.slice(0, 50)}"`, parsed?.reason || '');

    return {
      depth: effectiveDepth,
      rewrittenQuery: standaloneQuery,
    };
  } catch (err) {
    // Graceful degradation: default to analytical reading
    log('[S0 Router] LLM 调用失败，降级到 depth=2:', err instanceof Error ? err.message : String(err));
    return {
      depth: 2,
      rewrittenQuery: rawQuery,
    };
  }
}
