/**
 * Wiki Link Pair Validator
 *
 * 修复 LLM 流式输出中可能出现的「单边 `[[` 或 `]]` 残留」。
 * - 网络中断 / 流截断 → 末尾可能留下半个 `[[`
 * - LLM 幻觉 → 可能出现孤立 `]]`
 * - 残片被 Markdown 渲染器当成普通文本不会破坏布局，但
 *   `[[` 单边会让用户觉得"链接坏了"
 *
 * 算法：扫描所有 `[[` / `]]` 位置，按出现顺序配对
 * - 配对成功 → 保留
 * - 找不到配对的 `[[`（行末 / 文本末尾）→ 替换为 `[`
 * - 找不到配对的 `]]`（前面没有 `[[`）→ 替换为 `]`
 */

export interface LinkPairValidationResult {
  content: string;
  pairedCount: number;
  unpairedCount: number;
  fixedUnpaired: number;
}

const WIKI_OPEN = '[[';
const WIKI_CLOSE = ']]';

export function validateLinkPairs(content: string): LinkPairValidationResult {
  if (!content) {
    return { content: '', pairedCount: 0, unpairedCount: 0, fixedUnpaired: 0 };
  }

  let pairedCount = 0;
  let unpairedCount = 0;
  let fixedUnpaired = 0;

  const result: string[] = [];
  let i = 0;
  const n = content.length;

  while (i < n) {
    const ch = content[i];

    // 检测 `[[`
    if (ch === '[' && content[i + 1] === '[') {
      // 寻找下一个 `]]`
      const closeIdx = findCloseAfter(content, i + 2);
      if (closeIdx >= 0) {
        // 配对成功
        result.push(content.slice(i, closeIdx + 2));
        i = closeIdx + 2;
        pairedCount++;
        continue;
      }
      // 没找到配对 → 单边 `[[`，替换为 `[`
      result.push('[');
      unpairedCount++;
      fixedUnpaired++;
      i += 2;
      continue;
    }

    // 检测 `]]`（前面不是 `[[`）
    if (ch === ']' && content[i + 1] === ']') {
      // 单边 `]]`，替换为 `]`
      result.push(']');
      unpairedCount++;
      fixedUnpaired++;
      i += 2;
      continue;
    }

    result.push(ch);
    i++;
  }

  return {
    content: result.join(''),
    pairedCount,
    unpairedCount,
    fixedUnpaired,
  };
}

/**
 * 从 startIdx 开始查找 `]]`，返回其起始位置；找不到返回 -1。
 * 跳过 `[[` 内部（虽然 Obsidian 不真正支持嵌套，但单边嵌套应被识别为外层未闭合）。
 */
function findCloseAfter(content: string, startIdx: number): number {
  let i = startIdx;
  const n = content.length;
  while (i < n - 1) {
    if (content[i] === ']' && content[i + 1] === ']') {
      return i;
    }
    // 如果遇到下一个 `[[` 而没有 `]]`，说明外层未闭合 → 视为未配对
    if (content[i] === '[' && content[i + 1] === '[') {
      return -1;
    }
    i++;
  }
  return -1;
}
