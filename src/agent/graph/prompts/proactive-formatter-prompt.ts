/**
 * Proactive Formatter prompts - Backward Compatible Re-export
 *
 * This file re-exports from the new prompt registry for backward compatibility.
 * New code should import from '@/agent/prompts/core/proactive.js' instead.
 */

import { proactivePrompt } from '../../prompts/core/proactive.js';

export function buildProactiveSystemPrompt(
  trigger: 'inspectional' | 'highlight' | 'chapter',
  hasDiagram?: boolean,
): string {
  return proactivePrompt.locales.zh.systemPrompt;
}

export function buildProactiveUserMessage(params: {
  structuralAnalysis?: string;
  tocSummary?: string;
  highlightContext?: string[];
  bookName: string;
}): string {
  const parts: string[] = [];

  if (params.structuralAnalysis) {
    parts.push(`<structural_analysis>\n${params.structuralAnalysis}\n</structural_analysis>`);
  }
  if (params.tocSummary) {
    parts.push(`<toc>\n${params.tocSummary}\n</toc>`);
  }
  if (params.highlightContext && params.highlightContext.length > 0) {
    parts.push(`<user_highlights>\n${params.highlightContext.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n</user_highlights>`);
  }
  parts.push(`<book>${params.bookName}</book>`);

  return parts.join('\n\n');
}

// Also export the new prompt module for new code
export { proactivePrompt };
