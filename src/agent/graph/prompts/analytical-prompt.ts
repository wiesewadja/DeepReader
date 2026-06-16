/**
 * S2 Analytical Reading System Prompt - Backward Compatible Re-export
 *
 * This file re-exports from the new prompt registry for backward compatibility.
 * New code should import from '@/agent/prompts/core/analytical.js' instead.
 */

import { analyticalPrompt } from '../../prompts/core/analytical.js';
import type { HistorySummary } from '../utils/history-summarizer';
import { formatHistoryBlock, formatPrevSearchedBlock } from '../utils/history-summarizer';

export interface AnalyticalPromptContext {
  scopeNodeIds?: string[];
  tocSummary?: string;
  betterQuestion?: string;
}

export function buildAnalyticalPrompt(_ctx: AnalyticalPromptContext): string {
  return analyticalPrompt.locales.zh.systemPrompt;
}

export const PROMPT_S2_ANALYTICAL_TEMPLATE = buildAnalyticalPrompt({});

/**
 * Build system prompt for analytical state with scope
 */
export function buildAnalyticalSystemPrompt(ctx: {
  scopeNodeIds: string[];
  tocSummary?: string;
  currentNodeId?: string;
  currentChapterName?: string;
  userProfileSummary?: string;
}): string {
  const scopeList = ctx.scopeNodeIds.length > 0
    ? ctx.scopeNodeIds.map(id => `- ${id}`).join('\n')
    : '- (全局搜索，无范围限制)';

  const searchHints = ctx.tocSummary
    ? `\n<search_hints>\n${ctx.tocSummary}\n</search_hints>`
    : '';

  const currentChapterHint = ctx.currentNodeId
    ? `\n<current_chapter_priority>
用户当前正在阅读的章节是 node_id=${ctx.currentNodeId}${ctx.currentChapterName ? `（${ctx.currentChapterName}）` : ''}。
**重要**：在分析时，请优先使用该章节的内容来回答问题。如果该章节包含相关内容，应该首先引用该章节，然后再引用其他章节。
</current_chapter_priority>`
    : '';

  const userProfileBlock = ctx.userProfileSummary
    ? `\n<user_profile>\n${ctx.userProfileSummary}\n</user_profile>
<profile_instruction>
你已经了解这个用户。在分析时留意书中内容与用户关注点的交集，在 analysis 中适当点出这些共鸣，帮助用户将阅读与自身经历联系起来。点到为止，不展开个人分析。
</profile_instruction>`
    : '';

  return `${analyticalPrompt.locales.zh.systemPrompt}
${searchHints}${currentChapterHint}${userProfileBlock}
<locked_scope>
搜索范围限定：
${scopeList}
</locked_scope>`;
}

/**
 * Build user message for analytical state
 */
export function buildAnalyticalUserMessage(
  standaloneQuery: string,
  betterQuestion?: string,
  recentHistory?: HistorySummary[],
  prevSearchedBlockIds?: string[]
): string {
  const historyBlock = recentHistory && recentHistory.length > 0
    ? formatHistoryBlock(recentHistory) + '\n'
    : '';

  const prevBlock = prevSearchedBlockIds && prevSearchedBlockIds.length > 0
    ? formatPrevSearchedBlock(prevSearchedBlockIds) + '\n'
    : '';

  if (betterQuestion && betterQuestion !== standaloneQuery) {
    return `${historyBlock}${prevBlock}<original_query>${standaloneQuery}</original_query>
<refined_query>${betterQuestion}</refined_query>

在限定范围内分析，提取关键内容并附带 block_id。`;
  }
  return `${historyBlock}${prevBlock}<query>
${standaloneQuery}
</query>

在限定范围内分析，提取关键内容并附带 block_id。`;
}

// Also export the new prompt module for new code
export { analyticalPrompt };
