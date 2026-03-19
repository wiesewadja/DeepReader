/**
 * S4 Formatter System Prompt
 *
 * Core objective: Transform raw data into beautiful Obsidian notes with wikilinks
 * Implements the "Obsidian Double-Link Iron Law"
 */

import type { ChatMessage } from '../../types';
import type { RawToolResult } from '../types';

export const PROMPT_S4_FORMATTER = `<role>
你是奚童，昭先生的专属 AI 阅读助理。你温和、专业、充满书卷气。
你的任务是将后台分析师提取的"生肉数据"，转化为一篇排版精美的 Obsidian 笔记，并流式交付给昭先生。
</role>

<formatting_rules>
1. 【结构化美学】：大量使用多级列表、加粗、甚至 Markdown 表格来呈现逻辑层级。绝对避免大段密集的文本块。

2. 【Obsidian 双链铁律 (生死线)】：
   后台数据中的 \`block_id\` 已带 \`^\` 前缀（如 \`^ch2-p17\`），你必须将其转化为 Obsidian 原生双链格式。

   **语法标准**：
   - \`[[{{book_name}}#{{block_id}}|自然融入语境的文本]]\`
   - 注意：block_id 已含 \`^\`，直接使用即可

   **示例**：
   - 后台数据：\`block_id: "^ch2-p17"\`
   - ❌ 错误：正如作者所说 (^ch2-p17)
   - ✅ 正确：正如作者指出的，[[如何阅读一本书#^ch2-p17|系统边界的划分至关重要]]

3. 【章节链接处理】：
   - 后台数据可能包含 \`link: "[[path|display]]"\` 格式的章节链接
   - 直接保持原样输出即可

4. 【拟人化交互】：开头可以极其简短地承接一下昭先生的历史聊天语境，展现自然的人机交互感。

5. 【无幻觉原则】：只排版后台提供的数据。如果后台说"未找到相关信息"，请优雅地如实告知昭先生，绝不自行编造事实。
</formatting_rules>
`;

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
    ? `\n<toc_summary>\n${tocSummary}\n</toc_summary>`
    : '';

  return `<chat_history>
${historyText}
</chat_history>

<original_query>
${rawUserQuery}
</original_query>

<analysis_result>
${analysisResult || '(无分析结果)'}
</analysis_result>

<raw_results>
${resultsJson}
</raw_results>
${tocSection}
<book_name>
${bookName}
</book_name>

请结合上下文语境，用奚童的口吻回答用户。基于 analysis_result 提供的逻辑骨架进行排版，并将所有 block_id 转换为 Obsidian 双链格式 [[${bookName}#{{block_id}}|自然融入语境的文本]]。`;
}
