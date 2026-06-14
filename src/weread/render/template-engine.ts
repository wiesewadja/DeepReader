/**
 * 微信读书笔记模板引擎
 * 参考 weread 插件的 renderer.ts 实现
 */

import * as nunjucks from 'nunjucks';
import type { WereadNotebook, WereadHighlight, WereadReview } from '../types';
import type { PopularHighlightInfo } from './markdown-renderer';
import { buildPopularMap } from './popular-map';
import { generateFrontmatter } from './frontmatter';

/** 模板上下文 */
export interface TemplateContext {
	metaData: {
		bookId: string;
		title: string;
		author: string;
		cover: string;
		intro?: string;
		isbn?: string;
		publisher?: string;
		category?: string;
		publishTime?: string;
		pcUrl?: string;
		lastReadDate?: string;
		noteCount: number;
		reviewCount: number;
	};
	chapterHighlights: ChapterHighlightReview[];
	bookReview: {
		chapterReviews: ChapterReview[];
		bookReviews: Review[];
	};
	syncPopularHighlightsToggle?: boolean;
}

interface ChapterHighlightReview {
	chapterUid: number;
	chapterIdx: number;
	chapterTitle: string;
	level: number;
	highlights?: HighlightReview[];
	chapterReviews?: Review[];
}

interface HighlightReview {
	bookmarkId: string;
	markText: string;
	chapterUid: number;
	chapterTitle: string;
	colorStyle: number;
	range: string;
	createTime: string;
	reviewContent?: string;
	isPopular?: boolean;
	popularCount?: number;
	isUserHighlight?: boolean;
}

interface ChapterReview {
	reviewId: string;
	chapterTitle?: string;
	createTime: string;
	content: string;
}

interface Review {
	reviewId: string;
	createTime: string;
	content: string;
	mdContent?: string;
}

/** 添加日期过滤器 */
const addDateFilters = (env: nunjucks.Environment) => {
	env.addFilter('formatDate', function (timestamp: number, format?: string): string {
		if (!timestamp) return '';
		return window.moment(timestamp * 1000).format(format ?? 'YYYY-MM-DD');
	});

	env.addFilter('formatDateTime', function (timestamp: number, format?: string): string {
		if (!timestamp) return '';
		return window.moment(timestamp * 1000).format(format ?? 'YYYY-MM-DD HH:mm:ss');
	});

	env.addFilter('split', function (str: string, separator: string): string[] {
		if (!str) return [];
		return str.split(separator);
	});

	env.addFilter('replace', function (str: string, pattern: string, replacement: string): string {
		if (!str) return '';
		return str.replaceAll(pattern, replacement);
	});

	env.addFilter('trim', function (str: string): string {
		if (!str) return '';
		return str.trim();
	});
};

/**
 * 将 WereadNotebook 转换为模板上下文
 */
export function notebookToContext(
	notebook: WereadNotebook,
	popularHighlights?: PopularHighlightInfo[]
): TemplateContext {
	const { meta, chapters, highlights, reviews } = notebook;

	// 构建热门划线索引
	const popularMap = buildPopularMap(popularHighlights);

	// 按章节分组高亮
	const highlightsByChapter = new Map<number, HighlightReview[]>();
	for (const h of highlights) {
		const list = highlightsByChapter.get(h.chapterUid) ?? [];
		const popularKey = `${h.chapterUid}:${h.range}`;
		const popular = popularMap.get(popularKey);

		list.push({
			bookmarkId: h.bookmarkId,
			markText: h.markText,
			chapterUid: h.chapterUid,
			chapterTitle: h.chapterTitle,
			colorStyle: h.colorStyle,
			range: h.range,
			createTime: String(h.createTime),
			reviewContent: h.reviewContent,
			isPopular: !!popular,
			popularCount: popular?.totalCount,
			isUserHighlight: true,
		});
		highlightsByChapter.set(h.chapterUid, list);
	}

	// 按章节分组评论
	const chapterReviewsByChapter = new Map<number, Review[]>();
	for (const r of reviews.filter(r => r.type === 1)) {
		const list = chapterReviewsByChapter.get(r.chapterUid) ?? [];
		list.push({
			reviewId: r.reviewId,
			createTime: String(r.createTime),
			content: r.content,
			mdContent: r.mdContent,
		});
		chapterReviewsByChapter.set(r.chapterUid, list);
	}

	// 构建章节高亮+评论列表
	const chapterHighlights: ChapterHighlightReview[] = chapters.map(ch => ({
		chapterUid: ch.chapterUid,
		chapterIdx: ch.chapterIdx,
		chapterTitle: ch.title,
		level: ch.level,
		highlights: highlightsByChapter.get(ch.chapterUid) ?? [],
		chapterReviews: chapterReviewsByChapter.get(ch.chapterUid),
	}));

	// 全书评论
	const bookReviews: Review[] = reviews
		.filter(r => r.type === 4)
		.map(r => ({
			reviewId: r.reviewId,
			createTime: String(r.createTime),
			content: r.content,
			mdContent: r.mdContent,
		}));

	return {
		metaData: {
			bookId: meta.bookId,
			title: meta.title,
			author: meta.author,
			cover: meta.cover,
			intro: meta.intro,
			isbn: meta.isbn,
			publisher: meta.publisher,
			category: meta.category,
			publishTime: meta.publishTime,
			lastReadDate: meta.lastReadDate,
			noteCount: meta.noteCount,
			reviewCount: meta.reviewCount,
		},
		chapterHighlights,
		bookReview: {
			chapterReviews: [],
			bookReviews,
		},
	};
}

/**
 * 使用模板渲染笔记
 */
export function renderWithTemplate(
	templateStr: string,
	context: TemplateContext,
	trimBlocks = false
): string {
	const env = new nunjucks.Environment(null, {
		autoescape: false,
		trimBlocks,
		lstripBlocks: trimBlocks,
	});
	addDateFilters(env);

	try {
		return env.renderString(templateStr, context);
	} catch (error) {
		console.error('[TemplateEngine] 模板渲染失败:', error);
		throw error;
	}
}

/**
 * 验证模板是否有效
 */
export function validateTemplate(template: string): boolean {
	try {
		nunjucks.renderString(template, {});
		return true;
	} catch {
		return false;
	}
}
