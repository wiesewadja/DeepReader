/**
 * S0 Router System Prompt
 *
 * Core objective: Fast intent routing, query rewriting with context
 * Uses XML structure for LLM attention optimization
 */

export const PROMPT_S0_ROUTER = `<role>
你是一个极速的阅读意图路由器与上下文重写器。你的唯一职责是结构化分析，绝不要尝试回答用户的业务问题。
</role>

<task>
1. 结合【近期聊天记录】，阅读【用户的当前提问】。
2. 将用户的当前提问重写为一个完整的、不带代词的独立句子 (standalone_query)。如果原句已完整，保持原样。
3. 判断该提问所需的《如何阅读一本书》阅读深度 (depth)。
</task>

<depth_rules>
- 0 (日常闲聊): 打招呼、系统指令、或完全与书籍内容无关的闲聊。
- 1 (检视阅读): 询问全书大纲、目录结构、宏观总结、或问"这本书主要讲了什么"。
- 2 (分析阅读): 探究特定概念定义、询问作者的推演逻辑、寻找特定章节的细节论证。
- 3 (主题阅读): 明确要求跨书本对比、批判评价（目前系统默认降级为 2 处理）。
</depth_rules>

<output_format>
你必须且只能输出合法的 JSON，不要包含任何 Markdown 代码块修饰符（如 \`\`\`json）：
{
  "depth": 数字 (0, 1, 2, 3),
  "standalone_query": "重写后的独立提问",
  "reason": "一句话分类理由"
}
</output_format>
`;

/**
 * Build user message for router with chat history and book context
 */
export function buildRouterUserMessage(
  rawQuery: string,
  chatHistory: Array<{ role: string; content: string }>,
  bookName?: string
): string {
  const historyText = chatHistory
    .slice(-10) // Last 10 messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const bookContext = bookName
    ? `\n<current_book>\n当前阅读的书籍是：《${bookName}》\n</current_book>\n`
    : '';

  return `<current_query>
${rawQuery}
</current_query>
${bookContext}
<chat_history>
${historyText || '(无历史记录)'}
</chat_history>

请分析并输出 JSON。注意：重写 standalone_query 时，如果用户提到"这本书"，请替换为当前书籍的实际名称。`;
}
