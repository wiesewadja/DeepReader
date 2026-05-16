/** 从 cover URL 提取扩展名 */
export function extractCoverExt(cover: string): string {
	if (!cover) return 'jpg';
	const match = cover.match(/\.(\w+)(?:\?|$)/);
	return match ? match[1] : 'jpg';
}
