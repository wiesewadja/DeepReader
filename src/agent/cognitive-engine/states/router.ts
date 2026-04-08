/**
 * S0: Router + Query Rewriter State
 *
 * Responsibilities:
 * 1. Determine reading depth (0, 1, 2, 3) using LLM
 * 2. Rewrite ambiguous queries to standalone form
 *
 * Routing: LLM-based intent classification
 */

import { z } from 'zod';
import { StateNode } from './base';
import type { SharedContext } from '../types';
import { parseStateOutput } from '../parse';
import { PROMPT_S0_ROUTER, buildRouterUserMessage } from '../prompts/router-prompt';
import { runStateLoop } from './run-state-loop';

// Schema for router output
const RouterOutputSchema = z.object({
  depth: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  standalone_query: z.string().optional(),
  reason: z.string().optional(),
});

/**
 * S0: Router + Query Rewriter
 */
export class RouterState extends StateNode {
  readonly name = 'Router';
  readonly model = 'fast' as const;
  readonly tools: string[] = [];

  constructor() {
    super();
    this.options = { timeout: 10000, retries: 1 };
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    try {
      // 检查引擎依赖是否可用
      if (!ctx.llmClientManager || !ctx.toolRegistry || !ctx.toolContext) {
        // 回退到默认深度 2
        ctx.depth = 2;
        ctx.standaloneQuery = ctx.rawUserQuery;
        ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);
        return;
      }

      // 使用 LLM 进行意图识别和查询重写
      const response = await runStateLoop(
        ctx.llmClientManager,
        ctx.toolRegistry,
        ctx.toolContext,
        {
          model: this.model,
          systemPrompt: PROMPT_S0_ROUTER,
          userMessage: buildRouterUserMessage(ctx.rawUserQuery, ctx.chatHistory, ctx.pdfName),
          availableTools: [],
          maxIterations: 1,
          abortSignal: ctx.abortSignal,
        }
      );

      // 解析 LLM 输出
      const defaultOutput = {
        depth: 2 as 0 | 1 | 2 | 3,
        standalone_query: ctx.rawUserQuery,
      };

      const parsed = parseStateOutput(response.content, RouterOutputSchema, defaultOutput);
      ctx.depth = (parsed.depth ?? 2) as 0 | 1 | 2 | 3;
      ctx.standaloneQuery = parsed.standalone_query || ctx.rawUserQuery;

      ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime, response.iterations);
    } catch (error) {
      // 优雅降级：使用默认深度
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

  buildSystemPrompt(_ctx: SharedContext): string {
    return PROMPT_S0_ROUTER;
  }
}
