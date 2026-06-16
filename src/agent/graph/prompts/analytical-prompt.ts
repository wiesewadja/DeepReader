/**
 * S2 Analytical Reading System Prompt - Backward Compatible Re-export
 *
 * This file re-exports from the new prompt registry for backward compatibility.
 * New code should import from '@/agent/prompts/utils.js' instead.
 */

export { buildFullAnalyticalContext, buildScopedChaptersBlock, buildAnalyticalUserMessage } from '../../prompts/utils.js';
export { analyticalPrompt } from '../../prompts/core/analytical.js';

import { analyticalPrompt } from '../../prompts/core/analytical.js';

export interface AnalyticalPromptContext {
  scopeNodeIds?: string[];
  tocSummary?: string;
  betterQuestion?: string;
}

export function buildAnalyticalPrompt(_ctx: AnalyticalPromptContext): string {
  return analyticalPrompt.locales.zh.systemPrompt;
}

export const PROMPT_S2_ANALYTICAL_TEMPLATE = buildAnalyticalPrompt({});

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
