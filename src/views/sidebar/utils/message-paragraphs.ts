/**
 * 从消息内容元素中提取叶子块级段落的文本。
 *
 * 用于 TTS 朗读：选出叶子块级元素（其子树内不含其他块级元素）。
 * querySelectorAll 按文档先序返回，用祖先栈一次遍历标记非叶子节点，O(n)。
 */
const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote";

export function getLeafParagraphs(
	contentEl: HTMLElement | null | undefined,
): string[] {
	if (!contentEl) return [];
	const allElements = Array.from(
		contentEl.querySelectorAll<HTMLElement>(BLOCK_SELECTOR),
	);

	const nonLeaf = new Set<Element>();
	const ancestorStack: Element[] = [];
	for (const el of allElements) {
		while (
			ancestorStack.length > 0 &&
			!ancestorStack[ancestorStack.length - 1].contains(el)
		) {
			ancestorStack.pop();
		}
		if (ancestorStack.length > 0) {
			nonLeaf.add(ancestorStack[ancestorStack.length - 1]);
		}
		ancestorStack.push(el);
	}

	return allElements
		.filter((el) => !nonLeaf.has(el))
		.map((el) => el.textContent || "");
}
