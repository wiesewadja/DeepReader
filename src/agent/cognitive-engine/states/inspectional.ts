/**
 * S1: Inspectional Reading State
 *
 * Responsibilities:
 * - Get document outline directly (code-level call, not LLM tool call)
 * - Format tree structure into system prompt
 * - LLM directly reasons and outputs scopeNodeIds
 *
 * Key improvement: Reduces 2 LLM calls to 1 by embedding tree in prompt
 */

import { z } from 'zod';
import { StateNode } from './base';
import type { SharedContext } from '../types';
import { parseStateOutput } from '../parse';
import {
  formatTreeStructure,
  buildInspectionalSystemPrompt,
  buildInspectionalUserMessage,
} from '../prompts/inspectional-prompt';
import type { OutlineNode } from '../../tools/local/types';

// Schema for inspectional output
// scopeNodeIds 允许空数组（表示全局搜索）
// max(100) 允许圈定较大范围，宁可大也不要遗漏
const InspectionalOutputSchema = z.object({
  scopeNodeIds: z.array(z.string()).max(100),
  tocSummary: z.string(),
  better_question: z.string().optional(),
  structural_analysis: z.string().optional(),
});

/**
 * Parse outline JSON from get_document_outline result
 */
function parseOutlineResult(result: string): OutlineNode[] {
  try {
    const parsed = JSON.parse(result);
    if (parsed.status === 'SUCCESS' && Array.isArray(parsed.outline)) {
      return parsed.outline as OutlineNode[];
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

/**
 * S1: Inspectional Reading State
 */
export class InspectionalState extends StateNode {
  readonly name = 'Inspectional';
  readonly model = 'fast' as const;
  readonly tools: string[] = []; // No tools needed - tree is embedded in prompt

  constructor() {
    super();
    this.options = { timeout: 15000, retries: 1 };
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    // Create span from trace context
    const span = ctx.traceContext?.withSpan('inspectional-execute', {
      query: ctx.standaloneQuery || ctx.rawUserQuery,
      pdfName: ctx.pdfName,
    });

    try {
      // Check if engine dependencies are available
      const { llmClientManager, toolRegistry, toolContext } = ctx;
      if (!llmClientManager || !toolRegistry || !toolContext) {
        // Fallback to placeholder for testing
        ctx.scopeNodeIds = ['node_c1', 'node_c2'];
        ctx.tocSummary = 'Based on TOC analysis, chapters 1 and 2 are most relevant.';
        ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);
        return;
      }

      // Step 1: Get document outline directly (code-level call)
      const outlineStartTime = Date.now();
      const outlineResult = await this.getOutline(toolRegistry, toolContext);
      const outlineNodes = parseOutlineResult(outlineResult);

      // Trace outline tool call

      if (outlineNodes.length === 0) {
        // No outline available, fallback to global search
        ctx.scopeNodeIds = [];
        ctx.tocSummary = '无法获取目录结构，使用全局搜索。';
        ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);
        return;
      }

      // Step 2: Format tree structure for prompt
      const treeText = formatTreeStructure(outlineNodes);

      // Step 3: Build system prompt with embedded tree and depth-aware branching
      const systemPrompt = buildInspectionalSystemPrompt(
        treeText,
        ctx.pdfName,
        ctx.depth,
        ctx.docDescription
      );
      const userMessage = buildInspectionalUserMessage(
        ctx.standaloneQuery || ctx.rawUserQuery,
        ctx.depth
      );

      // Trace LLM interaction
      const llmClient = llmClientManager.getClient(this.model);
      const llmGen = span?.withGeneration('inspectional-llm', {
        model: llmClient.getModel(),
        input: { systemPrompt: systemPrompt.slice(0, 200), userMessage: userMessage.slice(0, 200) },
      });

      // Step 4: Call LLM with JSON Mode for structured output
      const llmStartTime = Date.now();
      const response = await llmClient.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        [], // No tools
        { type: 'json_object' } // JSON Mode for structured output
      );
      const llmDuration = Date.now() - llmStartTime;

      // End LLM generation trace
      llmGen?.end({
        output: { finishReason: 'stop' },
        metadata: { contentLength: response.content?.length ?? 0, duration: llmDuration },
      });

      // Step 5: Parse the output with fallback
      // 空数组表示全局搜索，后端会自动跳过 scope 过滤
      const defaultOutput = {
        scopeNodeIds: [] as string[],
        tocSummary: '无法解析目录范围，使用全局搜索。',
        structural_analysis: '',
      };

      try {
        const parsed = parseStateOutput(response.content, InspectionalOutputSchema, defaultOutput);
        ctx.scopeNodeIds = parsed.scopeNodeIds;
        ctx.tocSummary = parsed.tocSummary;
        ctx.betterQuestion = parsed.better_question || ctx.rawUserQuery;
        ctx.structuralAnalysis = parsed.structural_analysis || '';
      } catch {
        // Use fallback on parse error
        ctx.scopeNodeIds = defaultOutput.scopeNodeIds;
        ctx.tocSummary = defaultOutput.tocSummary;
        ctx.betterQuestion = ctx.rawUserQuery;
        ctx.structuralAnalysis = defaultOutput.structural_analysis;
      }

      ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime, 1);

      // End span after all work is done
      span?.end({
        output: { scopeNodeIds: ctx.scopeNodeIds?.length ?? 0 },
      });
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

  /**
   * Get document outline by calling get_document_outline tool directly
   */
  private async getOutline(
    toolRegistry: NonNullable<SharedContext['toolRegistry']>,
    toolContext: NonNullable<SharedContext['toolContext']>
  ): Promise<string> {
    const executor = toolRegistry.get('get_document_outline');
    if (!executor) {
      throw new Error('get_document_outline tool not found in registry');
    }

    return await executor.execute({}, toolContext);
  }

  buildSystemPrompt(ctx: SharedContext): string {
    // This method is kept for backward compatibility
    // The actual prompt is built in execute() with the tree embedded
    return buildInspectionalSystemPrompt(
      '(目录将在执行时获取)',
      ctx.pdfName,
      ctx.depth,
      ctx.docDescription
    );
  }
}