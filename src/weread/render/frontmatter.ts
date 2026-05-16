/**
 * 微信读书笔记 — YAML Frontmatter 生成
 */
import type { WereadBook } from '../types';
import { formatReadingTime } from '../utils/time';
import { extractCoverExt } from '../utils/cover';

/** YAML 字符串转义：处理引号、换行、冒号等特殊字符 */
function yamlString(value: string): string {
	if (!value) return '""';
	const escaped = value
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '');
	return `"${escaped}"`;
}

/** 阅读状态中文映射 */
const READING_STATUS_MAP: Record<WereadBook['readingStatus'], string> = {
	unread: '未读',
	reading: '在读',
	finished: '已读完',
};

/**
 * 生成 YAML frontmatter 字符串
 *
 * @param book 标准化书籍模型
 * @param wereadBookId 微信读书 bookId
 * @param options 可选参数（deepReaderBookId 用于关联状态）
 */
export function generateFrontmatter(
	book: WereadBook,
	wereadBookId: string,
	options?: { deepReaderBookId?: string },
): string {
	const linked = !!options?.deepReaderBookId;
	const rating = book.rating > 10 ? Math.round((book.rating / 10) * 10) / 10 : book.rating;
	const coverExt = extractCoverExt(book.cover);
	const readingStatus = READING_STATUS_MAP[book.readingStatus] ?? book.readingStatus;

	const lines: string[] = [
		'---',
		`doc_type: weread-notebook`,
		`wereadBookId: ${yamlString(wereadBookId)}`,
	];

	if (linked) {
		lines.push(`deepReaderBookId: ${yamlString(options!.deepReaderBookId!)}`);
	}

	lines.push(
		`wereadStatus: ${yamlString(linked ? 'linked' : 'unlinked')}`,
		`title: ${yamlString(book.title)}`,
		`author: ${yamlString(book.author)}`,
		`cover: ${yamlString('DeepReader/微信读书/assets/' + wereadBookId + '.' + coverExt)}`,
		`isbn: ${yamlString(book.isbn)}`,
		`publisher: ${yamlString(book.publisher)}`,
		`category: ${yamlString(book.category)}`,
		`totalWords: ${book.totalWords}`,
		`rating: ${rating}`,
		`progress: "${book.progress}%"`,
		`readingTime: ${yamlString(formatReadingTime(book.readingTime))}`,
		`readingStatus: ${yamlString(readingStatus)}`,
		`lastReadDate: ${yamlString(book.lastReadDate)}`,
		`finishedDate: ""`,
		`noteCount: ${book.noteCount}`,
		`reviewCount: ${book.reviewCount}`,
		`syncTime: ${yamlString(new Date().toISOString())}`,
		'---',
	);

	return lines.join('\n');
}

