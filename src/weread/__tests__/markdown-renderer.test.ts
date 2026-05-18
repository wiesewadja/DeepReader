/**
 * markdown-renderer + frontmatter 测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateFrontmatter } from '@/weread/render/frontmatter';
import { renderNotebook } from '@/weread/render/markdown-renderer';
import type { WereadBook, WereadNotebook, WereadHighlight, WereadReview, WereadChapter } from '@/weread/types';

// ── 固定时间戳 ──
const FIXED_NOW = new Date('2025-05-16T10:30:00Z');

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(FIXED_NOW);
});

// ═══════════════════════════════════════════════════════════════
// generateFrontmatter — 精简版（5 字段）
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
		readingTime: 66600,
	};

	it('should generate frontmatter with 5 core fields', () => {
		const result = generateFrontmatter(fullBook, '3300032341');

		expect(result).toContain('title: "深度学习"');
		expect(result).toContain('author: "Ian Goodfellow"');
		expect(result).toContain('type: weread');
		expect(result).toContain('source: "微信读书"');
		expect(result).toContain('cover: "DeepReader/covers/深度学习.jpg"');
	});

	it('should NOT contain old fields', () => {
		const result = generateFrontmatter(fullBook, '3300032341');

		expect(result).not.toContain('doc_type:');
		expect(result).not.toContain('wereadBookId:');
		expect(result).not.toContain('wereadStatus:');
		expect(result).not.toContain('isbn:');
		expect(result).not.toContain('totalWords:');
		expect(result).not.toContain('rating:');
		expect(result).not.toContain('progress:');
		expect(result).not.toContain('readingTime:');
		expect(result).not.toContain('readingStatus:');
		expect(result).not.toContain('syncTime:');
	});

	it('should handle book without cover', () => {
		const noCover = { ...fullBook, cover: '' };
		const result = generateFrontmatter(noCover, '3300032341');
		expect(result).toContain('cover: ""');
	});

	it('should sanitize title in cover path', () => {
		const weirdBook = { ...fullBook, title: 'A/B:C?D' };
		const result = generateFrontmatter(weirdBook, '3300032341');
		expect(result).toContain('cover: "DeepReader/covers/ABCD.jpg"');
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
		expect(md).toContain('type: weread');
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
		expect(md).toContain('> [!quote]+ 🟡 高亮');
			expect(md).toContain('> 第一条高亮');
		expect(md).toContain('> [!quote]+ 🟡 高亮');
			expect(md).toContain('> 第二条高亮');
		expect(md).toContain('> [!quote]+ 🟡 高亮');
			expect(md).toContain('> 第二章的高亮');
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

		expect(md).toContain('> [!quote]+ 🟡 高亮');
			expect(md).toContain('> 重要段落');
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

		expect(md).toContain('> [!note]+ 💬 想法');
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

			// Verify structure: fm → title → ch1(highlight+comment+review) → ch2 → 全书评论
			const fmEnd = md.indexOf('---', 1);
			const titleIdx = md.indexOf('# 测试书');
			const ch1Idx = md.indexOf('## 第一章 基础');
			const ch1Highlight = md.indexOf('划线内容A');
			const ch1Comment = md.indexOf('> 💬 批注A');
			const ch1Review = md.indexOf('想法内容');
			const ch2Idx = md.indexOf('## 第二章 进阶');
			const ch2Highlight = md.indexOf('划线内容B');
			const bookReviewIdx = md.indexOf('## 全书评论');

			expect(fmEnd).toBeLessThan(titleIdx);
			expect(titleIdx).toBeLessThan(ch1Idx);
			expect(ch1Idx).toBeLessThan(ch1Highlight);
			expect(ch1Highlight).toBeLessThan(ch1Comment);
			expect(ch1Comment).toBeLessThan(ch1Review);
			expect(ch1Review).toBeLessThan(ch2Idx);
			expect(ch2Idx).toBeLessThan(ch2Highlight);
			expect(ch2Highlight).toBeLessThan(bookReviewIdx);
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
