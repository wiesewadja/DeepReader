import type { PopularHighlightInfo } from './markdown-renderer';

/**
 * 将热门划线列表构建为按 chapterUid + range 索引的 Map。
 * 用于在渲染时快速判断某条用户划线是否同时是热门划线。
 */
export function buildPopularMap(
	popularHighlights?: PopularHighlightInfo[]
): Map<string, PopularHighlightInfo> {
	const map = new Map<string, PopularHighlightInfo>();
	if (!popularHighlights) return map;

	for (const ph of popularHighlights) {
		const key = `${ph.chapterUid}:${ph.range}`;
		map.set(key, ph);
	}
	return map;
}
