import type { HistorySummary } from '../../graph/utils/history-summarizer.js';
import { formatHistoryBlock } from '../../graph/utils/history-summarizer.js';
import { inspectionalPrompt } from '../core/inspectional.js';

export function buildInspectionalSystemPrompt(
  treeText: string,
  docName: string,
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
⚠️ 硬性要求：如果意图分类为 depth=2，此章节必须出现在 scopeNodeIds 中——除非你能在 reason 字段中给出明确的排除理由（如"该章节摘要与用户问题在主题上完全无关"）。
</current_chapter_lock>`
    : '';

  const citedChaptersBlock = citedNodeIds && citedNodeIds.length > 0
    ? `\n<user_cited_chapters>
用户在消息中通过 wiki 链接或块引用显式引用了以下章节：
${citedNodeIds.map(id => `- node_id: ${id}`).join('\n')}
⚠️ 如果意图分类为 depth=2，这些章节必须出现在 scopeNodeIds 中——它们是用户问题的直接来源。
</user_cited_chapters>`
    : '';

  const qualityWarning = (quality === 'degraded' || quality === 'poor')
    ? `\n⚠️ 目录解析质量标记为「${quality}」：${qualityReason || '清洗度不足/走兜底逻辑'}。
回答时请注意：部分章节标题可能不准确，避免基于标题做过度推断。\n`
    : '';

  return `${inspectionalPrompt.locales.zh.systemPrompt}

<document>
书名: ${docName}${summarySection}
目录树:
${treeText}${qualityWarning}</document>
${currentChapterBlock}${citedChaptersBlock}`;
}

export function buildInspectionalUserMessage(
  rawQuery: string,
  recentHistorySummaries?: HistorySummary[],
): string {
  const historyBlock = recentHistorySummaries && recentHistorySummaries.length > 0
    ? formatHistoryBlock(recentHistorySummaries)
    : '<history>\n(无历史记录)\n</history>';

  return `${historyBlock}

<query>
${rawQuery}
</query>

请基于目录树和最近历史，对上述 query 执行意图分类、提问重写、以及锁定章节范围或生成结构检视报告。`;
}
