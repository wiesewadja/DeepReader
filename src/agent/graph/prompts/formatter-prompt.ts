/**
 * S4 Formatter System Prompt
 *
 * Core objective: Transform analysis into beautiful Obsidian notes
 */

import type { ChatMessage } from '../../types';
import { summarizeRecentHistory, formatHistoryBlock } from '../utils/history-summarizer';

export const PROMPT_S4_FORMATTER = `<role>
你是奚童，用户的专属 AI 阅读助理。温和、专业、充满书卷气。

你和用户正在一起读这本书。你刚细读了用户关心的那些章节，现在用自己的话分享理解和心得。
</role>

<rules>
1. 【回答优先】：analysis 是你读到的核心内容，必须完整、忠实地传达给用户，不可因风格化而稀释信息量
2. 【读书笔记风格】：像给朋友分享读书笔记一样，自然称呼用户，不使用表格，少用结构化格式
3. 【拟人化】：简短承接历史语境，像在继续之前的对话
4. 【无幻觉】：只基于读到的内容分享，不编造书中没有的内容
5. 【隐藏机器属性】：不说"搜索""工具""token"等技术词汇，用"我又翻了翻""书中还提到"这类自然的表达
6. 【阅读引导】：回答完用户问题后，用一两句话自然引出书中其他相关内容，点到为止，不可喧宾夺主
</rules>
`;

/**
 * Build system prompt for formatter state with memory context
 */
export function buildFormatterSystemPrompt(memoryContext?: string): string {
  const memorySection = memoryContext
    ? `\n<memory>\n${memoryContext}\n</memory>\n`
    : '';

  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', { hour12: false });
  const timeSection = `\n<current_time>${timeStr}</current_time>\n`;

  return `${PROMPT_S4_FORMATTER}${timeSection}${memorySection}`;
}

/**
 * Maximum history rounds to summarize (token limit)
 */
export const MAX_HISTORY_ROUNDS = 3;

/**
 * Build user message for formatter state with summarized history
 */
export function buildFormatterUserMessage(
  rawUserQuery: string,
  analysisResult: string,
  bookName: string,
  recentHistory?: ChatMessage[],
  tocSummary?: string,
  structuralAnalysis?: string,
  betterQuestion?: string,
  coveredScope?: string,
): string {
  // Use compact summaries instead of full message text to reduce token cost
  const historyText = recentHistory && recentHistory.length > 0
    ? formatHistoryBlock(summarizeRecentHistory(recentHistory, MAX_HISTORY_ROUNDS))
    : '(无历史记录)';

  const tocSection = tocSummary
    ? `\n<toc>\n${tocSummary}\n</toc>`
    : '';

  const structureSection = structuralAnalysis
    ? `\n<structural_analysis>\n${structuralAnalysis}\n</structural_analysis>`
    : '';

  const scopeSection = coveredScope
    ? `\n${coveredScope}`
    : '';

  const effectiveQuery = betterQuestion || rawUserQuery;

  return `<history>
${historyText}
</history>

<query>${effectiveQuery}</query>

<analysis>
${analysisResult || '(无分析结果)'}
</analysis>
${tocSection}${structureSection}${scopeSection}
<book>${bookName}</book>

用奚童的口吻分享你读后的理解。如果有阅读范围信息，在末尾自然地引导用户继续探索。`;
}
