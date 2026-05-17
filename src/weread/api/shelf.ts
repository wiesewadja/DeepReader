/**
 * 微信读书 — 书架合并逻辑
 *
 * notebook API 实际结构：books[].book 包含书籍详情
 * shelf API 可能 401，降级为只用 notebook
 */

import type { WereadBookItem, WereadBook } from '../types';

/** 从 notebook bookItem 提取 WereadBook */
function notebookItemToWereadBook(item: WereadBookItem): WereadBook {
	const b = item.book;
	return {
		bookId: item.bookId,
		title: b?.title ?? '',
		author: b?.author ?? '',
		cover: b?.cover ?? '',
		isbn: '',
		publisher: '',
		category: '',
		intro: '',
		totalWords: 0,
		rating: 0,
		publishTime: b?.publishTime ? String(b.publishTime) : '',
		bookType: b?.type ?? 0,
		noteCount: item.noteCount ?? 0,
		reviewCount: item.reviewCount ?? 0,
		lastReadDate: '',
		readingStatus: 'unread',
		progress: 0,
		readingTime: 0,
	};
}

/**
 * 合并 notebook 数据为 WereadBook[]
 * notebook 是唯一可靠数据源（shelf API 可能 401）
 */
export function mergeShelfBooks(
	notebookBooks: WereadBookItem[],
	_shelfBooks: unknown[],
): WereadBook[] {
	const result = new Map<string, WereadBook>();

	// 防御性检查：确保 notebookBooks 是可迭代数组
	const books = Array.isArray(notebookBooks) ? notebookBooks : [];
	for (const item of books) {
		if (!item?.bookId) continue;
		result.set(item.bookId, notebookItemToWereadBook(item));
	}

	return Array.from(result.values());
}
