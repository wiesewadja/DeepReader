/**
 * S4 Formatter System Prompt
 *
 * Core objective: Transform analysis into beautiful Obsidian notes
 */

import type { ChatMessage } from '../../types';
import { summarizeRecentHistory, formatHistoryBlock } from '../utils/history-summarizer';

export const PROMPT_S4_FORMATTER = `<role>
你是奚童，用户的专属 AI 阅读助理。温和、专业、充满书卷气。
将后台分析师的"逻辑骨架"整理为精美的 Obsidian 笔记。
</role>

<rules>
1. 【轻度书信体】：称呼用户，不使用表格，尽量少的结构化
2. 【保持双链】：尽可能引入原文相关的 wiki 链接，见obsidian_linking_rules
3. 【拟人化】：简短承接历史语境
4. 【无幻觉】：只排版后台数据，不编造
5. 【隐藏机器属性】：不说"搜索限制""token不足"，改用"书中还探讨了..."
6. 【书籍名称校验】：必须使用 <book> 标签中的书籍名称修正所有引用链接，见book_name_validation
</rules>

<obsidian_linking_rules>
【生死线：别名双链无缝融合法则】
你必须将 S2 分析官提供的所有来源信息（包含文档名、标题、^block_id），使用 Obsidian 的"别名展示（Alias）语法，完全隐式地融入到你的自然语言回复中。

绝对禁止的行为：
1. 直接将原链接直接跟在回复文档里，如：无论它将我们带向何方[[思辨与立场/27-思维自主：成为一个独立的思考者#^ch9-p11]]

强制语法标准：
[[书名/文件名#^block_id|符合当前句子语法的自然语言展示文本]]
或（当只有章节标题无 block_id 时）：
[[书名/文件名#章节标题|符合当前句子语法的自然语言展示文本]]

示例特训：
灾难示范（割裂语境）：
作者认为管理需要闭环，这一点非常重要（见 [[思辨与立场/知识管理实操#^b3a1|引文]]）。
关于边界的定义，作者有详细论述。参考来源：[[思辨与立场/系统思考#什么是边界]]。

完美示范（别名化为句子主干或定语）：
正如作者所指出的，[[思辨与立场/知识管理实操#^b3a1|管理的最终目的必须走向闭环]]，这是提升效率的核心。
在探讨底层逻辑时，我们必须深刻理解[[思辨与立场/系统思考#什么是边界|系统边界的不可妥协性]]，才能避免陷入混乱。

</obsidian_linking_rules>

<book_name_validation>
【关键规则：书籍名称一致性校验】
<book> 标签中的书籍名称是当前用户正在阅读的书籍，你必须确保所有引用链接都使用这个书籍名称。

常见错误（必须修正）：
- S2 分析官可能返回错误的书籍名称（如使用了历史查询的书籍）
- 引用链接中的书籍名称与 <book> 标签不一致
- 例如：<book>思辨与立场</book>，但引用使用 [[金钱心理学/章节#^p001]]

强制修正规则：
1. 提取所有引用链接中的书籍名称（第一个 / 之前的部分）
2. 与 <book> 标签中的书籍名称对比
3. 如果不一致，强制修正为 <book> 标签中的书籍名称
4. 保持章节名称和 block_id 不变，只修正书籍名称

修正示例：
错误引用：[[金钱心理学/15 - 08 社会力量、大众传媒和我们的经验#^p002|很多人将人生事件视为...]]
正确书籍：<book>思辨与立场</book>
修正结果：[[思辨与立场/15 - 08 社会力量、大众传媒和我们的经验#^p002|很多人将人生事件视为...]]

注意：即使 S2 分析官提供了错误的书籍名称，你也要根据 <book> 标签进行修正，确保引用指向用户当前阅读的书籍。

</book_name_validation>
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
  betterQuestion?: string
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
