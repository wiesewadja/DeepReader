// src/agent/prompts/utils.ts

/**
 * Prompt utility functions
 *
 * These functions were previously in the old prompt files.
 * They are now centralized here for reuse.
 */

import type { HistorySummary } from '../graph/utils/history-summarizer.js';
import { formatHistoryBlock, formatPrevSearchedBlock, summarizeRecentHistory } from '../graph/utils/history-summarizer.js';
import type { OutlineNode } from '../graph/tools/local/types.js';
import { formatterPrompt } from './core/formatter.js';
import { preSearchPrompt } from './core/pre-search.js';
import { analyticalPrompt } from './core/analytical.js';

// ═══ Tree Structure Formatting ═══

export function formatTreeStructure(
  nodes: OutlineNode[],
  indent: number = 0,
  maxTextLength: number = 100,
  maxDepth: number = 4,
  bookName: string = ''
): string {
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;

    const prefix = '    '.repeat(indent) + (isLast ? '└── ' : '├── ');

    const fullLink = bookName && node.file_name
      ? `[[${bookName}/${node.file_name}]]`
      : node.file_name ? `[[${node.file_name}]]` : '';
    const linkPart = fullLink ? `, link: ${fullLink}` : '';
    const titleLine = `${prefix}${node.heading} (node_id: ${node.node_id}${linkPart})`;
    lines.push(titleLine);

    if (node.summary && indent < maxDepth) {
      const truncatedSummary = node.summary.length > maxTextLength
        ? node.summary.slice(0, maxTextLength) + '...'
        : node.summary;
      const summaryPrefix = '    '.repeat(indent + 1) + '摘要: ';
      lines.push(`${summaryPrefix}${truncatedSummary}`);
    }

    if (node.children && node.children.length > 0 && indent < maxDepth) {
      const childText = formatTreeStructure(node.children, indent + 1, maxTextLength, maxDepth, bookName);
      lines.push(childText);
    }
  }

  return lines.join('\n');
}

// ═══ Scoped Chapters Block ═══

export function buildScopedChaptersBlock(
  scopeNodeIds: string[],
  markdownFiles: Record<string, string>,
  nodeFileMap?: Record<string, string>
): string {
  if (scopeNodeIds.length === 0) return '';

  const lines: string[] = [];

  for (const nodeId of scopeNodeIds) {
    const indexFileName = nodeFileMap?.[nodeId]?.replace(/\.md$/, '');
    if (indexFileName) {
      lines.push(`- node_id: ${nodeId}, file_name: "${indexFileName}"`);
      continue;
    }

    const numericPart = nodeId.replace(/^0+/, '');
    const matchedKey = Object.keys(markdownFiles).find(key => {
      const fileName = key.split('/').pop() ?? '';
      const fileNumMatch = fileName.match(/^(\d+)\s*-\s*/);
      if (fileNumMatch) {
        const fileNum = fileNumMatch[1].replace(/^0+/, '');
        return fileNum === numericPart;
      }
      return false;
    });

    if (matchedKey) {
      const fileName = matchedKey.split('/').pop() ?? '';
      const fileNameForLink = fileName.replace(/\.md$/, '');
      lines.push(`- node_id: ${nodeId}, file_name: "${fileNameForLink}"`);
    } else {
      lines.push(`- node_id: ${nodeId}`);
    }
  }

  const inner = lines.join('\n');
  const full = `<scoped_chapters>\n${inner}\n</scoped_chapters>`;

  if (full.length > 1500) {
    const truncated = full.slice(0, 1500 - '...[已截断]'.length);
    return `${truncated}...[已截断]`;
  }

  return full;
}

// ═══ Formatter Helpers ═══

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

export const MAX_HISTORY_ROUNDS = 3;

export function buildFormatterUserMessage(
  rawUserQuery: string,
  analysisResult: string,
  bookName: string,
  recentHistory?: Array<{ role: string; content: string }>,
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

  const bookInstruction = multiBook
    ? `1. analysis 和 structural_analysis 中的 [[...]] wiki 链接必须原样保留，不可修改或删除书名前缀
2. 别名要自然嵌入句子中，替代对应的关键词`
    : `1. analysis 和 structural_analysis 中的 [[...]] wiki 链接必须原样保留
2. 别名要自然嵌入句子中，替代对应的关键词`;

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

// ═══ Proactive Helpers ═══

const PROACTIVE_FORMATTER_SYSTEM = `<role>
你是奚童，用户的阅读伙伴。你现在不是在回答问题，而是在引导用户主动思考。你是"助产士"角色——通过提问帮助用户自己生出理解。
</role>

<rules>
1. 基于提供的结构分析，提出**一个**具体的问题。不要给出答案或总结
2. 问题必须让用户思考才能回答，不能用"是/否"敷衍
3. 问题必须锚定在书的具体章节、概念或论证结构上，不能泛泛而谈
4. 语气自然、温暖，像朋友在聊天中随口问了一句，不像老师在考试
5. 回复不超过 3 句话。简短有力
6. 不要用"你觉得"开头（太模板化），用更自然的方式引出问题
</rules>`;

const PROACTIVE_FORMATTER_SYSTEM_HIGHLIGHT = `<role>
你是奚童，用户的阅读伙伴。你现在不是在回答问题，而是在引导用户主动思考。你是"助产士"角色——通过提问帮助用户自己生出理解。
</role>

<rules>
1. 基于用户划线的内容，提出**一个**追问。不要总结划线内容
2. 问题要挖掘用户为什么划这些内容——它戳到了用户的什么经历、假设或困惑
3. 如果多条划线之间有关联或张力，指出这种关系并追问
4. 语气自然、温暖，像朋友在聊天中随口问了一句
5. 回复不超过 3 句话。简短有力
6. 不要用"你觉得"开头（太模板化），用更自然的方式引出问题
</rules>`;

const PROACTIVE_FORMATTER_SYSTEM_DIAGRAM = `<role>
你是奚童，用户的阅读伙伴。你刚为用户生成了一张书籍结构图，现在要基于这个可视化引导用户主动思考。你是"助产士"角色——通过提问帮助用户自己生出理解。
</role>

<rules>
1. 自然地提到刚生成的结构图（保留 [[...]] 格式的链接），然后基于图中的结构提出**一个**具体问题
2. 问题必须让用户思考才能回答，不能用"是/否"敷衍
3. 问题必须锚定在图中的具体分支、节点或结构关系上
4. 语气自然、温暖，像朋友在聊天中随口问了一句
5. 回复不超过 3 句话。简短有力
6. 不要用"你觉得"开头
7. [[...]] 格式的链接必须原样保留，不要修改或删除
</rules>`;

export function buildProactiveSystemPrompt(
  trigger: 'inspectional' | 'highlight' | 'chapter',
  hasDiagram?: boolean,
): string {
  if (trigger === 'inspectional' && hasDiagram) return PROACTIVE_FORMATTER_SYSTEM_DIAGRAM;
  if (trigger === 'inspectional') return PROACTIVE_FORMATTER_SYSTEM;
  return PROACTIVE_FORMATTER_SYSTEM_HIGHLIGHT;
}

export function buildProactiveUserMessage(params: {
  structuralAnalysis?: string;
  tocSummary?: string;
  highlightContext?: string[];
  bookName: string;
}): string {
  const parts: string[] = [];

  if (params.structuralAnalysis) {
    parts.push(`<structural_analysis>\n${params.structuralAnalysis}\n</structural_analysis>`);
  }
  if (params.tocSummary) {
    parts.push(`<toc>\n${params.tocSummary}\n</toc>`);
  }
  if (params.highlightContext && params.highlightContext.length > 0) {
    parts.push(`<user_highlights>\n${params.highlightContext.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n</user_highlights>`);
  }
  parts.push(`<book>${params.bookName}</book>`);

  return parts.join('\n\n');
}

// ═══ Socratic Dialogue Helpers ═══

const SOCRATIC_DIALOGUE_SYSTEM = `<role>
你是奚童，用户的阅读伙伴。你正在通过苏格拉底式对话引导用户深度理解一本书。你是"助产士"——通过提问帮助用户自己生出理解。
</role>

<rules>
1. 基于对话历史中的书籍分析内容，简短回应用户的回答（1句话肯定或补充，可引用 [[...]] 链接）
2. 然后提出一个追问，引导用户思考更深层的问题
3. 追问必须锚定在书的具体内容上，不能泛泛而谈
4. 语气自然、温暖，像朋友在聊天中随口问了一句
5. 回复不超过 3 句话。简短有力
6. 不要用"你觉得"开头
</rules>`;

export function buildSocraticDialoguePrompt(): string {
  return SOCRATIC_DIALOGUE_SYSTEM;
}

export function buildSocraticDialogueUserMessage(
  userReply: string,
  chatHistory: Array<{ role: string; content: string }>,
): string {
  const recent = chatHistory.slice(-6);
  const historyLines = recent.map(m => {
    const label = m.role === 'user' ? '用户' : 'AI';
    const flat = m.content.replace(/\n/g, ' ');
    const text = flat.length <= 500 ? flat : flat.slice(0, 300) + ' ... ' + flat.slice(-200);
    return `${label}: ${text}`;
  }).join('\n');

  return `<conversation_history>
${historyLines}
</conversation_history>

<user_reply>
${userReply}
</user_reply>`;
}

// ═══ Early Stop Prompt ═══

export function buildEarlyStopPrompt(
  systemPrompt: string,
  blockLines: string[],
  userQuery: string,
  pdfName: string,
): string {
  return `${systemPrompt}\n\n${preSearchPrompt.locales.zh.systemPrompt}

<pre_search_results>
${blockLines.join('\n\n')}
</pre_search_results>

用户问题：${userQuery}`;
}

// ═══ Full Analytical Context ═══

export function buildFullAnalyticalContext(params: {
  scopeNodeIds: string[];
  tocSummary?: string;
  currentNodeId?: string;
  currentChapterName?: string;
  userProfileSummary?: string;
  markdownFiles: Record<string, string>;
  nodeFileMap?: Record<string, string>;
  standaloneQuery: string;
  betterQuestion?: string;
  recentHistorySummaries?: HistorySummary[];
  prevSearchedBlockIds?: string[];
  skipUserMessage?: boolean;
}): { fullSystemPrompt: string; userMessage?: string } {
  const scopeList = params.scopeNodeIds.length > 0
    ? params.scopeNodeIds.map(id => `- ${id}`).join('\n')
    : '- (全局搜索，无范围限制)';

  const searchHints = params.tocSummary
    ? `\n<search_hints>\n${params.tocSummary}\n</search_hints>`
    : '';

  const currentChapterHint = params.currentNodeId
    ? `\n<current_chapter_priority>
用户当前正在阅读的章节是 node_id=${params.currentNodeId}${params.currentChapterName ? `（${params.currentChapterName}）` : ''}。
**重要**：在分析时，请优先使用该章节的内容来回答问题。如果该章节包含相关内容，应该首先引用该章节，然后再引用其他章节。
</current_chapter_priority>`
    : '';

  const userProfileBlock = params.userProfileSummary
    ? `\n<user_profile>\n${params.userProfileSummary}\n</user_profile>
<profile_instruction>
你已经了解这个用户。在分析时留意书中内容与用户关注点的交集，在 analysis 中适当点出这些共鸣，帮助用户将阅读与自身经历联系起来。点到为止，不展开个人分析。
</profile_instruction>`
    : '';

  const systemPrompt = `${analyticalPrompt.locales.zh.systemPrompt}
${searchHints}${currentChapterHint}${userProfileBlock}
<locked_scope>
搜索范围限定：
${scopeList}
</locked_scope>`;

  const scopedChapters = buildScopedChaptersBlock(params.scopeNodeIds, params.markdownFiles, params.nodeFileMap);
  const fullSystemPrompt = scopedChapters
    ? `${systemPrompt}\n${scopedChapters}`
    : systemPrompt;

  if (params.skipUserMessage) {
    return { fullSystemPrompt };
  }

  const historyBlock = params.recentHistorySummaries && params.recentHistorySummaries.length > 0
    ? formatHistoryBlock(params.recentHistorySummaries) + '\n'
    : '';

  const prevBlock = params.prevSearchedBlockIds && params.prevSearchedBlockIds.length > 0
    ? formatPrevSearchedBlock(params.prevSearchedBlockIds) + '\n'
    : '';

  let userMessage: string;
  if (params.betterQuestion && params.betterQuestion !== params.standaloneQuery) {
    userMessage = `${historyBlock}${prevBlock}<original_query>${params.standaloneQuery}</original_query>
<refined_query>${params.betterQuestion}</refined_query>

在限定范围内分析，提取关键内容并附带 block_id。`;
  } else {
    userMessage = `${historyBlock}${prevBlock}<query>
${params.standaloneQuery}
</query>

在限定范围内分析，提取关键内容并附带 block_id。`;
  }

  return { fullSystemPrompt, userMessage };
}
