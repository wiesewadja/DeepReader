/**
 * S0: Router + Query Rewriter State
 *
 * Responsibilities:
 * 1. Determine reading depth (0, 1, 2, 3)
 * 2. Rewrite ambiguous queries to standalone form
 *
 * Routing: Hybrid (regex first, LLM fallback)
 */

import { z } from 'zod';
import { StateNode } from './base';
import type { SharedContext } from '../types';
import { parseStateOutput } from '../parse';
import { PROMPT_S0_ROUTER, buildRouterUserMessage } from '../prompts/router-prompt';
import { IntentRouter } from '../../router/intent-router';
import DEFAULT_RULES_JSON from '../../router/intent-rules.json';
import type { IntentRulesConfig } from '../../router/types';
import { runStateLoop } from './run-state-loop';

// Schema for router output
const RouterOutputSchema = z.object({
  depth: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  standalone_query: z.string().optional(),
  reason: z.string().optional(),
});

// Depth mapping from intent names
const INTENT_TO_DEPTH: Record<string, number> = {
  '检视阅读': 1,
  '分析阅读': 2,
  '分析阅读-定位': 2,
  '分析阅读-概念探究': 2,
  '分析阅读-微观检索': 2,
  '主题阅读': 3,
};

/**
 * S0: Router + Query Rewriter
 */
export class RouterState extends StateNode {
  readonly name = 'Router';
  readonly model = 'fast' as const;
  readonly tools: string[] = [];

  private intentRouter: IntentRouter;

  constructor(config?: IntentRulesConfig) {
    super();
    this.intentRouter = new IntentRouter(config || (DEFAULT_RULES_JSON as IntentRulesConfig));
    this.options = { timeout: 5000, retries: 1 };
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    try {
      // 1. Try regex routing first
      const regexResult = this.tryRegexRoute(ctx.rawUserQuery);

      if (regexResult && !regexResult.needsRewrite) {
        ctx.depth = regexResult.depth as 0 | 1 | 2 | 3;
        ctx.standaloneQuery = ctx.rawUserQuery;
        ctx.detectedIntents = regexResult.intents;
        ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);
        return;
      }

      // 2. LLM fallback for query rewrite (when needed)
      if (regexResult && regexResult.needsRewrite && ctx.llmClient && ctx.toolRegistry && ctx.toolContext) {
        try {
          const response = await runStateLoop(
            ctx.llmClient,
            ctx.toolRegistry,
            ctx.toolContext,
            {
              model: this.model,
              systemPrompt: PROMPT_S0_ROUTER,
              userMessage: buildRouterUserMessage(ctx.rawUserQuery, ctx.chatHistory),
              availableTools: [],
              maxIterations: 1,
              abortSignal: ctx.abortSignal,
            }
          );

          const parsed = parseStateOutput(response.content, RouterOutputSchema);
          ctx.depth = (parsed.depth ?? regexResult.depth) as 0 | 1 | 2 | 3;
          ctx.standaloneQuery = parsed.standalone_query || ctx.rawUserQuery;
          ctx.detectedIntents = regexResult.intents;
        } catch {
          // LLM failed, use regex result
          ctx.depth = regexResult.depth as 0 | 1 | 2 | 3;
          ctx.standaloneQuery = ctx.rawUserQuery;
          ctx.detectedIntents = regexResult.intents;
        }
      } else if (regexResult) {
        // No LLM available, use regex result
        ctx.depth = regexResult.depth as 0 | 1 | 2 | 3;
        ctx.standaloneQuery = ctx.rawUserQuery;
        ctx.detectedIntents = regexResult.intents;
      } else {
        // Fallback to depth 2
        ctx.depth = 2;
        ctx.standaloneQuery = ctx.rawUserQuery;
        ctx.detectedIntents = ['分析阅读-微观检索'];
      }

      ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);
    } catch (error) {
      // Graceful degradation
      ctx.depth = 2;
      ctx.standaloneQuery = ctx.rawUserQuery;
      ctx.markStateExecuted(
        this.name,
        false,
        error instanceof Error ? error.message : String(error),
        Date.now() - startTime
      );
    }
  }

  /**
   * Try to route using regex patterns
   */
  private tryRegexRoute(
    query: string
  ): { depth: number; needsRewrite: boolean; intents: string[] } | null {
    const result = this.intentRouter.analyze(query);

    // Map intents to depth
    let depth = 2; // default
    for (const intent of result.detectedIntents) {
      const mappedDepth = INTENT_TO_DEPTH[intent];
      if (mappedDepth !== undefined) {
        depth = mappedDepth;
        break;
      }
    }

    // Check if query needs rewrite (contains pronouns or is very short)
    const needsRewrite = /(它|这个|那个|他|她)/.test(query) || query.length < 10;

    return { depth, needsRewrite, intents: result.detectedIntents };
  }

  buildSystemPrompt(_ctx: SharedContext): string {
    return PROMPT_S0_ROUTER;
  }
}