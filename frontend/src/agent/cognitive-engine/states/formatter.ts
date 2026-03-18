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
import type { SharedContext } from '../types';
import { PROMPT_S4_FORMATTER, buildFormatterUserMessage, MAX_HISTORY_MESSAGES } from '../prompts/formatter-prompt';

export { MAX_HISTORY_MESSAGES };

/**
 * S4: Formatter State
 */
export class FormatterState extends StateNode {
  readonly name = 'Formatter';
  readonly model = 'main' as const;
  readonly tools: string[] = []; // No tools!

  constructor() {
    super();
    this.options = { timeout: 30000, retries: 1 };
  }

  async execute(ctx: SharedContext): Promise<void> {
    const startTime = Date.now();

    try {
      // Token limit: truncate history
      const recentHistory = ctx.chatHistory.slice(-MAX_HISTORY_MESSAGES);

      // Build messages for LLM
      // Note: In production, this would call streamLLM
      // const messages = [
      //   { role: 'system', content: this.buildSystemPrompt(ctx) },
      //   ...recentHistory,
      //   { role: 'user', content: buildFormatterUserMessage(...) }
      // ];
      // await streamLLM({ model: this.model, messages, onContent: ... });

      // Placeholder: The formatted output would be streamed to onContent callback
      // For now, we just mark the state as executed

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
    return PROMPT_S4_FORMATTER;
  }
}