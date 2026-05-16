/**
 * 微信读书 — 书架合并逻辑
 *
 * 将 /api/user/notebook 和 /shelf/sync 两个接口的书籍数据合并为
 * 统一的 WereadBook 内部模型。
 *
 * 合并策略：shelf 为主，notebook 补充 noteCount/reviewCount 等丰富字段。
 */

import { normalizeBookId } from '../utils/bookid';
import type { WereadBookItem, WereadShelfBook, WereadBook } from '../types';

/** 将 shelf 书籍转换为 WereadBook，缺失字段使用默认值 */
function shelfBookToWereadBook(book: WereadShelfBook): WereadBook {
	return {
		bookId: normalizeBookId(book),
		title: book.title ?? '',
		author: book.author ?? '',
		cover: book.cover ?? '',
		isbn: '',
		publisher: '',
		category: book.category ?? '',
		intro: '',
		totalWords: 0,
		rating: 0,
		publishTime: '',
		bookType: book.bookType ?? 0,
		noteCount: book.noteCount ?? 0,
		reviewCount: book.reviewCount ?? 0,
		lastReadDate: '',
		readingStatus: 'unread',
		progress: 0,
		readingTime: 0,
	};
}

/**
 * 合并 notebook 和 shelf 两个来源的书籍列表
 *
 * - shelf 书籍作为基础数据
 * - notebook 书籍补充 noteCount / reviewCount 等笔记统计信息
 * - 按 bookId 去重
 */
export function mergeShelfBooks(
	notebookBooks: WereadBookItem[],
	shelfBooks: WereadShelfBook[],
): WereadBook[] {
	// 构建 notebook 索引：bookId → WereadBookItem
	const notebookMap = new Map<string, WereadBookItem>();
	for (const nb of notebookBooks) {
		const id = normalizeBookId(nb);
		if (id) {
			notebookMap.set(id, nb);
		}
	}

	// 以 shelf 为基础合并
	const result = new Map<string, WereadBook>();

	for (const shelf of shelfBooks) {
		const id = normalizeBookId(shelf);
		if (!id) continue;

		const book = shelfBookToWereadBook(shelf);
		const nbItem = notebookMap.get(id);
		if (nbItem) {
			// notebook 补充丰富字段
			book.noteCount = nbItem.noteCount ?? shelf.noteCount ?? 0;
			book.reviewCount = nbItem.reviewCount ?? shelf.reviewCount ?? 0;
			book.lastReadDate = nbItem.lastReadDate ?? '';
			book.publisher = nbItem.publisher ?? '';
			book.intro = nbItem.intro ?? '';
			book.totalWords = nbItem.totalWords ?? 0;
			book.rating = nbItem.newRating ?? 0;
			book.publishTime = nbItem.publishTime ?? '';
			if (nbItem.title) book.title = nbItem.title;
			if (nbItem.author) book.author = nbItem.author;
			if (nbItem.cover) book.cover = nbItem.cover;
			if (nbItem.isbn) book.isbn = nbItem.isbn;
			if (nbItem.category) book.category = nbItem.category;

			// 阅读状态推断
			if (nbItem.finishedDate) {
				book.readingStatus = 'finished';
			} else if (nbItem.readUpdateTime || nbItem.lastReadDate) {
				book.readingStatus = 'reading';
			}
		}

		result.set(id, book);
	}

	// notebook 中存在但 shelf 中没有的书籍
	for (const nb of notebookBooks) {
		const id = normalizeBookId(nb);
		if (!id || result.has(id)) continue;

		result.set(id, {
			bookId: id,
			title: nb.title ?? '',
			author: nb.author ?? '',
			cover: nb.cover ?? '',
			isbn: nb.isbn ?? '',
			publisher: nb.publisher ?? '',
			category: nb.category ?? '',
			intro: nb.intro ?? '',
			totalWords: nb.totalWords ?? 0,
			rating: nb.newRating ?? 0,
			publishTime: nb.publishTime ?? '',
			bookType: nb.bookType ?? 0,
			noteCount: nb.noteCount ?? 0,
			reviewCount: nb.reviewCount ?? 0,
			lastReadDate: nb.lastReadDate ?? '',
			readingStatus: nb.finishedDate
				? 'finished'
				: nb.readUpdateTime || nb.lastReadDate
					? 'reading'
					: 'unread',
			progress: 0,
			readingTime: 0,
		});
	}

	return Array.from(result.values());
}
