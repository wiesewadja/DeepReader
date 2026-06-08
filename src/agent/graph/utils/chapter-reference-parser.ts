/**
 * Chapter Reference Parser
 *
 * Extracts nodeIds that the user EXPLICITLY cited in their message.
 * Two forms are recognized:
 *
 *   1. Wiki-link form:    [[24 - 章节标题]]           or   [[AI极简经济学/24 - 章节标题]]
 *   2. Block-quote form:  > — 24 -                    or   > — 24 - 章节标题
 *
 * Why this matters:
 *   An explicit citation is a strong user signal that the referenced
 *   chapter is the source of truth for the question. We MUST include
 *   these chapters in scope regardless of what the LLM-derived scope
 *   says — the user's intent overrides LLM inference.
 *
 *   This is the safety net for the bug where 24章 (containing "回报函数工程")
 *   was excluded from scope by an LLM that anchored on its summary alone.
 */

const WIKI_LINK_PATTERN = /\[\[(?:[^\]]*?\/)?(\d+)\s*[-–—]\s*[^\]]*?\]\]/g;
// 块引用: "> — 24" 或 "> — 24 - 标题" 或 "> — 24 -" 都识别
const BLOCK_QUOTE_PATTERN = />\s*[—–-]\s*(\d+)(?:\s*[-–—][^\n]*)?/g;
// 箭头: "— 24 -" 出现时也识别（弱匹配，可能误报，但和块引用协同后置信度高）
const ARROW_BARE_PATTERN = /[—–-]\s*(\d+)\s*[-–—]/g;

/**
 * Pad a number to 4 digits with leading zeros, matching tree.json node_id format.
 * If the input already has leading zeros, returns as-is.
 */
function toNodeId(num: string): string {
  // If it already has 4-digit form, keep it.
  if (num.length >= 4) return num;
  return num.padStart(4, '0');
}

/**
 * Extract all chapter nodeIds the user explicitly cited.
 *
 * @param messages - all HumanMessage contents concatenated (so historical
 *                   context can also surface cited chapters)
 * @param quotedNodeIds - 可选：来自引用卡片的 nodeId（从 ToolContext.quotes[].nodeId 传入）
 *                        这些是用户在 UI 上主动引用的章节，权重等同 wiki 链接
 * @returns deduped, ordered list of canonical 4-digit nodeIds
 */
export function extractCitedNodeIds(
  messages: string | string[],
  quotedNodeIds?: string[]
): string[] {
  const text = Array.isArray(messages) ? messages.join('\n') : messages;

  const collected = new Set<string>();

  // 来源 1：消息文本中的 wiki 链接 / 块引用
  if (text) {
    for (const re of [WIKI_LINK_PATTERN, BLOCK_QUOTE_PATTERN, ARROW_BARE_PATTERN]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const num = m[1];
        // Reject clearly-out-of-range numbers (likely page numbers, not chapter IDs)
        if (!num) continue;
        const n = parseInt(num, 10);
        if (isNaN(n) || n < 1 || n > 9999) continue;
        collected.add(toNodeId(num));
      }
    }
  }

  // 来源 2：UI 引用卡片中的 nodeId
  if (quotedNodeIds?.length) {
    for (const id of quotedNodeIds) {
      if (id && /^\d{1,4}$/.test(id)) {
        collected.add(toNodeId(id));
      }
    }
  }

  return Array.from(collected);
}
