/**
 * S1 Inspectional Reading System Prompt
 *
 * Core objective: Context-aware inspectional reading.
 * - Depth 1: Generate structural analysis (独立作答)
 * - Depth 2/3: Lock scope for analytical reading (打辅助)
 *
 * LLM directly reasons on the formatted tree structure (no tool call needed).
 */

import type { OutlineNode } from '../../tools/local/types';
import { z } from 'zod';
import { ReadingDepth } from '../state.js';
import { formatHistoryBlock, type HistorySummary } from '../utils/history-summarizer.js';

/**
 * Format tree structure for LLM prompt
 */
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

/**
 * Build system prompt for inspectional state with depth-aware branching
 */
export function buildInspectionalSystemPrompt(
  treeText: string,
  docName: string,
  depth: ReadingDepth,
  docDescription?: string,
  currentNodeId?: string,
  citedNodeIds?: string[],
  /** 用户实际引用的文本片段（来自 UI 引用卡片） */
  citedQuoteTexts?: Array<{ nodeId: string; blockId?: string; text: string }>,
): string {
  const summarySection = docDescription
    ? `\n<book_summary>\n${docDescription}\n</book_summary>\n`
    : '';

  // 当前章节硬约束：防止 LLM 因摘要不全而漏掉用户当前正在阅读的章节
  // 这是 issue: "回报函数工程"在 24 章存在但被 inspectional 漏选
  // 任何情况下 currentNodeId 都必须出现在 scopeNodeIds 中（除非有显式排除理由）
  const currentChapterBlock = currentNodeId
    ? `\n<current_chapter_lock>
用户当前正在阅读的章节是 node_id=${currentNodeId}。
⚠️ 硬性要求：此章节必须出现在 scopeNodeIds 中——除非你能在 excludedCurrentChapter 字段给出明确的排除理由（如"该章节摘要与用户问题在主题上完全无关"）。
"看起来和 X 章重复" 不构成排除理由——重复章节可能含有独特术语。
摘要里没有出现用户问题中的关键词不构成排除理由——摘要本身可能丢失术语。
</current_chapter_lock>`
    : '';

  // 用户显式引用章节：用户用 [[24 - xxx]] 或 > — 24 - xxx 形式直接点名的章节
  // 这是用户意图的强信号，权重高于 LLM 推断的 scope
  // 同时如果能拿到用户实际引用的文本片段，一并注入，让 LLM 以原文为依据判断相关性
  const citedTextsByNode = new Map<string, Array<{ blockId?: string; text: string }>>();
  if (citedQuoteTexts && citedQuoteTexts.length > 0) {
    for (const q of citedQuoteTexts) {
      const arr = citedTextsByNode.get(q.nodeId) ?? [];
      arr.push({ blockId: q.blockId, text: q.text });
      citedTextsByNode.set(q.nodeId, arr);
    }
  }
  const citedChaptersBlock = citedNodeIds && citedNodeIds.length > 0
    ? `\n<user_cited_chapters>
用户在消息中通过 wiki 链接或块引用显式引用了以下章节：
${citedNodeIds.map(id => {
  const texts = citedTextsByNode.get(id);
  if (!texts || texts.length === 0) return `- node_id: ${id}`;
  const textBlurbs = texts.map(t => {
    const trimmed = t.text.length > 400 ? `${t.text.slice(0, 400)}…` : t.text;
    const blockTag = t.blockId ? ` (block_id: ^${t.blockId})` : '';
    return `  - 用户引用文本${blockTag}：\n    > ${trimmed.replace(/\n/g, '\n    > ')}`;
  }).join('\n');
  return `- node_id: ${id}\n${textBlurbs}`;
}).join('\n')}
⚠️ 这些章节必须出现在 scopeNodeIds 中——它们是用户问题的直接来源，绕开它们等于忽略用户意图。
⚠️ **以用户引用的文本为最直接依据**判断这些章节是否与问题相关。章节摘要可能丢失关键术语，但用户引用的原文揭示了真实意图。不要仅凭摘要排除这些章节。
</user_cited_chapters>`
    : '';

  const taskBranch = depth === ReadingDepth.INSPECTIONAL
    ? `<task_branch name="宏观检视">
用户的意图是了解全书结构、核心主题或主要脉络。

你的任务：
1. 仔细阅读目录树和章节摘要
2. 直接生成一份详细的《全书结构检视报告》(structural_analysis)
3. 解答用户的宏观问题，基于目录信息组织回答
4. scopeNodeIds 可以留空 []，因为不需要锁定局部范围

**⚠️ 标题准确性是硬性要求**：
- 提到卷/章/节标题时，必须使用目录树中出现的原始标题文本，一个字都不能改
- 绝对不要用内容摘要或自拟标题替代正式卷名（例如不能把"非预测性的世界观"改为"非线性与凸性"）
- 如果目录树中卷级节点的 title 是"第一卷""第二卷"等，其摘要文本（summary）才是正式副标题，应一并引用

**⚠️ wiki 链接是硬性要求**：
- structural_analysis 中每提到一个章节，都必须用 wiki 链接格式嵌入：[[${docName}/文件名|2-6字别名]]
- 文件名直接从目录树的 link 字段复制（去掉外层 [[ ]] 即可）
- 别名是 2-6 个字的核心词，自然嵌入句中
- 示例：前言通过[[${docName}/01 - 前言 無所不在，卻難以看見的橋樑|條碼故事]]引出工程思维
- 不使用 wiki 链接的输出将被视为不合格

⚠️ 重要：如果用户问题中提及了具体的案例名、人名、技术术语或事件（如"马拉松"、"RFID"、"某个人物"），但目录摘要中找不到对应的直接匹配：
- 不要自行泛化或改写用户的问题！
- better_question 保持用户原始提问的核心意图
- 在 tocSummary 中明确指出"用户提及的具体内容在目录中未找到，建议升级到分析阅读以搜索全文"
- scopeNodeIds 可以根据章节摘要的相关性填入最可能的章节 node_id
</task_branch>`
    : `<task_branch name="圈定战区">
用户的意图是探究某个具体的细节、概念或推演逻辑。

1. 基于目录树和章节摘要，推断最有可能包含答案的核心章节，将他们的 nodeid 按相关性排序，将其 nodeid 填入 scopeNodeIds
2. 绝对不要尝试回答用户的具体问题！把答题的任务留给下一阶段
3. better_question 根据全书摘要重新推断出更能体现用户提问意图的下一阶段问题
4. structural_analysis 记录一句话简述为什么圈定这几个章节和提问意图改写
5. scopeNodeIds 不超过 5 个，宁缺毋滥：只选最相关的章节，宁可漏掉也不要圈太多
   ⚠️ 跨章节题注意：如果用户问的问题涉及多个概念在不同章节的分布（如"X和Y的联系""某个观点如何贯穿不同章节"），scopeNodeIds 应覆盖每个相关概念出现的章节，不要只聚焦最明显的一处
6. **suggested_keywords 至少提供 3-5 个搜索关键词**：包括书中特有的术语、核心概念名、可能的同义词。这些关键词将被直接用于下一阶段的自动检索，请务必选择目录树摘要中出现过的精确术语

⚠️ 强制要求（如有 <current_chapter_lock> 或 <user_cited_chapters>）：
- 当前阅读章节和用户显式引用的章节必须包含在 scopeNodeIds 中
- 如果你判断某章节应该被排除，必须在 excludedCurrentChapter 字段给出明确理由（"摘要与问题主题完全无关"等）
- "摘要里没出现关键词"不是充分理由——摘要可能丢失术语
- "和 X 章重复"不是充分理由——重复章节可能含独特概念
</task_branch>`;

  return `<role>
你是一位严谨的结构图书管理员。你精通艾德勒的检视阅读法，擅长通过提取和分析目录大纲（骨架），来把握全书的宏观脉络。
</role>

<document>
书名: ${docName}${summarySection}
目录树:
${treeText}
</document>

<depth_context>
当前用户的阅读深度诉求为：【深度 ${depth}】
</depth_context>
${currentChapterBlock}${citedChaptersBlock}
${taskBranch}

<constraints>
1. 只基于章节标题和摘要推断，不凭记忆回答问题。
3. scopeNodeIds 必须来自目录树中的 node_id。
4. 无相关章节时输出空数组 []。
5. 必须输出合法的 JSON 格式。
</constraints>

<output_format>
返回 JSON:
{
  "thought_process": "定位思考过程",
  "scopeNodeIds": ["0004", "0005"],
  "excludedCurrentChapter": "如果当前章节被排除，给出排除理由（'与问题主题完全无关'等），否则 null",
  "better_question":"改写的更符合书籍内容的提问",
  "suggested_keywords": ["关键词1", "关键词2", "关键词3"],
  "tocSummary": "为什么这些章节相关，建议搜索哪些关键词",
  "structural_analysis": "如果是深度 1，在这里写下基于大纲总结带 obsidian 链接的详细全书脉络/解答；如果是深度 2/3，只需写一句话简述圈定理由"
}
</output_format>`;
}

/**
 * Build user message for inspectional state
 */
export function buildInspectionalUserMessage(
  standaloneQuery: string,
  depth: ReadingDepth,
  recentHistorySummaries?: HistorySummary[],
): string {
  const depthHint = depth === ReadingDepth.INSPECTIONAL
    ? '请基于目录树生成详细的结构检视报告，解答用户的宏观问题。'
    : '请根据目录树圈定相关章节范围，在 tocSummary 中提供搜索关键词建议。';

  const historyBlock = recentHistorySummaries && recentHistorySummaries.length > 0
    ? formatHistoryBlock(recentHistorySummaries)
    : '<history>\n(无历史记录)\n</history>';

  return `${historyBlock}

<query>
${standaloneQuery}
</query>

${depthHint}`;
}

/**
 * Zod schema for S1 structured output
 */
export const InspectionalOutputSchema = z.object({
  thought_process: z.string(),
  scopeNodeIds: z.array(z.string()),
  better_question: z.string().optional(),
  tocSummary: z.string(),
  structural_analysis: z.string().optional(),
});

export type InspectionalOutput = z.infer<typeof InspectionalOutputSchema>;
