/**
 * markdown-renderer + frontmatter 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateFrontmatter } from '@/weread/render/frontmatter';
import { renderNotebook } from '@/weread/render/markdown-renderer';
import type { WereadBook, WereadNotebook, WereadHighlight, WereadReview, WereadChapter } from '@/weread/types';

// ── 固定时间戳，避免 syncTime 不确定 ──
const FIXED_NOW = new Date('2025-05-16T10:30:00Z');

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(FIXED_NOW);
});

// ═══════════════════════════════════════════════════════════════
// generateFrontmatter
// ═══════════════════════════════════════════════════════════════
describe('generateFrontmatter', () => {
	const fullBook: WereadBook = {
		bookId: '3300032341',
		title: '深度学习',
		author: 'Ian Goodfellow',
		cover: 'https://weread.com/cover/3300032341.jpg',
		isbn: '9787115461708',
		publisher: '人民邮电出版社',
		category: '计算机/人工智能',
		intro: '一本关于深度学习的书',
		totalWords: 580000,
		rating: 886,
		publishTime: '2017-01-01',
		bookType: 1,
		noteCount: 45,
		reviewCount: 12,
		lastReadDate: '2025-05-10',
		readingStatus: 'reading',
		progress: 72,
		readingTime: 66600, // 18小时30分钟
	};

	it('should generate frontmatter with all fields for a linked book', () => {
		const result = generateFrontmatter(fullBook, '3300032341', {
			deepReaderBookId: 'abc123',
		});

		expect(result).toContain('doc_type: weread-notebook');
		expect(result).toContain('wereadBookId: "3300032341"');
		expect(result).toContain('deepReaderBookId: "abc123"');
		expect(result).toContain('wereadStatus: "linked"');
		expect(result).toContain('title: "深度学习"');
		expect(result).toContain('author: "Ian Goodfellow"');
		expect(result).toContain('isbn: "9787115461708"');
		expect(result).toContain('publisher: "人民邮电出版社"');
		expect(result).toContain('category: "计算机/人工智能"');
		expect(result).toContain('totalWords: 580000');
		expect(result).toContain('rating: 88.6');
		expect(result).toContain('progress: "72%"');
		expect(result).toContain('readingTime: "18小时30分钟"');
		expect(result).toContain('readingStatus: "在读"');
		expect(result).toContain('lastReadDate: "2025-05-10"');
		expect(result).toContain('noteCount: 45');
		expect(result).toContain('reviewCount: 12');
		expect(result).toContain('syncTime: "2025-05-16T10:30:00.000Z"');
	});

	it('should generate frontmatter for an unlinked book (no deepReaderBookId)', () => {
		const result = generateFrontmatter(fullBook, '3300032341');

		expect(result).toContain('wereadStatus: "unlinked"');
		expect(result).not.toContain('deepReaderBookId');
	});

	it('should handle empty/zero fields gracefully', () => {
		const emptyBook: WereadBook = {
			bookId: '999',
			title: '空书',
			author: '',
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
			readingStatus: 'unread',
			progress: 0,
			readingTime: 0,
		};

		const result = generateFrontmatter(emptyBook, '999');

		expect(result).toContain('title: "空书"');
		expect(result).toContain('totalWords: 0');
		expect(result).toContain('rating: 0');
		expect(result).toContain('progress: "0%"');
		expect(result).toContain('readingTime: "0分钟"');
		expect(result).toContain('readingStatus: "未读"');
		expect(result).toContain('noteCount: 0');
		expect(result).toContain('reviewCount: 0');
	});

	it('should format cover path correctly', () => {
		const result = generateFrontmatter(fullBook, '3300032341', {
			deepReaderBookId: 'abc123',
		});

		expect(result).toContain('cover: "DeepReader/微信读书/assets/3300032341.jpg"');
	});

	it('should format readingStatus correctly for finished', () => {
		const finishedBook = { ...fullBook, readingStatus: 'finished' as const };
		const result = generateFrontmatter(finishedBook, '3300032341');
		expect(result).toContain('readingStatus: "已读完"');
	});

	it('should keep rating as-is when <= 10', () => {
		const lowRatedBook = { ...fullBook, rating: 8 };
		const result = generateFrontmatter(lowRatedBook, '3300032341');
		expect(result).toContain('rating: 8');
	});

	it('should include finishedDate when book is finished', () => {
		const finishedBook = { ...fullBook, readingStatus: 'finished' as const };
		const result = generateFrontmatter(finishedBook, '3300032341');
		// finishedDate should appear (even if empty)
		expect(result).toMatch(/finishedDate:/);
	});
});

// ═══════════════════════════════════════════════════════════════
// renderNotebook
// ═══════════════════════════════════════════════════════════════
describe('renderNotebook', () => {
	function makeBook(overrides: Partial<WereadBook> = {}): WereadBook {
		return {
			bookId: '1001',
			title: '测试书',
			author: '张三',
			cover: '',
			isbn: '',
			publisher: '',
			category: '',
			intro: '这是一本测试书。',
			totalWords: 100000,
			rating: 900,
			publishTime: '',
			bookType: 1,
			noteCount: 3,
			reviewCount: 2,
			lastReadDate: '2025-05-01',
			readingStatus: 'reading',
			progress: 50,
			readingTime: 3600,
			...overrides,
		};
	}

	function makeNotebook(overrides: Partial<WereadNotebook> = {}): WereadNotebook {
		return {
			meta: makeBook(),
			chapters: [
				{ chapterUid: 1, chapterIdx: 1, title: '第一章 基础', level: 1, isMPChapter: false },
				{ chapterUid: 2, chapterIdx: 2, title: '第二章 进阶', level: 1, isMPChapter: false },
			],
			highlights: [],
			reviews: [],
			...overrides,
		};
	}

	it('should render frontmatter + title + intro', () => {
		const notebook = makeNotebook();
		const md = renderNotebook(notebook);

		expect(md).toContain('---');
		expect(md).toContain('doc_type: weread-notebook');
		expect(md).toContain('# 测试书');
		expect(md).toContain('> [!summary] 书籍简介');
		expect(md).toContain('> 这是一本测试书。');
	});

	it('should group highlights by chapter and sort by createTime', () => {
		const highlights: WereadHighlight[] = [
			{
				bookmarkId: 'bm2',
				markText: '第二条高亮',
				chapterUid: 1,
				chapterTitle: '第一章 基础',
				style: 0,
				colorStyle: 0,
				range: '',
				createTime: 2000,
			},
			{
				bookmarkId: 'bm1',
				markText: '第一条高亮',
				chapterUid: 1,
				chapterTitle: '第一章 基础',
				style: 0,
				colorStyle: 0,
				range: '',
				createTime: 1000,
			},
			{
				bookmarkId: 'bm3',
				markText: '第二章的高亮',
				chapterUid: 2,
				chapterTitle: '第二章 进阶',
				style: 0,
				colorStyle: 0,
				range: '',
				createTime: 3000,
			},
		];

		const notebook = makeNotebook({ highlights });
		const md = renderNotebook(notebook);

		// Should contain chapter headers
		expect(md).toContain('## 第一章 基础');
		expect(md).toContain('## 第二章 进阶');

		// bm1 should appear before bm2 (sorted by createTime)
		const idx1 = md.indexOf('第一条高亮');
		const idx2 = md.indexOf('第二条高亮');
		expect(idx1).toBeLessThan(idx2);

		// Each highlight has block quote with bookmarkId anchor
		expect(md).toContain('> [!quote] 📌 第一条高亮 ^bm1');
		expect(md).toContain('> [!quote] 📌 第二条高亮 ^bm2');
		expect(md).toContain('> [!quote] 📌 第二章的高亮 ^bm3');
	});

	it('should show reviewContent below highlight with 💬', () => {
		const highlights: WereadHighlight[] = [
			{
				bookmarkId: 'bm1',
				markText: '重要段落',
				chapterUid: 1,
				chapterTitle: '第一章 基础',
				style: 0,
				colorStyle: 0,
				range: '',
				createTime: 1000,
				reviewContent: '这段写得好',
			},
		];

		const notebook = makeNotebook({ highlights });
		const md = renderNotebook(notebook);

		expect(md).toContain('> [!quote] 📌 重要段落 ^bm1');
		expect(md).toContain('> 💬 这段写得好');
	});

	it('should separate chapter reviews (type=1) into 想法 section', () => {
		const reviews: WereadReview[] = [
			{
				reviewId: 'r1',
				content: '这一章很有启发。',
				mdContent: '这一章很有启发。',
				chapterUid: 1,
				chapterTitle: '第一章 基础',
				createTime: 1500,
				type: 1,
				abstract: '原文摘要内容',
			},
		];

		const notebook = makeNotebook({ reviews });
		const md = renderNotebook(notebook);

		expect(md).toContain('### 想法');
		expect(md).toContain('这一章很有启发。');
		expect(md).toContain('> 📌 原文摘要内容');
	});

	it('should place book reviews (type=4) in 全书评论 section', () => {
		const reviews: WereadReview[] = [
			{
				reviewId: 'r2',
				content: '非常推荐这本书！',
				mdContent: '非常推荐这本书！',
				chapterUid: 0,
				chapterTitle: '',
				createTime: 2000,
				type: 4,
			},
		];

		const notebook = makeNotebook({ reviews });
		const md = renderNotebook(notebook);

		expect(md).toContain('## 全书评论');
		expect(md).toContain('非常推荐这本书！');
	});

	it('should render complete notebook with all sections', () => {
		const notebook = makeNotebook({
			highlights: [
				{
					bookmarkId: 'bm1',
					markText: '划线内容A',
					chapterUid: 1,
					chapterTitle: '第一章 基础',
					style: 0,
					colorStyle: 0,
					range: '',
					createTime: 1000,
					reviewContent: '批注A',
				},
				{
					bookmarkId: 'bm2',
					markText: '划线内容B',
					chapterUid: 2,
					chapterTitle: '第二章 进阶',
					style: 0,
					colorStyle: 0,
					range: '',
					createTime: 2000,
				},
			],
			reviews: [
				{
					reviewId: 'r1',
					content: '想法内容',
					mdContent: '想法内容',
					chapterUid: 1,
					chapterTitle: '第一章 基础',
					createTime: 1500,
					type: 1,
					abstract: '摘要文字',
				},
				{
					reviewId: 'r2',
					content: '全书评论内容',
					mdContent: '全书评论内容',
					chapterUid: 0,
					chapterTitle: '',
					createTime: 3000,
					type: 4,
				},
			],
		});

		const md = renderNotebook(notebook);

		// Verify structure order
		const fmEnd = md.indexOf('---', 1); // second ---
		const titleIdx = md.indexOf('# 测试书');
		const introIdx = md.indexOf('> [!summary]');
		const ch1Idx = md.indexOf('## 第一章 基础');
		const highlightIdx = md.indexOf('> [!quote] 📌 划线内容A');
		const commentIdx = md.indexOf('> 💬 批注A');
		const ch2Idx = md.indexOf('## 第二章 进阶');
		const ch2HighlightIdx = md.indexOf('> [!quote] 📌 划线内容B');
		const reviewIdx = md.indexOf('### 想法');
		const bookReviewIdx = md.indexOf('## 全书评论');

		expect(fmEnd).toBeLessThan(titleIdx);
		expect(titleIdx).toBeLessThan(introIdx);
		expect(introIdx).toBeLessThan(ch1Idx);
		expect(ch1Idx).toBeLessThan(highlightIdx);
		expect(highlightIdx).toBeLessThan(commentIdx);
		expect(commentIdx).toBeLessThan(reviewIdx);
		expect(reviewIdx).toBeLessThan(ch2Idx);
		expect(ch2Idx).toBeLessThan(ch2HighlightIdx);
		expect(ch2HighlightIdx).toBeLessThan(bookReviewIdx);
	});

	it('should skip intro if book has no intro', () => {
		const notebook = makeNotebook({
			meta: makeBook({ intro: '' }),
		});
		const md = renderNotebook(notebook);

		expect(md).not.toContain('> [!summary]');
	});

	it('should handle empty notebook (no highlights, no reviews)', () => {
		const notebook = makeNotebook();
		const md = renderNotebook(notebook);

		expect(md).toContain('# 测试书');
		expect(md).not.toContain('## 第一章');
		expect(md).not.toContain('## 全书评论');
	});
});
