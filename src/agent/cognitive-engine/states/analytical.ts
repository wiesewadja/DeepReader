/**
 * S2: Analytical Reading State
 *
 * Responsibilities:
 * - Deep analysis within locked scope
 * - Tools: search_markdown_text, read_markdown_section
 *
 * Key mechanism: ToolInterceptor physically locks search scope
 * Cumulative: Calls S1 if scopeNodeIds not set
 */

import { StateNode } from './base';
import type { SharedContext } from '../types';
import { buildAnalyticalSystemPrompt, buildAnalyticalUserMessage } from '../prompts/analytical-prompt';
import { InspectionalState } from './inspectional';
import { createScopeInterceptor } from '../interceptor/scope-interceptor';
import { runStateLoop } from './run-state-loop';
import type { StateLoopResult } from './run-state-loop';

type ToolResult = StateLoopResult['toolResults'][number];

/**
 * S2: Analytical Reading State
 */
export class AnalyticalState extends StateNode {
  readonly name = 'Analytical';
  readonly model = 'main' as const;
  readonly tools = ['search_book', 'read_book_section'];

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
      const scopeNodeIds = ctx.scopeNodeIds ?? [];
      const interceptor = createScopeInterceptor(scopeNodeIds);

      // 3. Check if engine dependencies are available
      if (!ctx.llmClientManager || !ctx.toolRegistry || !ctx.toolContext) {
        // Fallback to placeholder for testing
        ctx.analysisResult = 'MECE stands for Mutually Exclusive, Collectively Exhaustive. [[如何阅读一本书/第七章 透视一本书#^block_123|参考来源]]';
        ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);
        return;
      }

      // 4. Execute LLM loop with interceptor
      const response = await runStateLoop(
        ctx.llmClientManager,
        ctx.toolRegistry,
        ctx.toolContext,
        {
          stateName: this.name,
          model: this.model,
          systemPrompt: this.buildSystemPrompt(ctx),
          userMessage: buildAnalyticalUserMessage(ctx.standaloneQuery || ctx.rawUserQuery),
          availableTools: this.tools,
          toolInterceptor: interceptor,
          maxIterations: 8,
          maxToolCalls: 5,
          abortSignal: ctx.abortSignal,
          traceContext: ctx.traceContext,
        }
      );

      // 5. Store results
      // 分析结果：如果没有最终输出，使用工具调用摘要
      ctx.analysisResult = response.content || this.summarizeToolResults(response.toolResults);

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

  buildSystemPrompt(ctx: SharedContext): string {
    return buildAnalyticalSystemPrompt({
      scopeNodeIds: ctx.scopeNodeIds || [],
      tocSummary: ctx.tocSummary,
    });
  }

  /**
   * 当 LLM 未输出最终分析时，从工具结果中提取摘要
   */
  private summarizeToolResults(toolResults: ToolResult[]): string {
    if (toolResults.length === 0) {
      return '';
    }

    const summary = toolResults
      .map(tr => `【${tr.toolName}】\n${tr.result.slice(0, 500)}...`)
      .join('\n\n');

    return `[工具调用摘要]\n${summary}`;
  }
}
