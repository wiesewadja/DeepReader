/**
 * 微信读书笔记 — Markdown 渲染器
 *
 * 对齐 ExcerptService callout 格式：
 * - 高亮：> [!quote]+ 🟡 高亮
 * - 想法：> [!note]+ 💬 想法
 * - 热门划线：> [!quote]+ 🔥 热门划线
 * - 用户+热门：> [!quote]+ 📌🔥 高亮
 */
import type { WereadNotebook, WereadHighlight, WereadReview, WereadBestBookmarkItem } from '../types';
import { buildPopularMap } from './popular-map';
import { generateFrontmatter } from './frontmatter';

/** 微信读书颜色样式 → emoji 映射（对齐 ExcerptService） */
const COLOR_STYLE_EMOJI: Record<number, string> = {
	0: '🟡',   // 默认黄色
	1: '🔴',   // 红色
	2: '🟠',   // 橙色
	3: '🟢',   // 绿色
	4: '🔵',   // 蓝色
	5: '🩷',   // 粉色
};

function getColorEmoji(colorStyle?: number): string {
	return COLOR_STYLE_EMOJI[colorStyle ?? 0] ?? '🖍️';
}

/** 热门划线信息 */
export interface PopularHighlightInfo {
	bookmarkId: string;
	chapterUid: number;
	range: string;
	markText: string;
	totalCount: number;
}

/**
 * 将 WereadNotebook 渲染为完整 Markdown 字符串
 */
export function renderNotebook(
	notebook: WereadNotebook,
	popularHighlights?: PopularHighlightInfo[]
): string {
	const { meta, chapters, highlights, reviews } = notebook;

	// 构建热门划线索引（按 chapterUid + range 快速查找）
	const popularMap = buildPopularMap(popularHighlights);

	const sections: string[] = [];

	// 1. Frontmatter
	sections.push(generateFrontmatter(meta, meta.bookId));

	// 2. 标题 + 简介
	sections.push('');
	sections.push(`# ${meta.title}`);

	if (meta.intro) {
		sections.push('');
		sections.push('> [!summary] 书籍简介');
		sections.push(`> ${meta.intro}`);
	}

	// 3. 按章节分组渲染高亮和章节评论
	const chapterMap = new Map(chapters.map(c => [c.chapterUid, c.title]));
	const highlightsByChapter = groupByChapter(highlights);
	const chapterReviewsByChapter = groupReviewsByChapter(
		reviews.filter(r => r.type === 1),
	);

	// 收集有内容的章节 uid
	const chapterUids = new Set<number>();
	for (const uid of highlightsByChapter.keys()) chapterUids.add(uid);
	for (const uid of chapterReviewsByChapter.keys()) chapterUids.add(uid);

	// 按 chapterIdx 排序
	const sortedUids = [...chapterUids].sort((a, b) => {
		const chA = chapters.find(c => c.chapterUid === a);
		const chB = chapters.find(c => c.chapterUid === b);
		return (chA?.chapterIdx ?? 0) - (chB?.chapterIdx ?? 0);
	});

	for (const uid of sortedUids) {
		const chTitle = chapterMap.get(uid) ?? `章节 ${uid}`;
		sections.push('');
		sections.push(`## ${chTitle}`);

		// 高亮 — 支持热门划线标记
		const chHighlights = highlightsByChapter.get(uid) ?? [];
		if (chHighlights.length > 0) {
			for (const h of chHighlights) {
				const emoji = getColorEmoji(h.colorStyle);
				const popularKey = `${uid}:${h.range}`;
				const popular = popularMap.get(popularKey);

				sections.push('');
				if (popular) {
					// 用户划线 + 热门：📌🔥
					sections.push(`> [!quote]+ 📌🔥 ${emoji} 高亮`);
					sections.push(`> ${h.markText}`);
					sections.push(`> 🔥 ${popular.totalCount} 人共读`);
				} else {
					// 普通用户划线：📌
					sections.push(`> [!quote]+ 📌 ${emoji} 高亮`);
					sections.push(`> ${h.markText}`);
				}
				if (h.reviewContent) {
					sections.push(`> 💬 ${h.reviewContent}`);
				}
				sections.push(`> ⏱ ${h.createTime} ^${h.bookmarkId}`);
			}
		}

		// 章节评论（想法）— callout 格式
		const chReviews = chapterReviewsByChapter.get(uid) ?? [];
		if (chReviews.length > 0) {
			for (const r of chReviews) {
				sections.push('');
				sections.push(`> [!note]+ 💬 想法`);
				sections.push(`> ${r.mdContent || r.content}`);
				if (r.abstract) {
					sections.push(`> 📌 ${r.abstract}`);
				}
				sections.push(`> ⏱ ${r.createTime} ^${r.reviewId}`);
			}
		}
	}

	// 4. 全书评论
	const bookReviews = reviews.filter(r => r.type === 4);
	if (bookReviews.length > 0) {
		sections.push('');
		sections.push('## 全书评论');
		for (const r of bookReviews) {
			sections.push('');
			sections.push(`> [!note]+ 💬 书评`);
			sections.push(`> ${r.mdContent || r.content}`);
			sections.push(`> ⏱ ${r.createTime} ^${r.reviewId}`);
		}
	}

	// 5. 独立热门划线（用户未标注的）
	if (popularHighlights && popularHighlights.length > 0) {
		// 收集用户已标注的 range
		const userRanges = new Set(highlights.map(h => `${h.chapterUid}:${h.range}`));
		const standalonePopular = popularHighlights.filter(ph => !userRanges.has(`${ph.chapterUid}:${ph.range}`));

		if (standalonePopular.length > 0) {
			sections.push('');
			sections.push('## 热门划线');

			// 按章节分组
			const popularByChapter = new Map<number, PopularHighlightInfo[]>();
			for (const ph of standalonePopular) {
				const list = popularByChapter.get(ph.chapterUid) ?? [];
				list.push(ph);
				popularByChapter.set(ph.chapterUid, list);
			}

			for (const [chapterUid, items] of popularByChapter) {
				const chTitle = chapterMap.get(chapterUid) ?? `章节 ${chapterUid}`;
				sections.push('');
				sections.push(`### ${chTitle}`);

				for (const ph of items) {
					sections.push('');
					sections.push(`> [!quote]+ 🔥 热门划线`);
					sections.push(`> ${ph.markText}`);
					sections.push(`> 📊 ${ph.totalCount} 人共读 ^${ph.bookmarkId}`);
				}
			}
		}
	}

	return sections.join('\n');
}

/** 按章节分组高亮，并按 createTime 排序 */
function groupByChapter(
	highlights: WereadHighlight[],
): Map<number, WereadHighlight[]> {
	const map = new Map<number, WereadHighlight[]>();
	for (const h of highlights) {
		const list = map.get(h.chapterUid) ?? [];
		list.push(h);
		map.set(h.chapterUid, list);
	}
	for (const list of map.values()) {
		list.sort((a, b) => a.createTime - b.createTime);
	}
	return map;
}

/** 按章节分组评论 */
function groupReviewsByChapter(
	reviews: WereadReview[],
): Map<number, WereadReview[]> {
	const map = new Map<number, WereadReview[]>();
	for (const r of reviews) {
		const list = map.get(r.chapterUid) ?? [];
		list.push(r);
		map.set(r.chapterUid, list);
	}
	return map;
}
