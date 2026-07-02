/**
 * Keyword Search Fusion
 *
 * Generic multi-keyword search with result merging and scoring.
 * Shared tool for S2-Pre and Syntopical nodes.
 *
 * For each keyword, runs a concurrent search via searchBookV2,
 * then merges results by nodeId (keeping highest score),
 * and sorts with hitCount + currentNodeId boosts.
 */

import type { BookSearchOptionsV2, BookSearchResultV2 } from '../../../pageindex/book-types.js';
import { agentLog as log } from '../../../utils/logger.js';

export interface KeywordSearchFusionOptions {
  /** Current chapter nodeId — gets a +0.2 relevance boost in sorting. */
  currentNodeId?: string;
}

/**
 * Search with multiple keywords in parallel, merge and re-rank results.
 *
 * @param keywords - Search terms to query (each triggers one searchBookV2 call)
 * @param searchOpts - Base search options passed to searchBookV2 (query is overridden per keyword)
 * @param options - Optional scoring boosts
 * @returns Merged and sorted BookSearchResultV2[]
 */
export async function keywordSearchFusion(
  keywords: string[],
  searchOpts: BookSearchOptionsV2,
  options: KeywordSearchFusionOptions = {},
): Promise<BookSearchResultV2[]> {
  if (keywords.length === 0) return [];

  const { currentNodeId } = options;

  // Lazy import — avoid top-level static import for mobile compatibility
  const { searchBookV2 } = await import('../../../pageindex/book-search-v2.js');

  const subResults = await Promise.all(
    keywords.map(async (kw) => {
      try {
        return await searchBookV2({ ...searchOpts, query: kw });
      } catch (err) {
        log(`[keyword-search-fusion] Search failed for "${kw}":`, err instanceof Error ? err.message : String(err));
        return [];
      }
    })
  );

  // Merge by nodeId — keep highest score, track hitCount
  const mergedMap = new Map<string, { result: BookSearchResultV2; hitCount: number }>();
  for (const results of subResults) {
    for (const r of results) {
      const existing = mergedMap.get(r.nodeId);
      if (existing) {
        existing.hitCount++;
        if (r.score > existing.result.score) existing.result = r;
      } else {
        mergedMap.set(r.nodeId, { result: r, hitCount: 1 });
      }
    }
  }

  // Sort: base score + hitCount boost + currentNodeId boost
  return Array.from(mergedMap.values())
    .sort((a, b) => {
      let scoreA = a.result.score + a.hitCount * 0.1;
      let scoreB = b.result.score + b.hitCount * 0.1;
      if (currentNodeId && a.result.nodeId === currentNodeId) scoreA += 0.2;
      if (currentNodeId && b.result.nodeId === currentNodeId) scoreB += 0.2;
      return scoreB - scoreA;
    })
    .map(e => e.result);
}
