/**
 * Negative-Claim Auto-Verification (L5 — state-machine restart gate)
 *
 * Detects "未出现" / "未提及" claims in S2-Pre's `analysisResult` and
 * re-verifies them against the FULL book index (not just the current scope).
 * The verified hits are stored in state and used by the routing layer to
 * force a restart of the S2 Analytical node — so the LLM can do its own
 * ReAct reasoning with the new evidence, rather than S4 patching a wrong
 * answer and hoping the formatter LLM cooperates.
 *
 * Why this is a routing-level concern (not a S4 prompt patch):
 *   The 24章 / "回报函数工程" case showed that even when we have the
 *   correct evidence, the S4 formatter LLM can still confidently output
 *   "未出现". Patching the analysis string and hoping S4 rephrases is
 *   unreliable. The only robust fix is to route the flow back to S2
 *   Analytical, which has search_book tools and a ReAct loop capable of
 *   properly re-analyzing with the new evidence.
 *
 * Design notes:
 *   - Pure detection + search; no string mutation, no prompt rewriting.
 *   - Caller decides how to use the hits (route, augment prompt, etc.).
 *   - Threshold 0.3 matches the existing ANTI_HALLUCINATION_SCORE_THRESHOLD
 *     in `nodes/router.ts:49` for behavioral consistency.
 *   - Failures are caught and logged; returns [] on error so the caller
 *     can safely fall through to its default path.
 */

import type { BookSearchResultV2 } from '../../../pageindex/book-types.js';
import { agentLog as log } from '../../../utils/logger.js';

/** Minimum score to consider a full-book hit meaningful. Matches router.ts. */
const ANTI_HALLUCINATION_SCORE_THRESHOLD = 0.3;

/** Patterns that signal "this concept is not in the book" claims. */
const NEGATIVE_CLAIM_PATTERN = /未出现|未提及|没有提到|书里没有|并未提及/;

/** Default topK for the full-book verification search. */
const DEFAULT_FULL_BOOK_TOPK = 5;

export interface VerifyOptions {
  bookId: string;
  app: import('obsidian').App;
  topK?: number;
}

/**
 * Check if `analysisResult` contains a negative claim that warrants verification.
 *
 * Returns false if:
 *   - analysisResult is empty
 *   - rewrittenQuery is empty
 *   - no negative-claim pattern is found
 */
export function shouldVerifyNegativeClaim(
  analysisResult: string | undefined | null,
  rewrittenQuery: string | undefined | null,
): boolean {
  if (!analysisResult || !rewrittenQuery) return false;
  return NEGATIVE_CLAIM_PATTERN.test(analysisResult);
}

/**
 * Verify a negative-claim analysis against the full book index.
 *
 * Returns the meaningful hits (score > threshold) found via hybrid
 * search. The caller decides what to do with them — typically store
 * in state and let the routing layer force a ReAct restart.
 *
 * Returns [] if:
 *   - bookId/app missing
 *   - search throws (failure is logged, never propagated)
 *   - no hits above threshold
 */
export async function verifyNegativeClaimWithFullBook(
  rewrittenQuery: string,
  options: VerifyOptions,
): Promise<BookSearchResultV2[]> {
  const { bookId, app, topK = DEFAULT_FULL_BOOK_TOPK } = options;
  if (!bookId || !app) {
    log('[claim-verifier] 缺少 bookId/app, 跳过复核');
    return [];
  }

  let results: BookSearchResultV2[];
  try {
    const { searchBookV2 } = require('../../../pageindex/book-search-v2.js');
    results = await searchBookV2({
      query: rewrittenQuery,
      bookId,
      topK,
      filePath: '',
      app,
    });
  } catch (err) {
    log('[claim-verifier] 全文复核失败 (非致命):',
      err instanceof Error ? err.message : String(err));
    return [];
  }

  const meaningful = results.filter(
    (r) => (r.score ?? 0) > ANTI_HALLUCINATION_SCORE_THRESHOLD,
  );
  if (meaningful.length === 0) {
    log(`[claim-verifier] 全文复核未命中阈值 ${ANTI_HALLUCINATION_SCORE_THRESHOLD}`);
    return [];
  }

  log(`[claim-verifier] 全文复核命中 ${meaningful.length} 条 (full-book search)`);
  return meaningful;
}
