import { formatHistoryBlock, summarizeRecentHistory } from '../../graph/utils/history-summarizer.js';
import { formatterPrompt } from '../core/formatter.js';
import type { ChatMessage } from '../../types.js';

export const MAX_HISTORY_ROUNDS = 3;

export function buildFormatterSystemPrompt(
  memoryContext?: string,
  userProfileSummary?: string,
  isReadingAdvisor?: boolean,
): string {
  const memorySection = memoryContext
    ? `\n<memory>\n${memoryContext}\n</memory>\n`
    : '';

  const profileSection = userProfileSummary
    ? `\n<user_profile>\n${userProfileSummary}\n</user_profile>
<profile_instruction>
你已经了解这个用户。在回复中自然地体现这种了解：
- 找到书中内容与用户经历、关注点或人生阶段的共鸣点，用一两句话点一点
- 如果用户明确要求"结合你的了解"或"推荐"，必须基于 user_profile 中的信息做个性化推荐：筛选最契合用户兴趣的章节，说明为什么适合他
- 语气像老朋友在分享读书心得，不是咨询师在做分析
- 不要强行关联，生硬比沉默更糟糕
</profile_instruction>\n`
    : '';

  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', { hour12: false });
  const timeSection = `\n<current_time>${timeStr}</current_time>\n`;

  const advisorSection = isReadingAdvisor
    ? `\n<advisor_mode>
你是奚童，用户的专属 AI 伴读。用户还没有选中特定书籍，但想和你聊聊阅读相关的话题。
- 如果 <bookshelf> 中有书籍信息，可以基于用户已索引/已读的书籍进行推荐和讨论
- 不要编造 <bookshelf> 中没有的书籍
- 不要输出 Obsidian wiki 链接（没有选中书籍，无法生成有效链接）
- 自然地引导用户探索书架中的书籍，或讨论阅读方法、书单推荐等
- 保持温和、专业、充满书卷气的风格
</advisor_mode>\n`
    : '';

  return `${formatterPrompt.locales.zh.systemPrompt}${timeSection}${advisorSection}${memorySection}${profileSection}`;
}

function countWikiLinks(text: string): number {
  return (text.match(/\[\[[^\]]+\]\]/g) || []).length;
}

export function buildFormatterUserMessage(
  rawUserQuery: string,
  analysisResult: string,
  bookName: string,
  recentHistory?: ChatMessage[],
  tocSummary?: string,
  structuralAnalysis?: string,
  betterQuestion?: string,
  coveredScope?: string,
  multiBook?: boolean,
  retrievalCoverage?: {
    searchedNodeIds: string[];
    currentNodeId?: string;
    isCoverageGap: boolean;
  },
): string {
  const historyText = recentHistory && recentHistory.length > 0
    ? formatHistoryBlock(summarizeRecentHistory(recentHistory, MAX_HISTORY_ROUNDS))
    : '(无历史记录)';
  const structureSection = structuralAnalysis
    ? `\n<structural_analysis>\n${structuralAnalysis}\n</structural_analysis>`
    : '';

  const scopeSection = coveredScope
    ? `\n${coveredScope}`
    : '';

  const retrievalSection = retrievalCoverage
    ? `\n<retrieval_coverage>
本次实际检索覆盖的章节: [${retrievalCoverage.searchedNodeIds.join(', ') || '(无)'}]
用户当前正在阅读的章节: ${retrievalCoverage.currentNodeId || '(未知)'}
${retrievalCoverage.isCoverageGap
  ? `注：上述检索未包含用户当前章节 (${retrievalCoverage.currentNodeId})。L5 状态机重启已在 S2-Pre 处理这种情况，基于当前 <analysis> 给出最准确的回答。`
  : ''}
</retrieval_coverage>`
    : '';

  const effectiveQuery = betterQuestion || rawUserQuery;

  const linkCount = (analysisResult ? countWikiLinks(analysisResult) : 0) + 
                    (structuralAnalysis ? countWikiLinks(structuralAnalysis) : 0);
  const linkCountHint = linkCount > 0
    ? `（系统检测到 analysis 和 structural_analysis 共包含 ${linkCount} 个 wiki 链接，你的最终回复中也必须精准出现这 ${linkCount} 个链接，一个都不能少）`
    : '';

  const bookInstruction = multiBook
    ? `1. wiki 链接硬性要求${linkCountHint}：每一个 [[...]] 链接都必须原样保留在你的回复中。禁止修改其路径和 block_id 部分，禁止漏掉任何一个链接！
2. 别名自然嵌入句中：把别名作为主语、宾语或定语融入句子，使其读起来像一个通顺自然的句子，禁止链接孤立地放在句尾或放在括号内。`
    : `1. wiki 链接硬性要求${linkCountHint}：每一个 [[...]] 链接都必须原样保留在你的回复中。禁止修改其路径和 block_id 部分，禁止漏掉任何一个链接！
2. 别名自然嵌入句中：把别名作为主语、宾语或定语融入句子，使其读起来像一个通顺自然的句子，禁止链接孤立地放在句尾或放在括号内。`;

  return `<history>
${historyText}
</history>
 
<query>${effectiveQuery}</query>
 
<analysis>
${analysisResult || '(无分析结果)'}
</analysis>
${structureSection}${scopeSection}${retrievalSection}<book>${bookName}</book>
 
用奚童的口吻分享你读后的理解。
 
**重要提醒**：
${bookInstruction}
3. 如果有阅读范围信息，在末尾自然地引导用户继续探索。`;
}
