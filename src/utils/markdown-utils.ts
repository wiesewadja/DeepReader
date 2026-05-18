/**
 * Markdown 文本匹配工具
 *
 * 从 main.ts 提取的通用函数，用于在 Markdown 内容中定位纯文本片段。
 * 核心策略：将 Markdown 剥离标记后变成纯文本，在纯文本上定位，再映射回原始位置。
 */

/**
 * 在 Markdown 内容中查找纯文本，返回原始 Markdown 中对应的片段和位置。
 */
export function findTextInMarkdown(
	content: string,
	plainText: string,
): { matched: string; index: number } | null {
	// 1. 先尝试精确匹配（最快路径）
	const exactIndex = content.indexOf(plainText);
	if (exactIndex !== -1) {
		return { matched: plainText, index: exactIndex };
	}

	// 2. 构建字符映射：纯文本位置 → 原始 Markdown 位置
	const { plain, map } = stripMarkdownWithMap(content);

	const plainIndex = plain.indexOf(plainText);
	if (plainIndex === -1) return null;

	// 找到纯文本中匹配的起止位置，映射回原始 Markdown 位置
	const origStart = map[plainIndex];
	const origEnd = map[plainIndex + plainText.length - 1];
	if (origStart === undefined || origEnd === undefined) return null;

	const matched = content.substring(origStart, origEnd + 1);
	return { matched, index: origStart };
}

/**
 * 剥离 inline Markdown 标记，同时建立纯文本位置到原始位置的映射。
 */
export function stripMarkdownWithMap(content: string): { plain: string; map: number[] } {
	const INLINE_MARKS = /(\*\*|__|~~|\*|_|`|\[\[|\]\]|\[|\])/g;

	const plain: string[] = [];
	const map: number[] = [];

	let i = 0;
	while (i < content.length) {
		INLINE_MARKS.lastIndex = i;
		const match = INLINE_MARKS.exec(content);

		if (match && match.index === i) {
			i += match[0].length;
		} else {
			plain.push(content[i]);
			map.push(i);
			i++;
		}
	}

	return { plain: plain.join(''), map };
}
