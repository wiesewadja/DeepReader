import type { NoteMetadata, MergePlan } from "./compiler-types";

/** 规划合并操作 */
export function planMerge(
  content: string,
  metadata: NoteMetadata,
  removedLinks: string[]
): MergePlan {
  // 解析已有 frontmatter
  const fm = parseFrontmatter(content);
  const existingTags: string[] = (fm?.tags as string[]) || [];

  // 合并标签：只添加新的
  const newTags = metadata.tags.filter((t) => !existingTags.includes(t));

  // 过滤 wiki links：跳过 removed-links 中的目标
  const linksToAdd = metadata.wikiLinks
    .filter((wl) => !removedLinks.includes(wl.target))
    .map((wl) => ({ text: wl.text, replacement: `[[${wl.target}|${wl.text}]]` }));

  return {
    frontmatter: {
      add: { tags: newTags, related: metadata.relatedConcepts.map((c) => `[[${c}]]`) },
      overwrite: { "compiled-at": new Date().toISOString() },
    },
    linksToAdd,
    linksToSkip: removedLinks,
  };
}

/** CJK 功能词/标点，作为分词边界 */
const CJK_BOUNDARY_CHARS = new Set(
  "的是了在有也就都而及与或很最更已将会能可要应该得地着过吗呢吧啊呀哦嗯、，。；：？！（）》《\"'"
    .split("")
);

/** 判断字符是否构成 CJK 复合词（非边界） */
function isCjkCompoundChar(ch: string): boolean {
  if (!/[\u4e00-\u9fff]/.test(ch)) return false;
  return !CJK_BOUNDARY_CHARS.has(ch);
}

/** 插入 wiki 链接（全词匹配，首次出现，跳过已有链接内的文本） */
export function insertWikiLinks(
  content: string,
  links: Array<{ text: string; target: string }>
): string {
  let result = content;
  for (const link of links) {
    const escaped = link.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(result)) !== null) {
      const idx = match.index;
      const endIdx = idx + link.text.length;

      // 检查是否在已有 [[...]] 链接内部
      if (isInsideWikiLink(result, idx)) {
        continue;
      }

      const before = idx > 0 ? result[idx - 1] : "";
      const after = endIdx < result.length ? result[endIdx] : "";

      // 前边界：不能是 CJK 内容字或字母数字
      const isBoundaryBefore = !before || !(/[\w]/.test(before) || isCjkCompoundChar(before));
      // 后边界：不能是 CJK 内容字（功能词/标点/非CJK 都 OK）
      const isBoundaryAfter = !after || !isCjkCompoundChar(after);

      if (isBoundaryBefore && isBoundaryAfter) {
        const replacement = `[[${link.target}|${link.text}]]`;
        result = result.slice(0, idx) + replacement + result.slice(endIdx);
        break; // 只替换首次出现
      }
    }
  }
  return result;
}

/** 检查位置 idx 是否在 [[...]] 链接内部 */
function isInsideWikiLink(text: string, idx: number): boolean {
  // 从 idx 向前查找最近的 [[
  const before = text.slice(0, idx);
  const lastOpen = before.lastIndexOf("[[");
  if (lastOpen === -1) return false;
  // 从 [[ 之后查找 ]]
  const closeAfterOpen = text.indexOf("]]", lastOpen + 2);
  // 如果 ]] 在 idx 之后，说明 idx 在 [[...]] 内部
  return closeAfterOpen >= idx;
}

/** 检测用户删除的链接 */
export function detectRemovedLinks(
  fileKey: string,
  currentContent: string,
  snapshots: Record<string, string[]>
): string[] {
  const previousLinks = snapshots[fileKey] || [];
  if (previousLinks.length === 0) return [];

  // 提取当前内容中的所有 [[链接]]
  const currentLinks = new Set<string>();
  const linkRegex = /\[\[([^\]#|]+)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(currentContent)) !== null) {
    currentLinks.add(match[1].trim());
  }

  // 之前有但现在没有的 = 用户删除的
  return previousLinks.filter((link) => !currentLinks.has(link));
}

/** 解析 frontmatter（简易 YAML，只处理 tags 数组和标量字段）*/
// 注意：项目使用 Bun，无 gray-matter 依赖。当前只处理 frontmatter 中 compiler 需要的字段。
// 如果未来需要完整 YAML 解析，可引入 gray-matter 库。当前实现覆盖以下格式：
// - tags: [a, b]（内联数组）
// - tags:\n  - a\n  - b（换行数组）
// - key: value（标量）
function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const yaml = match[1];
  const result: Record<string, unknown> = {};

  // 简易 YAML 解析（只处理数组和标量）
  const lines = yaml.split("\n");
  let currentKey = "";
  let currentArray: string[] = [];

  for (const line of lines) {
    const arrMatch = line.match(/^(\w+):\s*\[(.*)\]/);
    if (arrMatch) {
      result[arrMatch[1]] = arrMatch[2].split(",").map((s) => s.trim().replace(/["']/g, ""));
      continue;
    }

    const kvMatch = line.match(/^(\w+):\s*(.*)/);
    if (kvMatch) {
      if (currentKey && currentArray.length > 0) {
        result[currentKey] = currentArray;
      }
      currentKey = kvMatch[1];
      currentArray = [];
      if (kvMatch[2]) result[currentKey] = kvMatch[2].replace(/["']/g, "");
    }

    const listItem = line.match(/^  -\s+"?(.*)"?/);
    if (listItem && currentKey) {
      currentArray.push(listItem[1].replace(/["']/g, ""));
    }
  }

  if (currentKey && currentArray.length > 0) {
    result[currentKey] = currentArray;
  }

  return result;
}
