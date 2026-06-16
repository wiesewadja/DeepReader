import type { HistorySummary } from '../../graph/utils/history-summarizer.js';
import { formatHistoryBlock, formatPrevSearchedBlock } from '../../graph/utils/history-summarizer.js';
import { analyticalPrompt } from '../core/analytical.js';
import { buildScopedChaptersBlock } from './scoped-chapters.js';

export function buildFullAnalyticalContext(params: {
  scopeNodeIds: string[];
  tocSummary?: string;
  currentNodeId?: string;
  currentChapterName?: string;
  userProfileSummary?: string;
  markdownFiles: Record<string, string>;
  nodeFileMap?: Record<string, string>;
  standaloneQuery: string;
  betterQuestion?: string;
  recentHistorySummaries?: HistorySummary[];
  prevSearchedBlockIds?: string[];
  skipUserMessage?: boolean;
}): { fullSystemPrompt: string; userMessage?: string } {
  const scopeList = params.scopeNodeIds.length > 0
    ? params.scopeNodeIds.map(id => `- ${id}`).join('\n')
    : '- (全局搜索，无范围限制)';

  const searchHints = params.tocSummary
    ? `\n<search_hints>\n${params.tocSummary}\n</search_hints>`
    : '';

  const currentChapterHint = params.currentNodeId
    ? `\n<current_chapter_priority>
用户当前正在阅读的章节是 node_id=${params.currentNodeId}${params.currentChapterName ? `（${params.currentChapterName}）` : ''}。
**重要**：在分析时，请优先使用该章节的内容来回答问题。如果该章节包含相关内容，应该首先引用该章节，然后再引用其他章节。
</current_chapter_priority>`
    : '';

  const userProfileBlock = params.userProfileSummary
    ? `\n<user_profile>\n${params.userProfileSummary}\n</user_profile>
<profile_instruction>
你已经了解这个用户。在分析时留意书中内容与用户关注点的交集，在 analysis 中适当点出这些共鸣，帮助用户将阅读与自身经历联系起来。点到为止，不展开个人分析。
</profile_instruction>`
    : '';

  const systemPrompt = `${analyticalPrompt.locales.zh.systemPrompt}
${searchHints}${currentChapterHint}${userProfileBlock}
<locked_scope>
搜索范围限定：
${scopeList}
</locked_scope>`;

  const scopedChapters = buildScopedChaptersBlock(params.scopeNodeIds, params.markdownFiles, params.nodeFileMap);
  const fullSystemPrompt = scopedChapters
    ? `${systemPrompt}\n${scopedChapters}`
    : systemPrompt;

  if (params.skipUserMessage) {
    return { fullSystemPrompt };
  }

  const historyBlock = params.recentHistorySummaries && params.recentHistorySummaries.length > 0
    ? formatHistoryBlock(params.recentHistorySummaries) + '\n'
    : '';

  const prevBlock = params.prevSearchedBlockIds && params.prevSearchedBlockIds.length > 0
    ? formatPrevSearchedBlock(params.prevSearchedBlockIds) + '\n'
    : '';

  let userMessage: string;
  if (params.betterQuestion && params.betterQuestion !== params.standaloneQuery) {
    userMessage = `${historyBlock}${prevBlock}<original_query>${params.standaloneQuery}</original_query>
<refined_query>${params.betterQuestion}</refined_query>

在限定范围内分析，提取关键内容并附带 block_id。`;
  } else {
    userMessage = `${historyBlock}${prevBlock}<query>
${params.standaloneQuery}
</query>

在限定范围内分析，提取关键内容并附带 block_id。`;
  }

  return { fullSystemPrompt, userMessage };
}
