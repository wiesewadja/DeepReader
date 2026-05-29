import { describe, it, expect } from 'vitest';
import { filterBooksToSync } from '@/weread/sync/diff';
import type { WereadBook, WereadSyncState } from '@/weread/types';

function makeBook(overrides: Partial<WereadBook> = {}): WereadBook {
	return {
		bookId: '100',
		title: 'Test Book',
		author: 'Author',
		cover: '',
		isbn: '',
		publisher: '',
		category: '',
		intro: '',
		totalWords: 0,
		rating: 0,
		publishTime: '',
		bookType: 0,
		noteCount: 0,
		reviewCount: 0,
		lastReadDate: '',
		readingStatus: 'reading',
		progress: 0,
		readingTime: 0,
		...overrides,
	};
}

describe('filterBooksToSync', () => {
	it('force 模式应返回所有远端书籍', () => {
		const remoteBooks: WereadBook[] = [
			makeBook({ bookId: '1', noteCount: 5, reviewCount: 1 }),
			makeBook({ bookId: '2', noteCount: 10, reviewCount: 3 }),
			makeBook({ bookId: '3', noteCount: 0, reviewCount: 0 }),
		];

		const syncState: WereadSyncState = {
			lastSyncTime: Date.now(),
			syncedBooks: {
				'1': { bookId: '1', title: 'A', author: '', noteCount: 5, reviewCount: 1, lastSyncTime: 0, filePath: '' },
				'2': { bookId: '2', title: 'B', author: '', noteCount: 10, reviewCount: 3, lastSyncTime: 0, filePath: '' },
				'3': { bookId: '3', title: 'C', author: '', noteCount: 0, reviewCount: 0, lastSyncTime: 0, filePath: '' },
			},
		};

		const result = filterBooksToSync(remoteBooks, syncState, { force: true });
		expect(result).toHaveLength(3);
	});

	it('新书籍（本地无同步记录）应被包含', () => {
		const remoteBooks: WereadBook[] = [
			makeBook({ bookId: 'new-book', noteCount: 3 }),
		];

		const syncState: WereadSyncState = {
			lastSyncTime: 0,
			syncedBooks: {},
		};

		const result = filterBooksToSync(remoteBooks, syncState);
		expect(result).toHaveLength(1);
		expect(result[0].bookId).toBe('new-book');
	});

	it('未变化的书籍应被排除', () => {
		const remoteBooks: WereadBook[] = [
			makeBook({ bookId: '1', noteCount: 5, reviewCount: 2 }),
		];

		const syncState: WereadSyncState = {
			lastSyncTime: Date.now(),
			syncedBooks: {
				'1': { bookId: '1', title: 'A', author: '', noteCount: 5, reviewCount: 2, lastSyncTime: 0, filePath: '' },
			},
		};

		const result = filterBooksToSync(remoteBooks, syncState);
		expect(result).toHaveLength(0);
	});

	it('noteCount 变化的书籍应被包含', () => {
		const remoteBooks: WereadBook[] = [
			makeBook({ bookId: '1', noteCount: 8, reviewCount: 2 }),
		];

		const syncState: WereadSyncState = {
			lastSyncTime: Date.now(),
			syncedBooks: {
				'1': { bookId: '1', title: 'A', author: '', noteCount: 5, reviewCount: 2, lastSyncTime: 0, filePath: '' },
			},
		};

		const result = filterBooksToSync(remoteBooks, syncState);
		expect(result).toHaveLength(1);
		expect(result[0].noteCount).toBe(8);
	});

	it('reviewCount 变化的书籍应被包含', () => {
		const remoteBooks: WereadBook[] = [
			makeBook({ bookId: '1', noteCount: 5, reviewCount: 10 }),
		];

		const syncState: WereadSyncState = {
			lastSyncTime: Date.now(),
			syncedBooks: {
				'1': { bookId: '1', title: 'A', author: '', noteCount: 5, reviewCount: 2, lastSyncTime: 0, filePath: '' },
			},
		};

		const result = filterBooksToSync(remoteBooks, syncState);
		expect(result).toHaveLength(1);
	});

	it('混合场景：部分变化、部分未变化、部分新增', () => {
		const remoteBooks: WereadBook[] = [
			makeBook({ bookId: '1', noteCount: 8, reviewCount: 2 }),   // noteCount 变化
			makeBook({ bookId: '2', noteCount: 5, reviewCount: 2 }),   // 未变化
			makeBook({ bookId: '3', noteCount: 1, reviewCount: 0 }),   // 新增
		];

		const syncState: WereadSyncState = {
			lastSyncTime: Date.now(),
			syncedBooks: {
				'1': { bookId: '1', title: 'A', author: '', noteCount: 5, reviewCount: 2, lastSyncTime: 0, filePath: '' },
				'2': { bookId: '2', title: 'B', author: '', noteCount: 5, reviewCount: 2, lastSyncTime: 0, filePath: '' },
			},
		};

		const result = filterBooksToSync(remoteBooks, syncState);
		expect(result).toHaveLength(2);
		const ids = result.map((b) => b.bookId);
		expect(ids).toContain('1');
		expect(ids).toContain('3');
		expect(ids).not.toContain('2');
	});

	it('空远端列表返回空数组', () => {
		const syncState: WereadSyncState = {
			lastSyncTime: 0,
			syncedBooks: {},
		};
		expect(filterBooksToSync([], syncState)).toEqual([]);
	});
});
