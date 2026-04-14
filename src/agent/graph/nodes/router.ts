/**
 * S0: Router Node — LangGraph wrapper
 *
 * Wraps the existing RouterState.execute() into a LangGraph node.
 * Calls the fast model to classify depth and rewrite query.
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseMessage } from '@langchain/core/messages';
import { z } from 'zod';
import type { CognitiveEngineState } from '../state';
import { PROMPT_S0_ROUTER, buildRouterUserMessage } from '../../cognitive-engine/prompts/router-prompt';

const RouterOutputSchema = z.object({
  depth: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  standalone_query: z.string().optional(),
  reason: z.string().optional(),
});

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
 * Uses the fast model via config.configurable.fastModel with
 * withStructuredOutput() for reliable JSON parsing.
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
    const router = fastModel.withStructuredOutput(RouterOutputSchema);
    const userMessage = buildRouterUserMessage(rawQuery, chatHistory, state.pdfName || undefined);

    const result = await router.invoke([
      { role: 'system', content: PROMPT_S0_ROUTER },
      { role: 'user', content: userMessage },
    ]);

    // Syntopical reading (depth=3) downgrades to analytical (depth=2)
    const effectiveDepth = (result.depth ?? 2) >= 3 ? 2 : (result.depth ?? 2);

    return {
      depth: effectiveDepth,
      rewrittenQuery: result.standalone_query || rawQuery,
    };
  } catch {
    // Graceful degradation: default to analytical reading
    return {
      depth: 2,
      rewrittenQuery: rawQuery,
    };
  }
}
