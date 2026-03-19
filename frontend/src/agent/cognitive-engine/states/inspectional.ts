/**
 * S1: Inspectional Reading State
 *
 * Responsibilities:
 * - Get document outline and lock chapter scope
 * - Only has get_document_outline tool (physically deprived of search_markdown_text)
 *
 * Key constraint: Does NOT see chat history, only uses standaloneQuery
 */

import { z } from 'zod';
import { StateNode } from './base';
import type { SharedContext } from '../types';
import { parseStateOutput } from '../parse';
import { PROMPT_S1_INSPECTIONAL, buildInspectionalUserMessage } from '../prompts/inspectional-prompt';
import { runStateLoop } from './run-state-loop';

// Schema for inspectional output
// scopeNodeIds 允许空数组（表示全局搜索）
const InspectionalOutputSchema = z.object({
  scopeNodeIds: z.array(z.string()).max(5),
  tocSummary: z.string(),
});

/**
 * S1: Inspectional Reading State
 */
export class InspectionalState extends StateNode {
  readonly name = 'Inspectional';
  readonly model = 'fast' as const;
  readonly tools = ['get_document_outline']; // Only get_document_outline!

  constructor() {
    super();
    this.options = { timeout: 15000, retries: 1 };
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    try {
      // Check if engine dependencies are available
      if (!ctx.llmClient || !ctx.toolRegistry || !ctx.toolContext) {
        // Fallback to placeholder for testing
        ctx.scopeNodeIds = ['node_c1', 'node_c2'];
        ctx.tocSummary = 'Based on TOC analysis, chapters 1 and 2 are most relevant.';
        ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);
        return;
      }

      // Use runStateLoop for actual LLM calls
      const response = await runStateLoop(
        ctx.llmClient,
        ctx.toolRegistry,
        ctx.toolContext,
        {
          model: this.model,
          systemPrompt: this.buildSystemPrompt(ctx),
          userMessage: buildInspectionalUserMessage(ctx.standaloneQuery || ctx.rawUserQuery),
          availableTools: this.tools,
          maxIterations: 3,
          abortSignal: ctx.abortSignal,
        }
      );

      // Parse the output with fallback
      // 空数组表示全局搜索，后端会自动跳过 scope 过滤
      const defaultOutput = {
        scopeNodeIds: [] as string[],
        tocSummary: '无法解析目录范围，使用全局搜索。',
      };

      try {
        const parsed = parseStateOutput(response.content, InspectionalOutputSchema, defaultOutput);
        ctx.scopeNodeIds = parsed.scopeNodeIds;
        ctx.tocSummary = parsed.tocSummary;
      } catch {
        // Use fallback on parse error
        ctx.scopeNodeIds = defaultOutput.scopeNodeIds;
        ctx.tocSummary = defaultOutput.tocSummary;
      }

      // Store tool results for Formatter (contains Obsidian links)
      // For depth=1 (inspectional reading), these are the primary data source
      if (response.toolResults.length > 0) {
        ctx.rawResults = response.toolResults.map(tr => ({
          block_id: '',  // TOC results don't have block_id
          text: tr.result,
          toolName: tr.toolName,
        }));
      }

      ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime, response.iterations);
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