/**
 * 微信读书笔记 — YAML Frontmatter 生成（精简版）
 *
 * 只保留 5 个核心字段，对齐 DeepReader 摘录风格
 */
import type { WereadBook } from '../types';
import { extractCoverExt } from '../utils/cover';
import { sanitizeFileName } from '../utils/file';

/** YAML 字符串转义 */
function yamlString(value: string): string {
	if (!value) return '""';
	const escaped = value
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n');
	return `"${escaped}"`;
}

/**
 * 生成精简 frontmatter：title, author, type, source, cover
 */
export function generateFrontmatter(
	book: WereadBook,
	_wereadBookId: string,
	_options?: { deepReaderBookId?: string },
): string {
	const coverExt = extractCoverExt(book.cover);
	const coverPath = book.cover
		? `DeepReader/covers/${sanitizeFileName(book.title)}.${coverExt}`
		: '';

	const lines: string[] = [
		'---',
		`title: ${yamlString(book.title)}`,
		`author: ${yamlString(book.author)}`,
		`type: weread`,
		`source: "微信读书"`,
		`cover: ${yamlString(coverPath)}`,
		'---',
	];

	return lines.join('\n');
}
