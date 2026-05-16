import { describe, it, expect } from 'vitest';
import { mergeShelfBooks } from '../api/shelf';
import type { WereadBookItem, WereadShelfBook } from '../types';

describe('mergeShelfBooks', () => {
	it('应合并两个来源中重叠的书籍，notebook 字段补充到 shelf 基础上', () => {
		const notebookBooks: WereadBookItem[] = [
			{
				bookId: '100',
				title: '深入理解计算机系统',
				author: 'Randal E. Bryant',
				cover: 'https://cover.example.com/csapp.jpg',
				noteCount: 12,
				reviewCount: 3,
				publisher: '机械工业出版社',
				totalWords: 480000,
				newRating: 95,
				finishedDate: '2025-01-01',
			},
		];

		const shelfBooks: WereadShelfBook[] = [
			{
				bookId: '100',
				title: '深入理解计算机系统',
				author: 'Randal E. Bryant',
				cover: 'https://cover.example.com/csapp.jpg',
				noteCount: 5,
				reviewCount: 0,
				bookType: 1,
			},
		];

		const result = mergeShelfBooks(notebookBooks, shelfBooks);

		expect(result).toHaveLength(1);
		expect(result[0].bookId).toBe('100');
		expect(result[0].noteCount).toBe(12);
		expect(result[0].reviewCount).toBe(3);
		expect(result[0].publisher).toBe('机械工业出版社');
		expect(result[0].totalWords).toBe(480000);
		expect(result[0].rating).toBe(95);
		expect(result[0].readingStatus).toBe('finished');
	});

	it('应按 bookId 去重，相同 ID 只保留一条', () => {
		const notebookBooks: WereadBookItem[] = [
			{ bookId: '200', title: 'Book A', noteCount: 5 },
		];

		const shelfBooks: WereadShelfBook[] = [
			{ bookId: '200', title: 'Book A', noteCount: 2 },
			{ bookId: '300', title: 'Book B' },
		];

		const result = mergeShelfBooks(notebookBooks, shelfBooks);

		expect(result).toHaveLength(2);
		const ids = result.map((b) => b.bookId);
		expect(ids).toContain('200');
		expect(ids).toContain('300');
		// notebook noteCount 覆盖了 shelf 的值
		expect(result.find((b) => b.bookId === '200')!.noteCount).toBe(5);
	});

	it('notebook 中独有的书籍应被保留', () => {
		const notebookBooks: WereadBookItem[] = [
			{ bookId: '400', title: 'Only in Notebook', noteCount: 8, reviewCount: 2 },
		];

		const shelfBooks: WereadShelfBook[] = [];

		const result = mergeShelfBooks(notebookBooks, shelfBooks);

		expect(result).toHaveLength(1);
		expect(result[0].bookId).toBe('400');
		expect(result[0].title).toBe('Only in Notebook');
		expect(result[0].noteCount).toBe(8);
	});

	it('两个来源都为空时返回空数组', () => {
		expect(mergeShelfBooks([], [])).toEqual([]);
	});

	it('shelf 有数据但 notebook 为空时正常返回', () => {
		const shelfBooks: WereadShelfBook[] = [
			{ bookId: '500', title: 'Shelf Only', author: 'Test' },
		];

		const result = mergeShelfBooks([], shelfBooks);

		expect(result).toHaveLength(1);
		expect(result[0].bookId).toBe('500');
		expect(result[0].author).toBe('Test');
		expect(result[0].noteCount).toBe(0);
	});

	it('应处理不同 bookId 字段名（bookid/docId/docid）', () => {
		const notebookBooks: WereadBookItem[] = [
			{ docid: 'mp_001', title: 'MP Article', noteCount: 3 } as WereadBookItem,
		];

		const shelfBooks: WereadShelfBook[] = [
			{ bookid: '400', title: 'Normal Book' } as WereadShelfBook,
		];

		const result = mergeShelfBooks(notebookBooks, shelfBooks);

		expect(result).toHaveLength(2);
		const ids = result.map((b) => b.bookId);
		expect(ids).toContain('mp_001');
		expect(ids).toContain('400');
	});
});
