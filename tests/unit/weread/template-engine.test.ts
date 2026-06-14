import { describe, it, expect } from 'vitest';
import { notebookToContext, renderWithTemplate, validateTemplate } from '../../../src/weread/render/template-engine';
import type { WereadNotebook } from '../../../src/weread/types';

function makeNotebook(): WereadNotebook {
	return {
		meta: {
			bookId: '123',
			title: '测试书',
			author: '作者',
			cover: 'cover.jpg',
			intro: '简介',
			isbn: 'isbn',
			publisher: '出版社',
			category: '分类',
			publishTime: '2024',
			lastReadDate: '2024-01-01',
			noteCount: 1,
			reviewCount: 1,
		},
		chapters: [
			{ chapterUid: 1, chapterIdx: 1, title: '第一章', level: 1 },
		],
		highlights: [
			{
				bookmarkId: 'bm1',
				markText: '高亮文本',
				chapterUid: 1,
				chapterTitle: '第一章',
				style: 0,
				colorStyle: 0,
				range: '1-10',
				createTime: 1704067200,
				reviewContent: '想法',
			},
		],
		reviews: [
			{
				reviewId: 'r1',
				content: '书评',
				mdContent: '书评',
				chapterUid: 0,
				chapterTitle: '',
				createTime: 1704067200,
				type: 4,
			},
		],
	};
}

describe('template-engine', () => {
	it('notebookToContext builds context from notebook', () => {
		const notebook = makeNotebook();
		const ctx = notebookToContext(notebook);

		expect(ctx.metaData.title).toBe('测试书');
		expect(ctx.chapterHighlights).toHaveLength(1);
		expect(ctx.chapterHighlights[0].highlights).toHaveLength(1);
		expect(ctx.chapterHighlights[0].highlights?.[0].reviewContent).toBe('想法');
		expect(ctx.bookReview.bookReviews).toHaveLength(1);
	});

	it('notebookToContext marks popular highlights', () => {
		const notebook = makeNotebook();
		const popular = [
			{ bookmarkId: 'bm1', chapterUid: 1, range: '1-10', markText: '高亮文本', totalCount: 99 },
		];
		const ctx = notebookToContext(notebook, popular);

		const highlight = ctx.chapterHighlights[0].highlights?.[0];
		expect(highlight?.isPopular).toBe(true);
		expect(highlight?.popularCount).toBe(99);
	});

	it('renderWithTemplate renders simple template', () => {
		const notebook = makeNotebook();
		const ctx = notebookToContext(notebook);
		const result = renderWithTemplate('{{ metaData.title }}', ctx);
		expect(result).toBe('测试书');
	});

	it('renderWithTemplate supports formatDate filter', () => {
		const notebook = makeNotebook();
		const ctx = notebookToContext(notebook);
		const result = renderWithTemplate('{{ metaData.lastReadDate }}', ctx);
		expect(result).toBe('2024-01-01');
	});

	it('validateTemplate returns true for valid template', () => {
		expect(validateTemplate('{{ title }}')).toBe(true);
	});

	it('validateTemplate returns false for invalid template', () => {
		expect(validateTemplate('{% if %}')).toBe(false);
	});
});
