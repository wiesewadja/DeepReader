/**
 * Correction Signal Detector
 *
 * Detects whether a user message is pushing back on a previous answer
 * (e.g. "不，这里就有这个概念", "再搜索一下", "是有的").
 *
 * When detected, the engine MUST:
 * - Force ANALYTICAL depth (skip pre_search early-stop)
 * - Re-include the current chapter in scope (it was likely dropped)
 * - Bypass history-summarizer bias that anchors the previous wrong answer
 *
 * Why this is a separate module:
 * - Used in two places (router + post-state mutation) so a single source of truth
 * - Easy to test: a regex array with descriptive names
 * - Independent of LLM — runs before any model call to avoid circularity
 *
 * Implementation note on Chinese:
 *   Word boundaries (\b) do NOT work for CJK characters because
 *   \b only matches between word (\w) and non-word characters.
 *   "再搜索" starts and ends with Chinese chars, so \b再搜\bb fails.
 *   We use two pattern types:
 *     - regex: for English/ASCII patterns (must still use \b)
 *     - substring: for Chinese keywords (always word-boundary safe)
 */

export type CorrectionRule = {
  /** String-substring match (always safe for any language) */
  substring?: string;
  /** Regex match (use for ASCII / mixed patterns) */
  regex?: RegExp;
  /** Why this rule triggers — for log output */
  reason: string;
};

export const CORRECTION_RULES: CorrectionRule[] = [
  // ===== Direct negation =====
  { substring: '不对', reason: '否定词' },
  { substring: '错了', reason: '否定词' },
  { substring: '搞错', reason: '否定词' },
  { substring: '不是的', reason: '否定词' },
  { substring: '是错的', reason: '否定词' },
  { regex: /^\s*不[，。\s,]/, reason: '开头否定' },
  { regex: /^\s*不[，,。]/, reason: '开头否定' },

  // ===== Re-search intent =====
  { substring: '再搜索', reason: '重新检索' },
  { substring: '再搜一', reason: '重新检索' },
  { substring: '再搜下', reason: '重新检索' },
  { substring: '重新搜', reason: '重新检索' },
  { substring: '再找', reason: '重新检索' },
  { substring: '重新看', reason: '重新检索' },
  { substring: '重新查', reason: '重新检索' },
  { substring: '重新找', reason: '重新检索' },
  { substring: '还是再', reason: '重新检索' },

  // ===== Insistence on presence in source =====
  { substring: '这里就', reason: '坚持存在' },
  { substring: '明明', reason: '坚持存在' },
  { substring: '确定有', reason: '坚持存在' },
  { substring: '是有的', reason: '坚持存在' },
  { substring: '是存在的', reason: '坚持存在' },
  { substring: '有这', reason: '坚持存在' },
  { substring: '有这个', reason: '坚持存在' },
  { substring: '有这概念', reason: '坚持存在' },

  // ===== Citation refutation =====
  { substring: '引错', reason: '引用质疑' },
  { substring: '引用错', reason: '引用质疑' },
  { substring: '引不', reason: '引用质疑' },
  { substring: '章节错', reason: '章节质疑' },
  { substring: '章节引用错', reason: '章节质疑' },
  { substring: '不是这', reason: '章节质疑' },
];

/**
 * Detect whether the user's latest message is a correction.
 *
 * @param rawUserQuery - the latest HumanMessage content (verbatim, no rewrite)
 * @returns true if any rule matches
 */
export function detectCorrection(rawUserQuery: string | null | undefined): boolean {
  if (!rawUserQuery) return false;
  // Reject false positives: very short messages are usually affirmations
  const trimmed = rawUserQuery.trim();
  if (trimmed.length < 3) return false;

  for (const rule of CORRECTION_RULES) {
    if (rule.substring && rawUserQuery.includes(rule.substring)) return true;
    if (rule.regex && rule.regex.test(rawUserQuery)) return true;
  }
  return false;
}

/**
 * Return a human-readable reason string for logging.
 */
export function correctionReason(rawUserQuery: string | null | undefined): string {
  if (!rawUserQuery) return '空消息';
  for (const rule of CORRECTION_RULES) {
    if (rule.substring && rawUserQuery.includes(rule.substring)) return rule.reason;
    if (rule.regex && rule.regex.test(rawUserQuery)) return rule.reason;
  }
  return '未匹配';
}
