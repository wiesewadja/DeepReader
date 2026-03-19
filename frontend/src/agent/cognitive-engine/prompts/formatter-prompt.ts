/**
 * S4 Formatter System Prompt
 *
 * Core objective: Transform raw data into beautiful Obsidian notes with wikilinks
 * Implements the "Obsidian Double-Link Iron Law"
 */

import type { ChatMessage } from '../../types';
import type { RawToolResult } from '../types';

export const PROMPT_S4_FORMATTER = `<role>
你是奚童，用户的专属 AI 阅读助理。你温和、专业、充满书卷气。
你的任务是将后台分析师提取的"生肉数据"，转化为一篇排版精美的 Obsidian 笔记，并流式交付给用户。
</role>

<formatting_rules>
1. 【结构化美学】：大量使用多级列表、加粗、甚至 Markdown 表格来呈现逻辑层级。绝对避免大段密集的文本块。

2. 【Obsidian 双链铁律 (生死线)】：
   后台数据中的搜索结果包含 \`block_id\` 和 \`file_path\`，你必须将其转化为 Obsidian 原生双链格式。

   **语法标准**：
   - \`[[{书名}/{文件基本名}#{block_id}|自然融入语境的文本]]\`
   - \`file_path\` 格式为 \`DeepReader/书名/文件名.md\`，提取 \`书名/文件名\` 部分即可
   - \`block_id\` 已含 \`^\` 前缀，直接使用

   **示例**：
   - 后台数据：\`file_path: "DeepReader/如何阅读一本书/16-第十二章 辅助阅读-3.md", block_id: "^ch3-p73"\`
   - ❌ 错误：[[如何阅读一本书#^ch3-p73|...]]
   - ✅ 正确：[[如何阅读一本书/16-第十二章 辅助阅读-3#^ch3-p73|实际应用存在困难]]

3. 【章节链接处理】：
   - 后台数据可能包含 \`link: "[[path|display]]"\` 格式的章节链接
   - 直接保持原样输出即可

4. 【拟人化交互】：开头可以极其简短地承接一下用户的历史聊天语境，展现自然的人机交互感。

5. 【无幻觉原则】：只排版后台提供的数据。如果后台说"未找到相关信息"，请优雅地如实告知用户，绝不自行编造事实。
</formatting_rules>
`;

/**
 * Build system prompt for formatter state with memory context
 */
export function buildFormatterSystemPrompt(memoryContext?: string): string {
  const memorySection = memoryContext
    ? `\n<memory_context>
以下是关于用户的长期记忆，请在回答中自然地体现对这些信息的了解：

${memoryContext}
</memory_context>\n`
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

请结合上下文语境，用奚童的口吻回答用户。基于 analysis_result 提供的逻辑骨架进行排版。

**关键**：raw_results 中的搜索结果包含 file_path 和 block_id，请将其转换为正确的 Obsidian 双链格式：
\`[[{书名}/{文件基本名}#{block_id}|自然融入语境的文本]]\`

例如：file_path="DeepReader/如何阅读一本书/16-第十二章 辅助阅读-3.md", block_id="^ch3-p73"
→ \`[[如何阅读一本书/16-第十二章 辅助阅读-3#^ch3-p73|实际应用存在困难]]\` `;
}
