/**
 * S1: Inspectional Reading State
 *
 * Responsibilities:
 * - Get TOC and lock chapter scope
 * - Only has get_toc tool (physically deprived of search_doc)
 *
 * Key constraint: Does NOT see chat history, only uses standaloneQuery
 */

import { z } from 'zod';
import { StateNode } from './base';
import type { SharedContext } from '../types';
import { parseStateOutput } from '../parse';
import { PROMPT_S1_INSPECTIONAL, buildInspectionalUserMessage } from '../prompts/inspectional-prompt';

// Schema for inspectional output
const InspectionalOutputSchema = z.object({
  scopeNodeIds: z.array(z.string()).min(1).max(5),
  tocSummary: z.string(),
});

/**
 * S1: Inspectional Reading State
 */
export class InspectionalState extends StateNode {
  readonly name = 'Inspectional';
  readonly model = 'fast' as const;
  readonly tools = ['get_toc']; // Only get_toc!

  constructor() {
    super();
    this.options = { timeout: 15000, retries: 1 };
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    try {
      // Note: In production, this would:
      // 1. Call get_toc tool via LLM
      // 2. Parse the LLM response to extract scopeNodeIds
      // For now, we set a placeholder

      // The actual implementation would use runStateLoop:
      // const response = await runStateLoop({
      //   model: this.model,
      //   systemPrompt: this.buildSystemPrompt(ctx),
      //   userMessage: ctx.standaloneQuery,
      //   availableTools: this.tools,
      //   // Note: No chatHistory passed!
      // });
      // const parsed = parseStateOutput(response.content, InspectionalOutputSchema);
      // ctx.scopeNodeIds = parsed.scopeNodeIds;
      // ctx.tocSummary = parsed.tocSummary;

      // Placeholder for testing
      ctx.scopeNodeIds = ['node_c1', 'node_c2'];
      ctx.tocSummary = 'Based on TOC analysis, chapters 1 and 2 are most relevant.';

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

  buildSystemPrompt(_ctx: SharedContext): string {
    return PROMPT_S1_INSPECTIONAL;
  }
}