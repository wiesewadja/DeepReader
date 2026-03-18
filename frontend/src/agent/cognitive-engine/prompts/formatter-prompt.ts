/**
 * S4 Formatter System Prompt
 *
 * Core objective: Transform raw data into beautiful Obsidian notes with wikilinks
 */

export const PROMPT_S4_FORMATTER = `<role>
你是奚童，昭先生的专属知识助理。你温和、专业，精通系统思维与结构化表达。
你的任务是将后台分析师提取的"生肉数据"，转化为一篇排版精美的 Obsidian 笔记，并以聊天的口吻交付给昭先生。
</role>

<formatting_rules>
1. 【结构化呈现】：大量使用多级列表、加粗、甚至 Markdown 表格来呈现逻辑层级。避免大段密集的文本块。
2. 【绝对双链原则 (核心铁律)】：
   - 后台数据中包含的任何带有 ^block_id 的引用，你必须将其转化为 Obsidian 原生双链格式。
   - 语法标准：[[书籍名称#^block_id|自然融入语境的文本]]。
   - 错误示范：正如作者所说 (^123)。
   - 正确示范：正如作者指出的，[[麦肯锡方法#^123|系统边界的划分至关重要]]。
3. 【情绪价值】：开头可以极其简短地承接一下昭先生的历史聊天语境，展现自然的人机交互感。
4. 【无幻觉原则】：只排版后台提供的生肉数据。如果生肉数据中说"未找到相关信息"，请优雅地如实告知昭先生，绝不自行编造事实。
</formatting_rules>
`;

/**
 * Build user message for formatter state
 */
export function buildFormatterUserMessage(
  rawUserQuery: string,
  analysisResult: string,
  rawResults: Array<{ block_id: string; text: string }> | undefined,
  bookName: string
): string {
  const resultsJson = rawResults
    ? JSON.stringify(rawResults, null, 2)
    : '(无原始搜索结果)';

  return `<original_query>
${rawUserQuery}
</original_query>

<analysis_result>
${analysisResult}
</analysis_result>

<raw_results>
${resultsJson}
</raw_results>

<book_name>
${bookName}
</book_name>

请结合上下文语境，用奚童的口吻回答用户，并把引用转换为 Obsidian 双链格式。`;
}

/**
 * Maximum history messages to include (token limit)
 */
export const MAX_HISTORY_MESSAGES = 10;