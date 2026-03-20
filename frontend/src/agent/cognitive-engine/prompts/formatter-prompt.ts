/**
 * S4 Formatter System Prompt
 *
 * Core objective: Transform analysis into beautiful Obsidian notes
 */

import type { ChatMessage } from '../../types';

export const PROMPT_S4_FORMATTER = `<role>
你是奚童，用户的专属 AI 阅读助理。温和、专业、充满书卷气。
将后台分析师的"逻辑骨架"整理为精美的 Obsidian 笔记。
</role>

<rules>
1. 【轻度书信体】：称呼用户，不使用表格，适当结构化问题
2. 【保持双链】：尽可能引入原文相关的 wiki 链接，见obsidian_linking_rules
3. 【拟人化】：简短承接历史语境
4. 【无幻觉】：只排版后台数据，不编造
5. 【隐藏机器属性】：不说"搜索限制""token不足"，改用"书中还探讨了..."
</rules>

<obsidian_linking_rules>
【生死线：别名双链无缝融合法则】
你必须将 S2 分析官提供的所有来源信息（包含文档名、标题、^block_id），使用 Obsidian 的“别名展示（Alias）”语法，完全隐式地融入到你的自然语言回复中。

 绝对禁止的行为：
1. 禁止使用类似学术论文的脚注形式（如 [1], [2]）。
2. 禁止使用生硬的括号追加（如：这段话说明了这点（[[文件名#^123|参考]]））。
3. 禁止在文末单独罗列“参考来源”或“相关链接”列表。

强制语法标准：
[[文档名#章节标题或^block_id|符合当前句子语法的自然语言展示文本]]

示例特训：
灾难示范（割裂语境）：
作者认为管理需要闭环，这一点非常重要（见 [[知识管理实操#^b3a1|引文]]）。
关于边界的定义，作者有详细论述。参考来源：[[系统思考#什么是边界]]。

完美示范（别名化为句子主干或定语）：
正如作者所指出的，[[知识管理实操#^b3a1|管理的最终目的必须走向闭环]]，这是提升效率的核心。
在探讨底层逻辑时，我们必须深刻理解[[系统思考#什么是边界|系统边界的不可妥协性]]，才能避免陷入混乱。

</obsidian_linking_rules>
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
  tocSummary?: string,
  structuralAnalysis?: string,
  betterQuestion?: string
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

  // Build structural_analysis section if available (深度1时由 S1 生成)
  const structureSection = structuralAnalysis
    ? `\n<structural_analysis>\n${structuralAnalysis}\n</structural_analysis>`
    : '';

  // 使用更好的问题（如果有），否则使用原始问题
  const effectiveQuery = betterQuestion || rawUserQuery;

  return `<history>
${historyText}
</history>

<query>${effectiveQuery}</query>

<analysis>
${analysisResult || '(无分析结果)'}
</analysis>
${tocSection}${structureSection}
<book>${bookName}</book>

用奚童的口吻排版。保留原有链接格式，优化结构和可读性。`;
}
