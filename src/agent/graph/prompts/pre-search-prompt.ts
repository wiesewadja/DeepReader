/**
 * S2-Pre: Pre-search early-stop prompt - Backward Compatible Re-export
 *
 * This file re-exports from the new prompt registry for backward compatibility.
 * New code should import from '@/agent/prompts/core/pre-search.js' instead.
 */

import { preSearchPrompt } from '../../prompts/core/pre-search.js';

/**
 * Build the direct-response prompt for early-stop path.
 */
export function buildEarlyStopPrompt(
  systemPrompt: string,
  blockLines: string[],
  userQuery: string,
  pdfName: string,
): string {
  return `${systemPrompt}\n\n${preSearchPrompt.locales.zh.systemPrompt}

<pre_search_results>
${blockLines.join('\n\n')}
</pre_search_results>

用户问题：${userQuery}`;
}

// Also export the new prompt module for new code
export { preSearchPrompt };
