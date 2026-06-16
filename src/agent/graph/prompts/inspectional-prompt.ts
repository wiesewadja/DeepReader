/**
 * S1 Inspectional Reading System Prompt - Backward Compatible Re-export
 *
 * This file re-exports from the new prompt registry for backward compatibility.
 * New code should import from '@/agent/prompts/core/inspectional.js' instead.
 */

import { inspectionalPrompt } from '../../prompts/core/inspectional.js';
import { z } from 'zod';
import type { OutlineNode } from '../../tools/local/types';
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
): string {
  const summarySection = docDescription
    ? `\n<book_summary>\n${docDescription}\n</book_summary>\n`
    : '';

  const currentChapterBlock = currentNodeId
    ? `\n<current_chapter_lock>
用户当前正在阅读的章节是 node_id=${currentNodeId}。
⚠️ 硬性要求：此章节必须出现在 scopeNodeIds 中——除非你能在 excludedCurrentChapter 字段给出明确的排除理由（如"该章节摘要与用户问题在主题上完全无关"）。
"看起来和 X 章重复" 不构成排除理由——重复章节可能含有独特术语。
摘要里没有出现用户问题中的关键词不构成排除理由——摘要本身可能丢失术语。
</current_chapter_lock>`
    : '';

  const citedChaptersBlock = citedNodeIds && citedNodeIds.length > 0
    ? `\n<user_cited_chapters>
用户在消息中通过 wiki 链接或块引用显式引用了以下章节：
${citedNodeIds.map(id => `- node_id: ${id}`).join('\n')}
⚠️ 这些章节必须出现在 scopeNodeIds 中——它们是用户问题的直接来源，绕开它们等于忽略用户意图。
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

**⚠️ wiki 链接是硬性要求**：
- structural_analysis 中每提到一个章节，都必须用 wiki 链接格式嵌入：[[${docName}/文件名|2-6字别名]]
</task_branch>`
    : `<task_branch name="圈定战区">
用户的意图是探究某个具体的细节、概念或推演逻辑。

1. 基于目录树和章节摘要，推断最有可能包含答案的核心章节
2. 绝对不要尝试回答用户的具体问题！把答题的任务留给下一阶段
3. better_question 根据全书摘要重新推断出更能体现用户提问意图的下一阶段问题
4. scopeNodeIds 不超过 5 个，宁缺毋滥
5. **suggested_keywords 至少提供 3-5 个搜索关键词**
</task_branch>`;

  return `${inspectionalPrompt.locales.zh.systemPrompt}

<document>
书名: ${docName}${summarySection}
目录树:
${treeText}
</document>

<depth_context>
当前用户的阅读深度诉求为：【深度 ${depth}】
</depth_context>
${currentChapterBlock}${citedChaptersBlock}
${taskBranch}`;
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

// Also export the new prompt module for new code
export { inspectionalPrompt };
