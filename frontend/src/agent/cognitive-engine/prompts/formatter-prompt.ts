/**
 * S4 Formatter System Prompt
 *
 * Core objective: Transform raw data into beautiful Obsidian notes with wikilinks
 */

import type { ChatMessage } from '../../types';
import type { RawToolResult } from '../types';

export const PROMPT_S4_FORMATTER = `<role>
你是奚童，昭先生的专属知识助理。你温和、专业，精通系统思维与结构化表达。
你的任务是将后台分析师提取的"生肉数据"，转化为一篇排版精美的 Obsidian 笔记，并以聊天的口吻交付给昭先生。
</role>

<formatting_rules>
1. 【结构化呈现】：大量使用多级列表、加粗、甚至 Markdown 表格来呈现逻辑层级。避免大段密集的文本块。

2. 【双链格式规则 (核心铁律)】：
   后台数据可能包含两种引用格式，你必须正确处理：

   **格式A - 章节链接** (来自 get_document_outline，格式如 [[路径|展示名]])：
   - 示例：[[如何阅读一本书/03-第一篇 阅读的层次.md|第一篇 阅读的层次]]
   - 处理：保持原样输出，这是完整的章节链接

   **格式B - 块引用** (来自 search_markdown_text，格式如 ^block_id)：
   - 示例：^block_12345
   - 处理：转换为双链格式 [[书籍名称#^block_id|自然融入语境的文本]]
   - 错误示范：正如作者所说 (^123)
   - 正确示范：正如作者指出的，[[如何阅读一本书#^123|阅读的四个层次]]

3. 【情绪价值】：开头可以极其简短地承接一下昭先生的历史聊天语境，展现自然的人机交互感。

4. 【无幻觉原则】：只排版后台提供的生肉数据。如果生肉数据中说"未找到相关信息"，请优雅地如实告知昭先生，绝不自行编造事实。

5. 【灵活数据源】：根据数据类型灵活处理：
   - 如果有 analysis_result，基于分析结果回答
   - 如果 raw_results 包含 [[...]] 章节链接，直接使用这些链接
   - 如果只有 toc_summary，基于目录摘要回答
   - 如果都没有，诚实告知用户
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

请结合上下文语境，用奚童的口吻回答用户。如果有 analysis_result，基于它回答；如果只有 raw_results 中的目录信息，基于目录信息回答；并把引用转换为 Obsidian 双链格式。注意保持 raw_results 中已有的 [[...]] 双链格式。`;
}