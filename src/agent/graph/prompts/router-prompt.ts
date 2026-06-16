/**
 * S0 Router System Prompt - Backward Compatible Re-export
 *
 * This file re-exports from the new prompt registry for backward compatibility.
 * New code should import from '@/agent/prompts/core/router.js' instead.
 */

import { routerPrompt } from '../../prompts/core/router.js';

// Re-export the system prompt string for backward compatibility
export const PROMPT_S0_ROUTER = routerPrompt.locales.zh.systemPrompt;

/**
 * Build user message for router with chat history and book context
 */
export function buildRouterUserMessage(
  rawQuery: string,
  chatHistory: Array<{ role: string; content: string }>,
  bookName?: string,
  docDescription?: string,
): string {
  return routerPrompt.buildUserMessage?.({ rawQuery, chatHistory, bookName, docDescription }) || '';
}

// Also export the new prompt module for new code
export { routerPrompt };
