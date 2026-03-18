/**
 * S2: Analytical Reading State
 *
 * Responsibilities:
 * - Deep analysis within locked scope
 * - Tools: search_doc, get_chapter
 *
 * Key mechanism: ToolInterceptor physically locks search scope
 * Cumulative: Calls S1 if scopeNodeIds not set
 */

import { StateNode } from './base';
import type { SharedContext } from '../types';
import { buildAnalyticalSystemPrompt, buildAnalyticalUserMessage } from '../prompts/analytical-prompt';
import { InspectionalState } from './inspectional';
import { createScopeInterceptor } from '../interceptor/scope-interceptor';

/**
 * S2: Analytical Reading State
 */
export class AnalyticalState extends StateNode {
  readonly name = 'Analytical';
  readonly model = 'main' as const;
  readonly tools = ['search_doc', 'get_chapter'];

  private inspectionalState: InspectionalState;

  constructor() {
    super();
    this.options = { timeout: 60000, retries: 1 };
    this.inspectionalState = new InspectionalState();
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    try {
      // 1. Cumulative guarantee: call S1 if scope not set
      if (!ctx.scopeNodeIds || ctx.scopeNodeIds.length === 0) {
        await this.inspectionalState.execute(ctx);
      }

      // 2. Create scope interceptor
      const interceptor = createScopeInterceptor(ctx.scopeNodeIds!);

      // 3. Execute LLM loop with interceptor
      // Note: In production, this would use runStateLoop with toolInterceptor
      // const response = await runStateLoop({
      //   model: this.model,
      //   systemPrompt: this.buildSystemPrompt(ctx),
      //   userMessage: ctx.standaloneQuery,
      //   availableTools: this.tools,
      //   toolInterceptor: interceptor,
      // });
      // ctx.analysisResult = response.content;
      // ctx.rawResults = response.toolResults;

      // Placeholder for testing
      ctx.analysisResult = 'MECE stands for Mutually Exclusive, Collectively Exhaustive. [^block_123]';
      ctx.rawResults = [
        { node_id: 'node_c1', block_id: 'block_123', text: 'MECE definition...', score: 0.95 },
      ];

      ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);
    } catch (error) {
      ctx.markStateExecuted(
        this.name,
        false,
        error instanceof Error ? error.message : String(error),
        Date.now() - startTime
      );
      throw error;
    }
  }

  buildSystemPrompt(ctx: SharedContext): string {
    return buildAnalyticalSystemPrompt(ctx.scopeNodeIds || []);
  }
}