/**
 * Formatting Utilities
 *
 * Pure formatting helpers for S2-Pre node output.
 * Zero side effects, zero external dependencies.
 *
 * Extracted from analytical-pre-search.ts to enable independent testing
 * and reuse across nodes.
 */

import type { BookSearchResultV2 } from '../../../pageindex/book-types.js';

/**
 * Empty pre-search result factory.
 * Used as the default return when pre-search cannot proceed
 * (missing keywords, empty results, errors).
 */
export function emptyPreSearchResult(validatedScopeNodeIds: string[] = []) {
  return {
    validatedScopeNodeIds,
    preSearchBlock: '',
    earlyStopContent: '',
    toolResultsSnapshot: [],
    prevSearchedBlockIds: [],
    verifiedFullBookHits: [],
  };
}

/** Shape of a hit entry for formatBlockLines. */
interface HitEntry {
  title: string;
  file_name: string;
  matched_blocks: { block_id: string; content: string }[];
}

/**
 * Format search hits into Obsidian-style block reference lines.
 *
 * Output format: 【pdfName/fileName#^blockId】\ncontent
 * Aligned with Syntopical style for LLM to directly copy into [[wiki links]].
 */
export function formatBlockLines(hits: HitEntry[], pdfName: string): string[] {
  const prefix = pdfName ? `${pdfName}/` : '';
  return hits.flatMap(h =>
    h.matched_blocks.map(b =>
      `【${prefix}${h.file_name}#^${b.block_id}】\n${b.content}`
    )
  );
}

/**
 * Format L5 negative-claim verification hits into a prompt block.
 *
 * Instructs the LLM to re-analyze with the new evidence instead of
 * repeating the "未出现/未提及" claim.
 */
export function formatVerifiedFullBookBlock(hits: BookSearchResultV2[]): string {
  const lines = hits.slice(0, 3).flatMap(h =>
    h.matchedBlocks.slice(0, 2).map(b => {
      const content = b.content.length > 200 ? `${b.content.slice(0, 200)}...` : b.content;
      return `【${h.title}】(file_name: "${h.fileName}", block_id: ${b.blockId.replace(/^\^/, '')})\n${content}`;
    })
  );
  return `<verified_full_book_hits>
【L5 负向声明自动复核命中】上一轮你或前序 S2 说过"书中未出现相关概念"，但全量书库搜索（不受当前 scope 限制）已找到以下证据。请基于这些证据重新分析，禁止再次输出"未出现/未提及"：
${lines.join('\n\n')}
</verified_full_book_hits>`;
}
