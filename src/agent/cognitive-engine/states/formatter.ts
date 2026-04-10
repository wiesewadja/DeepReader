/**
 * S4: Formatter State
 *
 * Responsibilities:
 * - Transform raw analysis into formatted Obsidian notes
 * - Convert block_ids to wikilinks
 * - Maintain conversation continuity
 *
 * Key: Injects history (with token limit), no tools
 */

import { StateNode } from './base';
import type { SharedContext, EngineCallbacks } from '../types';
import { PROMPT_S4_FORMATTER, buildFormatterUserMessage, buildFormatterSystemPrompt, MAX_HISTORY_MESSAGES } from '../prompts/formatter-prompt';
import { runStateLoop } from './run-state-loop';
import { verifyAndCleanContent } from '../utils/self-verification';

export { MAX_HISTORY_MESSAGES };

/**
 * S4: Formatter State
 */
export class FormatterState extends StateNode {
  readonly name = 'Formatter';
  readonly model = 'main' as const;
  readonly tools: string[] = []; // No tools!

  private callbacks?: EngineCallbacks;

  constructor(callbacks?: EngineCallbacks) {
    super();
    this.callbacks = callbacks;
    this.options = { timeout: 30000, retries: 1 };
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    try {
      // Check if engine dependencies are available
      if (!ctx.llmClientManager || !ctx.toolRegistry || !ctx.toolContext) {
        // Fallback for testing - output raw analysis
        const output = ctx.analysisResult || 'No analysis result available.';
        this.callbacks?.onContent?.(output);
        ctx.markStateExecuted(this.name, true, undefined, Date.now() - startTime);
        return;
      }

      // Token limit: truncate history
      const recentHistory = ctx.chatHistory.slice(-MAX_HISTORY_MESSAGES);

      // Use runStateLoop for actual LLM calls
      const response = await runStateLoop(
        ctx.llmClientManager,
        ctx.toolRegistry,
        ctx.toolContext,
        {
          stateName: this.name,
          model: this.model,
          systemPrompt: this.buildSystemPrompt(ctx),
          userMessage: buildFormatterUserMessage(
            ctx.betterQuestion || ctx.standaloneQuery || ctx.rawUserQuery,
            ctx.analysisResult || '',
            ctx.pdfName,
            recentHistory,
            ctx.tocSummary,
            ctx.structuralAnalysis,
            ctx.betterQuestion
          ),
          availableTools: [],
          maxIterations: 1,
          abortSignal: ctx.abortSignal,
          traceContext: ctx.traceContext,
        },
        {
          onContent: (text) => {
            this.callbacks?.onContent?.(text);
          },
          onProgress: (status) => {
            this.callbacks?.onProgress?.(status);
          },
        }
      );

      // The content is already streamed via callbacks
      // Store final content to ctx.analysisResult for saveSession
      if (response.content) {
        ctx.analysisResult = response.content;
      }

      // Self-Verification：使用 S2 工具调用结果验证 S4 输出中的 block_id 引用
      if (ctx.s2ToolResults && ctx.s2ToolResults.length > 0 && response.content) {
        const verifyResult = await verifyAndCleanContent(
          response.content,
          ctx.s2ToolResults,
          { traceContext: ctx.traceContext }
        );
        if (response.content !== verifyResult.content) {
          ctx.analysisResult = verifyResult.content;
        }
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

  buildSystemPrompt(ctx: SharedContext): string {
    return buildFormatterSystemPrompt(ctx.memoryContext);
  }
}