/**
 * Scoring Utilities
 *
 * Pure scoring functions for search quality assessment.
 * Zero side effects, zero external dependencies.
 *
 * Extracted from analytical-pre-search.ts to enable independent testing
 * and reuse across nodes.
 */

import { CJK_STOPWORDS } from '../../../utils/cjk-stopwords.js';

/** Shape of a single hit block used by computeSubstantiveScore. */
export interface ScoredHit {
  block_id: string;
  content: string;
}

/**
 * Compute the theoretical maximum BM25 score for a set of keywords.
 *
 * Used by PreSearchEngine to calculate confidence = top1.score / maxTheory.
 * A high ratio means the top result is close to the theoretical best.
 *
 * @returns Theoretical max score, or 10.0 as fallback when index is missing/empty.
 */
export function computeMaxTheoryBM25(
  keywords: string[],
  bm25Index: { stats?: { totalDocs: number; df: Record<string, number> }; params?: { k1?: number }; invertedIndex?: unknown } | null,
): number {
  if (!bm25Index || !bm25Index.stats || !bm25Index.invertedIndex) {
    return 10.0;
  }
  const { totalDocs, df } = bm25Index.stats;
  const k1 = bm25Index.params?.k1 ?? 1.5;

  const uniqueKeywords = Array.from(new Set(keywords.map(k => k.trim()).filter(Boolean)));
  const queryTokens = uniqueKeywords.filter(t => !CJK_STOPWORDS.has(t));

  let maxTheoryScore = 0;
  for (const token of queryTokens) {
    const docFreq = df[token] || 0;
    if (docFreq === 0) continue;
    const effectiveDf = Math.min(docFreq, totalDocs);
    const idf = Math.max(0, Math.log((totalDocs - effectiveDf + 0.5) / (effectiveDf + 0.5)));
    const maxTokenScore = idf * (k1 + 1);
    maxTheoryScore += maxTokenScore;
  }
  return maxTheoryScore || 10.0;
}

/**
 * Compute keyword coverage: what fraction of non-stopword keywords appear in the text.
 *
 * Used by PreSearchEngine to detect "literal instant kill" early stop:
 * high confidence + high coverage = answer is literally in the top result.
 *
 * @returns 0.0–1.0 coverage ratio.
 */
export function computeKeywordCoverage(
  keywords: string[],
  textContent: string,
): number {
  const uniqueKeywords = Array.from(new Set(keywords.map(k => k.trim()).filter(Boolean)));
  const queryTokens = uniqueKeywords.filter(t => !CJK_STOPWORDS.has(t));
  if (queryTokens.length === 0) return 0;

  let matches = 0;
  const textLower = textContent.toLowerCase();
  for (const token of queryTokens) {
    if (textLower.includes(token.toLowerCase())) {
      matches++;
    }
  }
  return matches / queryTokens.length;
}

/**
 * Compute a substantive quality score for search hits.
 *
 * The score reflects whether the hit has real, citable content (block_id present,
 * sufficient length) rather than just a title/header match.
 *
 * Scoring:
 *   - block_id present: +20
 *   - content.length / 10 (capped at 30): up to +30
 *   - content.length > 20: +15
 *
 * @returns Max score across all hit blocks (0 = no substantive content found).
 */
export function computeSubstantiveScore(hits: ScoredHit[]): number {
  if (hits.every(h => !h.block_id)) {
    return 0;
  }
  let maxScore = 0;
  for (const h of hits) {
    let s = 0;
    if (h.block_id) s += 20;
    s += Math.min(h.content.length / 10, 30);
    if (h.content.length > 20) s += 15;
    maxScore = Math.max(maxScore, s);
  }
  return maxScore;
}
