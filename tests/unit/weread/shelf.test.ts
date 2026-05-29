import { describe, it, expect } from 'vitest';
import { mergeShelfBooks } from '@/weread/api/shelf';
import type { WereadBookItem } from '@/weread/types';

/** 创建符合新嵌套结构的 WereadBookItem */
function makeBookItem(overrides: Partial<WereadBookItem> & { bookId: string }): WereadBookItem {
	return {
		bookId: overrides.bookId,
		book: {
			bookId: overrides.bookId,
			title: (overrides as any).title ?? '',
			author: (overrides as any).author ?? '',
			cover: (overrides as any).cover ?? '',
			publishTime: (overrides as any).publishTime ?? 0,
			type: (overrides as any).bookType ?? 0,
			...(overrides as any).book ?? {},
		},
		reviewCount: overrides.reviewCount ?? 0,
		reviewLikeCount: 0,
		reviewCommentCount: 0,
		noteCount: overrides.noteCount ?? 0,
		bookmarkCount: 0,
		sort: 0,
	};
}

describe('mergeShelfBooks', () => {
	it('should extract book from notebook item', () => {
		const notebookBooks: WereadBookItem[] = [
			makeBookItem({
				bookId: '100',
				title: '深入理解计算机系统',
				author: 'Randal E. Bryant',
				cover: 'https://cover.example.com/csapp.jpg',
				noteCount: 12,
				reviewCount: 3,
			}),
		];

		const result = mergeShelfBooks(notebookBooks, []);

		expect(result).toHaveLength(1);
		expect(result[0].bookId).toBe('100');
		expect(result[0].title).toBe('深入理解计算机系统');
		expect(result[0].author).toBe('Randal E. Bryant');
		expect(result[0].noteCount).toBe(12);
	});

	it('should deduplicate by bookId', () => {
		const notebookBooks: WereadBookItem[] = [
			makeBookItem({ bookId: '200', title: 'Book A', noteCount: 5 }),
			makeBookItem({ bookId: '300', title: 'Book B' }),
		];

		const result = mergeShelfBooks(notebookBooks, []);

		expect(result).toHaveLength(2);
		const ids = result.map((b) => b.bookId);
		expect(ids).toContain('200');
		expect(ids).toContain('300');
	});

	it('should return empty for empty input', () => {
		expect(mergeShelfBooks([], [])).toEqual([]);
	});

	it('should handle notebook-only books', () => {
		const notebookBooks: WereadBookItem[] = [
			makeBookItem({ bookId: '400', title: 'Only in Notebook', noteCount: 8 }),
		];

		const result = mergeShelfBooks(notebookBooks, []);

		expect(result).toHaveLength(1);
		expect(result[0].bookId).toBe('400');
		expect(result[0].title).toBe('Only in Notebook');
	});

	it('should return valid book from notebook item', () => {
		const notebookBooks: WereadBookItem[] = [
			makeBookItem({ bookId: '500', title: 'Valid' }),
		];

		const result = mergeShelfBooks(notebookBooks, []);

		expect(result).toHaveLength(1);
		expect(result[0].bookId).toBe('500');
	});
});
