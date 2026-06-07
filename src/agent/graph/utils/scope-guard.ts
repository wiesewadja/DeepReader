/**
 * Scope Hard-Guard — Force-include critical chapters
 *
 * Single source of truth for "must-include" chapter injection across
 * S1 Inspectional and S2-Pre nodes.
 *
 * Why this exists:
 *   The inspectional LLM derives scope from chapter SUMMARIES, which may
 *   not contain every key term (summaries are lossy). When a chapter's
 *   summary omits the user's keyword, the LLM drops it from scope and
 *   the user gets an answer based on a subset of the book.
 *
 *   This guard ensures:
 *   1. The chapter the user is currently reading (currentNodeId) is always in scope
 *   2. Any chapter the user EXPLICITLY cited via [[N - xxx]] or > — N -
 *      is always in scope (cited chapters override LLM inference)
 *
 *   Both S1 Inspectional and S2-Pre use this same implementation, so
 *   there's no risk of behavior drift between the two layers.
 */

export interface ScopeHardGuardResult {
  /** Final scope after injection */
  scope: string[];
  /** Chapters that were NOT in the LLM-derived scope but were added by the guard.
   *  Useful for logging and post-hoc debugging. */
  injected: Array<{
    id: string;
    reason: 'cited' | 'current';
    /** If LLM explicitly tried to exclude the current chapter, this is its reason */
    llmExclusionReason?: string;
  }>;
}

/**
 * Force-include the current chapter and any user-cited chapters into scope.
 *
 * Order of priority (highest first):
 *   1. user-cited chapters (explicit wiki links / block quotes)
 *   2. current chapter (user is reading here)
 *   3. LLM-derived scope (preserved as-is, in original order)
 *
 * @param llmScope - chapters the LLM put into scope
 * @param currentNodeId - the chapter the user is currently reading
 * @param citedNodeIds - chapters the user explicitly cited
 * @param llmExclusionReason - if LLM tried to exclude the current chapter,
 *                             this is its stated reason (for logging)
 */
export function enforceScopeHardGuard(
  llmScope: string[],
  currentNodeId: string | undefined,
  citedNodeIds: string[],
  llmExclusionReason: string = '',
): ScopeHardGuardResult {
  const seen = new Set<string>();
  const scope: string[] = [];
  const injected: ScopeHardGuardResult['injected'] = [];

  // Preserve LLM scope order while deduping
  for (const id of llmScope) {
    if (seen.has(id)) continue;
    seen.add(id);
    scope.push(id);
  }

  // 1. 用户显式引用（最高优先级）
  for (const id of citedNodeIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    scope.push(id);
    injected.push({ id, reason: 'cited' });
  }

  // 2. 当前阅读章节
  if (currentNodeId && !seen.has(currentNodeId)) {
    seen.add(currentNodeId);
    scope.push(currentNodeId);
    const entry: ScopeHardGuardResult['injected'][number] = {
      id: currentNodeId,
      reason: 'current',
    };
    if (llmExclusionReason && llmExclusionReason.length > 0) {
      entry.llmExclusionReason = llmExclusionReason;
    }
    injected.push(entry);
  }

  return { scope, injected };
}

/**
 * Build a minimum viable scope when LLM output is unusable:
 * just the current chapter + cited chapters.
 *
 * Used as a fallback when LLM fails to return valid JSON.
 */
export function buildFallbackScope(
  currentNodeId: string | undefined,
  citedNodeIds: string[],
): string[] {
  return enforceScopeHardGuard([], currentNodeId, citedNodeIds).scope;
}

/**
 * Format the injected list into a one-line log suffix.
 *
 * Example output: `cited:0021, current:0024(llm-said:"摘要与问题主题完全无关")`
 */
export function formatGuardInjectedLog(
  injected: ScopeHardGuardResult['injected'],
): string {
  return injected
    .map(i => `${i.reason}:${i.id}${i.llmExclusionReason ? `(llm-said:"${i.llmExclusionReason}")` : ''}`)
    .join(', ');
}
