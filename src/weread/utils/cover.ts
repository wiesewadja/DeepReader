/** 从 cover URL 提取扩展名 */
export function extractCoverExt(cover: string): string {
	if (!cover) return 'jpg';
	const match = cover.match(/\.(\w+)(?:\?|$)/);
	return match ? match[1] : 'jpg';
}

/**
 * 将封面 URL 转为高清版本
 * 微信读书 CDN URL 格式：.../t6_YueWen_xxx.jpg
 * t6=~70px, t9=~428px（实测最大可用尺寸）
 */
export function toHighResCoverUrl(url: string): string {
	if (!url) return url;
	return url.replace(/\/[st]\d*_/, '/t9_');
}
