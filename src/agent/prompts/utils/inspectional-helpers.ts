import type { HistorySummary } from '../../graph/utils/history-summarizer.js';
import { formatHistoryBlock } from '../../graph/utils/history-summarizer.js';
import { inspectionalPrompt } from '../core/inspectional.js';

export function buildInspectionalSystemPrompt(
  treeText: string,
  docName: string,
  depth: number,
  docDescription?: string,
  currentNodeId?: string,
  citedNodeIds?: string[],
  quality?: string,
  qualityReason?: string,
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

  const taskBranch = depth === 1
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

  const qualityWarning = (quality === 'degraded' || quality === 'poor')
    ? `\n⚠️ 目录解析质量标记为「${quality}」：${qualityReason || '清洗度不足/走兜底逻辑'}。
回答时请注意：部分章节标题可能不准确，避免基于标题做过度推断。\n`
    : '';

  return `${inspectionalPrompt.locales.zh.systemPrompt}

<document>
书名: ${docName}${summarySection}
目录树:
${treeText}${qualityWarning}</document>

<depth_context>
当前用户的阅读深度诉求为：【深度 ${depth}】
</depth_context>
${currentChapterBlock}${citedChaptersBlock}
${taskBranch}`;
}

export function buildInspectionalUserMessage(
  standaloneQuery: string,
  depth: number,
  recentHistorySummaries?: HistorySummary[],
): string {
  const depthHint = depth === 1
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
