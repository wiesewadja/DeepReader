/**
 * Highlight Importer — 将微信读书高亮导入 DeepReader 章节文件
 *
 * 流程：
 * 1. 遍历 mapping.mappings 中已关联的书籍
 * 2. 从微信读书笔记文件解析 callout 提取 markText + colorStyle
 * 3. 从 book-meta.json 获取章节文件路径
 * 4. 按章节分组，每条高亮模糊匹配后批量写入 <mark> 标签
 */

import type { WereadMapping, WereadSyncState } from '../types';
import { findFuzzyMatches } from './text-matcher';
import { serviceLog as logger } from '../../utils/logger';

interface VaultAdapter {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	exists(path: string): Promise<boolean>;
}

export interface ImportResult {
	imported: number;
	skipped: number;
	errors: string[];
}

const WEREAD_COLOR_MAP: Record<number, string> = {
	0: 'rgba(255, 235, 59, 0.5)',  // 黄色
	1: 'rgba(233, 30, 99, 0.4)',   // 红色 → 粉色（DeepReader 无红色）
	2: 'rgba(255, 152, 0, 0.4)',   // 橙色
	3: 'rgba(76, 175, 80, 0.4)',   // 绿色
	4: 'rgba(33, 150, 243, 0.4)',  // 蓝色
	5: 'rgba(233, 30, 99, 0.4)',   // 粉色
};

const HIGHLIGHT_HEADER_RE = /^> \[!quote\]\+ (🟡|🔴|🟠|🟢|🔵|🩷) 高亮/;
const EMOJI_TO_COLOR: Record<string, number> = {
	'🟡': 0, '🔴': 1, '🟠': 2, '🟢': 3, '🔵': 4, '🩷': 5,
};

export interface ParsedHighlight {
	markText: string;
	colorStyle: number;
}

/**
 * 主入口：导入微信读书高亮到 DeepReader 章节文件
 */
export async function importHighlights(
	adapter: VaultAdapter,
	mapping: WereadMapping,
	syncState: WereadSyncState,
): Promise<ImportResult> {
	const result: ImportResult = { imported: 0, skipped: 0, errors: [] };

	for (const [wereadBookId, entry] of Object.entries(mapping.mappings)) {
		if (!entry.deepReaderBookId) continue;

		try {
			const count = await importForBook(adapter, wereadBookId, entry.deepReaderBookId, syncState);
			result.imported += count.imported;
			result.skipped += count.skipped;
		} catch (err) {
			const msg = `导入《${entry.wereadTitle}》高亮失败: ${err instanceof Error ? err.message : String(err)}`;
			logger.warn(msg);
			result.errors.push(msg);
		}
	}

	if (result.imported > 0) {
		logger.info(`高亮导入完成: ${result.imported} 条导入, ${result.skipped} 条跳过`);
	}

	return result;
}

async function importForBook(
	adapter: VaultAdapter,
	wereadBookId: string,
	deepReaderBookId: string,
	syncState: WereadSyncState,
): Promise<{ imported: number; skipped: number }> {
	// 1. 定位微信读书笔记文件
	const synced = syncState.syncedBooks[wereadBookId];
	if (!synced?.filePath) return { imported: 0, skipped: 0 };

	const noteExists = await adapter.exists(synced.filePath).catch(() => false);
	if (!noteExists) return { imported: 0, skipped: 0 };

	// 2. 解析高亮
	const noteContent = await adapter.read(synced.filePath);
	const highlights = parseWereadHighlights(noteContent);
	if (highlights.length === 0) return { imported: 0, skipped: 0 };

	// 3. 读取 book-meta.json 获取章节路径
	const metaPath = `.pageindex/${deepReaderBookId}/book-meta.json`;
	const metaExists = await adapter.exists(metaPath).catch(() => false);
	if (!metaExists) return { imported: 0, skipped: 0 };

	const metaRaw = await adapter.read(metaPath);
	const meta = JSON.parse(metaRaw);
	const chapterPaths: string[] = (meta.chapters || [])
		.map((ch: any) => ch.mdFilePath)
		.filter(Boolean);
	if (chapterPaths.length === 0) return { imported: 0, skipped: 0 };

	// 4. 按章节分组处理（每个章节文件只读写一次）
	let imported = 0;
	let skipped = 0;
	const matchedHighlights = new Set<number>();

	for (const chapterPath of chapterPaths) {
		const chapterExists = await adapter.exists(chapterPath).catch(() => false);
		if (!chapterExists) continue;

		let content = await adapter.read(chapterPath);
		let dirty = false;

		for (let hi = 0; hi < highlights.length; hi++) {
			if (matchedHighlights.has(hi)) continue;
			const hl = highlights[hi];
			if (!hl.markText.trim()) { skipped++; matchedHighlights.add(hi); continue; }

			if (isAlreadyMarked(content, hl.markText)) {
				skipped++;
				matchedHighlights.add(hi);
				continue;
			}

			const matches = findFuzzyMatches(content, hl.markText);
			if (matches.length === 0) continue;

			const match = matches[0];
			const bgColor = WEREAD_COLOR_MAP[hl.colorStyle] ?? WEREAD_COLOR_MAP[0];
			const markTag = `<mark style="background: ${bgColor}">${match.matched}</mark>`;

			content = content.substring(0, match.index) + markTag + content.substring(match.index + match.matched.length);
			dirty = true;
			imported++;
			matchedHighlights.add(hi);
		}

		if (dirty) {
			await adapter.write(chapterPath, content);
		}
	}

	// 未匹配的高亮计为跳过
	for (let hi = 0; hi < highlights.length; hi++) {
		if (!matchedHighlights.has(hi) && highlights[hi].markText.trim()) {
			skipped++;
		}
	}

	return { imported, skipped };
}

/**
 * 解析微信读书笔记文件中的高亮 callout
 */
export function parseWereadHighlights(markdown: string): ParsedHighlight[] {
	const results: ParsedHighlight[] = [];
	const lines = markdown.split('\n');

	let inHighlight = false;
	let textLines: string[] = [];
	let colorStyle = 0;

	for (const line of lines) {
		const headerMatch = HIGHLIGHT_HEADER_RE.exec(line);
		if (headerMatch) {
			if (inHighlight && textLines.length > 0) {
				results.push({ markText: textLines.join(' '), colorStyle });
			}
			inHighlight = true;
			textLines = [];
			colorStyle = EMOJI_TO_COLOR[headerMatch[1]] ?? 0;
			continue;
		}

		if (inHighlight) {
			if (line.startsWith('> ')) {
				const content = line.slice(2).trim();
				if (!content || content.startsWith('💬')) {
					if (textLines.length > 0) {
						results.push({ markText: textLines.join(' '), colorStyle });
					}
					inHighlight = false;
					textLines = [];
				} else {
					textLines.push(content);
				}
			} else {
				if (textLines.length > 0) {
					results.push({ markText: textLines.join(' '), colorStyle });
				}
				inHighlight = false;
				textLines = [];
			}
		}
	}

	if (inHighlight && textLines.length > 0) {
		results.push({ markText: textLines.join(' '), colorStyle });
	}

	return results;
}

/**
 * 检查文本是否已被 <mark> 标签包裹。
 * 遍历所有出现位置，只要有任何一个已标记即返回 true。
 */
export function isAlreadyMarked(content: string, text: string): boolean {
	let from = 0;
	while (from < content.length) {
		const idx = content.indexOf(text, from);
		if (idx === -1) break;
		const prefix = content.substring(Math.max(0, idx - 60), idx);
		if (prefix.includes('<mark')) return true;
		from = idx + 1;
	}
	return false;
}
