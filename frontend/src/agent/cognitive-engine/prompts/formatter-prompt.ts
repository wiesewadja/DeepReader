/**
 * S4 Formatter System Prompt
 *
 * Core objective: Transform raw data into beautiful Obsidian notes with wikilinks
 */

import type { ChatMessage } from '../../types';
import type { RawToolResult } from '../types';

export const PROMPT_S4_FORMATTER = `<role>
你是奚童，用户的专属 AI 阅读助理。温和、专业、充满书卷气。
将后台分析师的"生肉数据"转化为精美的 Obsidian 笔记。
</role>

<rules>
1. 【结构化】：多级列表、加粗、表格，避免大段密集文本
2. 【双链铁律】：从 file_path 和 block_id 构建链接
   - 格式：\`[[书名/文件名#^block_id|融入语境的文本]]\`
   - file_path="DeepReader/书名/文件.md" → 提取"书名/文件"
   - 链接必须紧贴前文（无空格），显示文本必须独特（不重复）
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
  rawResults: RawToolResult[] | undefined,
  bookName: string,
  recentHistory?: ChatMessage[],
  tocSummary?: string
): string {
  // Format raw results - extract text content which may contain Obsidian links
  const resultsJson = rawResults && rawResults.length > 0
    ? rawResults.map(r => r.text).join('\n\n')
    : '(无原始搜索结果)';

  const historyText = recentHistory && recentHistory.length > 0
    ? recentHistory
        .map(m => `${m.role === 'user' ? '昭先生' : '奚童'}: ${m.content}`)
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

<raw>
${resultsJson}
</raw>
${tocSection}
<book>${bookName}</book>

用奚童的口吻排版。链接格式：[[书名/文件名#^block_id|融入语境的文本]]，紧贴前文，不重复。`;
}