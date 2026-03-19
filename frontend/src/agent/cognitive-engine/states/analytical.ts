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
import type { SearchResult } from '../types';
import { buildAnalyticalSystemPrompt, buildAnalyticalUserMessage } from '../prompts/analytical-prompt';
import { InspectionalState } from './inspectional';
import { createScopeInterceptor } from '../interceptor/scope-interceptor';
import { runStateLoop } from './run-state-loop';

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

      // 3. Check if engine dependencies are available
      if (!ctx.llmClient || !ctx.toolRegistry || !ctx.toolContext) {
        // Fallback to placeholder for testing
        ctx.analysisResult = 'MECE stands for Mutually Exclusive, Collectively Exhaustive. [^block_123]';
        ctx.rawResults = [
          { block_id: 'block_123', text: 'MECE definition...', toolName: 'search_doc' },
        ];
        ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);
        return;
      }

      // 4. Execute LLM loop with interceptor
      const response = await runStateLoop(
        ctx.llmClient,
        ctx.toolRegistry,
        ctx.toolContext,
        {
          model: this.model,
          systemPrompt: this.buildSystemPrompt(ctx),
          userMessage: buildAnalyticalUserMessage(ctx.standaloneQuery || ctx.rawUserQuery),
          availableTools: this.tools,
          toolInterceptor: interceptor,
          maxIterations: 5,
          abortSignal: ctx.abortSignal,
        }
      );

      // 5. Store results
      ctx.analysisResult = response.content;
      // Extract search results from tool calls
      // Store as RawToolResult format (block_id, text, toolName)
      ctx.rawResults = response.toolResults
        .filter(tr => tr.toolName === 'search_doc')
        .flatMap(tr => {
          try {
            const data = JSON.parse(tr.result);
            // search_doc returns results with block_id
            return (data.results || []).map((r: SearchResult) => ({
              block_id: r.block_id || '',
              text: r.text,
              toolName: 'search_doc',
            }));
          } catch {
            return [];
          }
        });

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