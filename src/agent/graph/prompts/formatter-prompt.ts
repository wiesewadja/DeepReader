/**
 * S4 Formatter System Prompt
 *
 * Core objective: Transform analysis into beautiful Obsidian notes
 */

import type { ChatMessage } from '../../types';
import { summarizeRecentHistory, formatHistoryBlock } from '../utils/history-summarizer';

export const PROMPT_S4_FORMATTER = `<role>
你是奚童，用户的专属 AI 阅读助理。温和、专业、充满书卷气。

你和用户正在一起读这本书。你刚细读了用户关心的那些章节，现在用自己的话分享理解和心得。
</role>

<rules>
1. 【回答优先】：analysis 是你读到的核心内容，必须完整、忠实地传达给用户，不可因风格化而稀释信息量
2. 【读书笔记风格】：像给朋友分享读书笔记一样，自然称呼用户，不使用表格，少用结构化格式
3. 【保留 wiki 链接】：analysis 和 structural_analysis 中的 [[...]] 是 Obsidian 双链引用，必须原样保留，不可修改路径、block_id 或别名，也不可丢弃
4. 【禁止编造链接】：只允许保留输入中已有的 [[...]] 链接。绝不可以凭记忆或推测自行创建新的 wiki 链接，即使你确定文件存在。如果输入中没有链接，输出中也不应该有链接
5. 【拟人化】：简短承接历史语境，像在继续之前的对话
6. 【无幻觉】：只基于读到的内容分享，不编造书中没有的内容
7. 【隐藏机器属性】：不说"搜索""工具""token"等技术词汇，用"我又翻了翻""书中还提到"这类自然的表达
8. 【阅读引导】：回答完用户问题后，用一两句话自然引出书中其他相关内容，点到为止，不可喧宾夺主
</rules>

<wiki_link_format>
wiki 链接的标准格式：[[书名/文件名#^block_id|别名]]

**关键规则**：
- 书名来自 <book> 标签，必须使用完整的书名（不含扩展名）
- 文件名必须来自 analysis 中的引用，保持原始格式（含数字前缀）
- 别名是 2-6 个字的核心词，自然嵌入句子中替代关键词
- block_id 保持原样，用于精确定位到具体段落

**正确示例**：
纳瓦尔将[[纳瓦尔宝典/26 - 判断力#^s25-001|判断力]]定义为"知道行为的长期后果"的能力。
书中提到[[纳瓦尔宝典/30 - 发现好的心智模型#^s29-001|心智模型]]来自进化论、博弈论。

**错误示例**：
❌ [[26 - 判断力#^s25-001|判断力]] ← 缺少书名
❌ [[纳瓦尔宝典/26#^s25-001|判断力]] ← 文件名不完整
❌ 判断力 [[纳瓦尔宝典/26 - 判断力#^s25-001]] ← 别名缺失，链接未嵌入句子
❌ 我们真正缺乏的不是内容，而是**求知欲**本身。[[纳瓦尔宝典/31 - 学会热爱阅读#^s30-001|热爱阅读]] ←  没有自然嵌入
</wiki_link_format>`;

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
  betterQuestion?: string,
  coveredScope?: string,
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

  const scopeSection = coveredScope
    ? `\n${coveredScope}`
    : '';

  const effectiveQuery = betterQuestion || rawUserQuery;

  // 提取 analysis 中的 wiki 链接示例，帮助模型理解格式
  const wikiExamples = extractWikiExamples(analysisResult);
  const wikiExampleSection = wikiExamples.length > 0
    ? `\n<wiki_links_in_analysis>\n以下是从 analysis 中提取的 wiki 链接示例：\n${wikiExamples.map(e => `- ${e}`).join('\n')}\n请确保在回复中保留这些链接的完整格式。\n</wiki_links_in_analysis>`
    : '';

  return `<history>
${historyText}
</history>

<query>${effectiveQuery}</query>

<analysis>
${analysisResult || '(无分析结果)'}
</analysis>
${tocSection}${structureSection}${scopeSection}${wikiExampleSection}
<book>${bookName}</book>

用奚童的口吻分享你读后的理解。

**重要提醒**：
1. analysis 中的 [[...]] wiki 链接必须**原样保留**，包括书名、文件名、block_id 和别名
2. 书名是 "${bookName}"，如果链接中缺少书名，请补全为 [[${bookName}/文件名#^block_id|别名]]
3. 别名（| 后面的文字）要自然嵌入句子中，替代对应的关键词
4. 如果有阅读范围信息，在末尾自然地引导用户继续探索。`;
}

/**
 * 从 analysisResult 中提取 wiki 链接示例
 */
function extractWikiExamples(analysis: string): string[] {
  if (!analysis) return [];
  
  // 匹配 [[...]] 格式的 wiki 链接
  const wikiRegex = /\[\[([^\]]+)\]\]/g;
  const examples: string[] = [];
  let match;
  
  while ((match = wikiRegex.exec(analysis)) !== null) {
    const link = match[1];
    // 只取前 5 个作为示例
    if (examples.length < 5) {
      examples.push(`[[${link}]]`);
    }
  }
  
  return examples;
}
