import { formatHistoryBlock, summarizeRecentHistory } from '../../graph/utils/history-summarizer.js';
import { formatterPrompt } from '../core/formatter.js';
import type { ChatMessage } from '../../types.js';
import type { ToolResultSnapshot } from '../../graph/state.js';

export const MAX_HISTORY_ROUNDS = 3;

export function buildFormatterSystemPrompt(
  memoryContext?: string,
  userProfileSummary?: string,
  isReadingAdvisor?: boolean,
  enableFollowUp?: boolean,
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

  const notesInstructionSection = `
<user_notes_instruction>
若输入中存在 <current_chapter_user_notes>，表示用户在当前阅读章节做过的高亮划线与批注笔记：
- 请优先在回答中以极度自然的方式融入或印证这些高亮划线内容，例如提及“关于你划线的这部分...”，或者结合用户的批注来展开分析。
- 绝不要刻意机械地堆砌高亮内容。如果划线很多，应找出最贴合用户当下提问的一两处，将其点出作为回答的抓手。
</user_notes_instruction>
`;

  const followUpSection = enableFollowUp
    ? `\n<follow_up_instruction>
在回复的最末尾，根据 <user_profile> 和 <memory>（如果存在）以及本次书籍分析，自然地提出**一个**个性化的追问：
- 这个追问必须是为用户量身定制的，结合其经历、痛点、或者读书目标，引导用户将书中的智慧与自己的真实生活/工作行动进行关联（例如：“你之前提到在带团队，对于这一章提到的分权，你打算如何在下周的周会上实践一下？”）
- 语气要自然、温和、充满探索欲，像真正的读书伙伴在聊天中随口一问。
- 绝不要使用机械化、套路化或居高临下的模板式追问（如“你觉得呢？”、“这对你有什么启发？”）。
- 如果没有可参考的用户画像/记忆信息，或者强行关联显得极其尴尬，则只提一个简短的、结合本章内容与用户当前困惑的高质量启发性问题即可。
- 追问要极其克制，合并在最后一个段落中，或者单起一行，长度在一两句话以内。
</follow_up_instruction>\n`
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

  return `${formatterPrompt.locales.zh.systemPrompt}${timeSection}${advisorSection}${memorySection}${profileSection}${notesInstructionSection}${followUpSection}`;
}

function countWikiLinks(text: string): number {
  return (text.match(/\[\[[^\]]+\]\]/g) || []).length;
}

/** 一段检索原文 + 其全部 block_id（按 snapshot 记录聚合，原文只喂一次以省 token） */
export interface RetrievedBlock {
  fileName: string;
  blockIds: string[];
  excerpt: string;
}

const DEFAULT_MAX_RETRIEVED_BLOCKS = 5;
const DEFAULT_MAX_CHARS_PER_BLOCK = 400;

/**
 * 从 toolResultsSnapshot 按记录聚合提取 block 原文，供 formatter prompt 就地引用。
 *
 * 一条 snapshot 记录 = 一次 search_book = 一段原文（可能含多个 blockId，见
 * tool-execution.ts extractBlockIdsFromResult）。按记录聚合（非按 blockId 平铺）
 * 让同一段原文在 prompt 里只出现一次，避免 token 浪费。
 *
 * 跳过：node_id 缺失 / nodeFileMap 无映射 / extractedBlockIds 空 / result 空。
 * 跨记录去重相同 blockId；受 maxBlocks / maxCharsPerBlock 限制。
 */
export function extractRetrievedBlocks(
  snapshot: ToolResultSnapshot[],
  nodeFileMap: Record<string, string>,
  opts: { maxBlocks?: number; maxCharsPerBlock?: number } = {},
): RetrievedBlock[] {
  const maxBlocks = opts.maxBlocks ?? DEFAULT_MAX_RETRIEVED_BLOCKS;
  const maxChars = opts.maxCharsPerBlock ?? DEFAULT_MAX_CHARS_PER_BLOCK;
  const seen = new Set<string>();
  const out: RetrievedBlock[] = [];

  for (const rec of snapshot) {
    if (out.length >= maxBlocks) break;
    const nodeId = rec.args?.node_id;
    const rawIds = rec.extractedBlockIds ?? [];
    const excerpt = rec.result || '';
    if (typeof nodeId !== 'string' || !nodeId || rawIds.length === 0 || !excerpt) continue;
    const rawFile = nodeFileMap[nodeId];
    if (!rawFile) continue;
    // extractedBlockIds 不带 ^（extractBlockIdsFromResult 捕获组已剥离前缀）
    const blockIds = rawIds.filter(id => id && !seen.has(id));
    if (blockIds.length === 0) continue;
    blockIds.forEach(id => seen.add(id));
    out.push({
      fileName: rawFile.replace(/\.md$/, ''),
      blockIds,
      excerpt: excerpt.length > maxChars ? excerpt.slice(0, maxChars) : excerpt,
    });
  }
  return out;
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
  userNotesContext?: string,
  retrievedBlocks?: RetrievedBlock[],
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

  const notesSection = userNotesContext
    ? `\n<current_chapter_user_notes>\n${userNotesContext}\n</current_chapter_user_notes>\n`
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

  // wiki 链接提醒（multiBook 与单书文案一致，曾误分两分支，已合并）
  const bookInstruction = `1. wiki 链接硬性要求${linkCountHint}：每一个 [[...]] 链接都必须原样保留在你的回复中。禁止修改其路径 and block_id 部分，禁止漏掉任何一个链接！
2. 别名自然嵌入句中：把别名作为主语、宾语或定语融入句子，使其读起来像一个通顺自然的句子，禁止链接孤立地放在句尾或放在括号内。`;

  // Epic #9：把检索命中的 block 原文喂进 prompt，供 LLM 就地引用 block 级链接
  const retrievedSection = retrievedBlocks && retrievedBlocks.length > 0
    ? `\n<retrieved_blocks>\n${retrievedBlocks.map(b => {
        const prefix = multiBook ? '' : `${bookName}/`;
        const idsStr = b.blockIds.map(id => `#^${id}`).join(' ');
        return `【${prefix}${b.fileName}${idsStr}】\n${b.excerpt}`;
      }).join('\n\n')}\n（每段原文可对应多个 block_id，引用时按语义择一，生成 [[书/文件#^blockId|2-6字别名]]）\n</retrieved_blocks>\n`
    : '';

  return `<history>
${historyText}
</history>

<query>${effectiveQuery}</query>

<analysis>
${analysisResult || '(无分析结果)'}
</analysis>
${structureSection}${scopeSection}${notesSection}${retrievalSection}${retrievedSection}<book>${bookName}</book>
 
用奚童的口吻分享你读后的理解。
 
**重要提醒**：
${bookInstruction}
3. 如果有阅读范围信息，在末尾自然地引导用户继续探索。`;
}
