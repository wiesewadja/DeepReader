/**
 * Diff 检测 — 对比远程书籍与本地同步状态，筛选出有变更的书籍
 */

import type { WereadBook, WereadSyncState } from '../types';

/**
 * 筛选需要同步的书籍
 * @param remoteBooks 远程书籍列表
 * @param syncState 本地同步状态
 * @param options.force 强制全量同步（忽略差异检测）
 * @returns 需要同步的书籍列表
 */
export function filterBooksToSync(
	remoteBooks: WereadBook[],
	syncState: WereadSyncState,
	options?: { force?: boolean },
): WereadBook[] {
	if (options?.force) {
		return [...remoteBooks];
	}

	const syncedBooks = syncState.syncedBooks ?? {};

	return remoteBooks.filter((book) => {
		const local = syncedBooks[book.bookId];
		if (!local) return true; // 新书
		return book.noteCount !== local.noteCount || book.reviewCount !== local.reviewCount;
	});
}

/** Diff 检测结果（完整版） */
export interface DiffResult {
	toSync: WereadBook[];
	unchanged: WereadBook[];
	newBooks: WereadBook[];
}

/**
 * 完整 Diff 检测，返回分类结果
 */
export function detectChangedBooks(
	remoteBooks: WereadBook[],
	syncState: WereadSyncState,
): DiffResult {
	const syncedBooks = syncState.syncedBooks ?? {};

	const toSync: WereadBook[] = [];
	const unchanged: WereadBook[] = [];
	const newBooks: WereadBook[] = [];

	for (const book of remoteBooks) {
		const local = syncedBooks[book.bookId];
		if (!local) {
			toSync.push(book);
			newBooks.push(book);
		} else if (book.noteCount !== local.noteCount || book.reviewCount !== local.reviewCount) {
			toSync.push(book);
		} else {
			unchanged.push(book);
		}
	}

	return { toSync, unchanged, newBooks };
}
