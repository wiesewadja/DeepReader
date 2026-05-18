/**
 * Text Matcher — 微信读书高亮文本的模糊匹配
 *
 * 核心策略：标准化后子串包含匹配 + 位置映射回原始内容。
 * 标准化步骤：去空白、去标点、全角→半角、转小写。
 */

import { stripMarkdownWithMap } from '../../utils/markdown-utils.js';

export interface MatchPosition {
	/** 匹配文本在原始内容中的起始位置 */
	index: number;
	/** 匹配到的文本片段（原始内容中的子串） */
	matched: string;
}

const PUNCT_RE = /[，。！？、；：""''（）《》【】「」『』…—·\-,.!?:;'"()\[\]{}<>\/\\@#$%^&*_+=|~`]/;

/**
 * 标准化文本用于模糊比较：
 * 去空白、去常见标点、全角→半角、转小写
 * 同时建立 normalized index → plain index 的映射
 */
function normalizeWithMap(text: string): { normalized: string; idxMap: number[] } {
	const normalized: string[] = [];
	const idxMap: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (/\s/.test(ch)) continue;
		if (PUNCT_RE.test(ch)) continue;
		if (ch === '　') continue;
		let mapped = ch;
		if (/[Ａ-Ｚａ-ｚ０-９]/.test(ch)) {
			mapped = String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
		}
		normalized.push(mapped.toLowerCase());
		idxMap.push(i);
	}
	return { normalized: normalized.join(''), idxMap };
}

/**
 * 在 Markdown 内容中模糊查找文本，返回所有匹配位置。
 * 支持空格/标点差异和全角半角差异。
 */
export function findFuzzyMatches(content: string, searchText: string): MatchPosition[] {
	if (!searchText) return [];

	// 1. 精确匹配快速路径（找所有出现）
	const exactResults = findAllExact(content, searchText);
	if (exactResults.length > 0) return exactResults;

	// 2. Markdown 剥离后匹配
	const { plain, map } = stripMarkdownWithMap(content);
	const strippedResults = findAllMapped(plain, map, content, searchText);
	if (strippedResults.length > 0) return strippedResults;

	// 3. 标准化后子串包含匹配（带 parallel 映射）
	const { normalized: normalizedContent, idxMap } = normalizeWithMap(plain);
	const { normalized: normalizedSearch } = normalizeWithMap(searchText);
	if (!normalizedSearch) return [];

	const results: MatchPosition[] = [];
	let searchFrom = 0;

	while (searchFrom < normalizedContent.length) {
		const idx = normalizedContent.indexOf(normalizedSearch, searchFrom);
		if (idx === -1) break;

		// normalizedIdx → plainIdx → contentIdx
		const plainStart = idxMap[idx];
		const plainEnd = idxMap[idx + normalizedSearch.length - 1];
		if (plainStart !== undefined && plainEnd !== undefined) {
			const origStart = map[plainStart];
			const origEnd = map[plainEnd];
			if (origStart !== undefined && origEnd !== undefined) {
				results.push({
					index: origStart,
					matched: content.substring(origStart, origEnd + 1),
				});
			}
		}
		searchFrom = idx + 1;
		if (results.length >= 5) break;
	}

	return results;
}

/** 在原文中找到所有精确出现（最多 5 个） */
function findAllExact(content: string, searchText: string): MatchPosition[] {
	const results: MatchPosition[] = [];
	let from = 0;
	while (from < content.length && results.length < 5) {
		const idx = content.indexOf(searchText, from);
		if (idx === -1) break;
		results.push({ index: idx, matched: searchText });
		from = idx + 1;
	}
	return results;
}

/** 在剥离 Markdown 标记后的纯文本中查找，映射回原始位置 */
function findAllMapped(
	plain: string,
	map: number[],
	content: string,
	searchText: string,
): MatchPosition[] {
	const results: MatchPosition[] = [];
	let from = 0;
	while (from < plain.length && results.length < 5) {
		const idx = plain.indexOf(searchText, from);
		if (idx === -1) break;
		const origStart = map[idx];
		const origEnd = map[idx + searchText.length - 1];
		if (origStart !== undefined && origEnd !== undefined) {
			results.push({ index: origStart, matched: content.substring(origStart, origEnd + 1) });
		}
		from = idx + 1;
	}
	return results;
}
