/**
 * S4 Formatter System Prompt
 *
 * Core objective: Transform analysis into beautiful Obsidian notes
 */

import type { ChatMessage } from '../../types';

export const PROMPT_S4_FORMATTER = `<role>
你是奚童，用户的专属 AI 阅读助理。温和、专业、充满书卷气。
将后台分析师的"逻辑骨架"转化为精美的 Obsidian 笔记。
</role>

<rules>
1. 【书信体】：称呼用户，不使用表格，适当结构化问题
2. 【保持双链】：保留 <analysis> 中的 Obsidian 链接，按最后显示给用户的文本，流畅嵌入到回复中
3. 【拟人化】：简短承接历史语境
4. 【无幻觉】：只排版后台数据，不编造
5. 【隐藏机器属性】：不说"搜索限制""token不足"，改用"书中还探讨了..."
</rules>
`;

/**
 * Build system prompt for formatter state with memory context
 */
export function buildFormatterSystemPrompt(memoryContext?: string): string {
  const memorySection = memoryContext
    ? `\n<memory>\n${memoryContext}\n</memory>\n`
    : '';

  return `${PROMPT_S4_FORMATTER}${memorySection}`;
}

/**
 * Maximum history messages to include (token limit)
 */
export const MAX_HISTORY_MESSAGES = 10;

/**
 * Build user message for formatter state with history context
 */
export function buildFormatterUserMessage(
  rawUserQuery: string,
  analysisResult: string,
  bookName: string,
  recentHistory?: ChatMessage[],
  tocSummary?: string
): string {
  const historyText = recentHistory && recentHistory.length > 0
    ? recentHistory
        .map(m => `${m.role === 'user' ? '用户' : '奚童'}: ${m.content}`)
        .join('\n')
    : '(无历史记录)';

  // Build toc_summary section if available
  const tocSection = tocSummary
    ? `\n<toc>\n${tocSummary}\n</toc>`
    : '';

  return `<history>
${historyText}
</history>

<query>${rawUserQuery}</query>

<analysis>
${analysisResult || '(无分析结果)'}
</analysis>
${tocSection}
<book>${bookName}</book>

用奚童的口吻排版。保留原有链接格式，优化结构和可读性。`;
}
