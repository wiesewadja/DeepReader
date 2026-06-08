import { safeRequest } from '../../utils/safe-request';
import { sanitizeFileName } from './file';

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

/**
 * 下载微信读书封面到 vault
 * @returns 保存的 vault 相对路径，失败返回 null
 */
export async function downloadWereadCover(
	coverUrl: string,
	title: string,
	adapter: { exists(p: string): Promise<boolean>; stat(p: string): Promise<{ size: number } | null>; writeBinary(p: string, data: ArrayBuffer): Promise<void>; mkdir(p: string): Promise<void> },
): Promise<string | null> {
	if (!coverUrl) return null;

	const ext = extractCoverExt(coverUrl);
	const coverPath = `DeepReader/covers/${sanitizeFileName(title)}.${ext}`;

	// 已有有效文件则跳过
	if (await adapter.exists(coverPath)) {
		try {
			const stat = await adapter.stat(coverPath);
			if (stat && stat.size > 5 * 1024) return coverPath;
		} catch { /* stat 失败则重新下载 */ }
	}

	// 先尝试高清，失败则用原始 URL
	const hiresUrl = toHighResCoverUrl(coverUrl);
	const urls = hiresUrl !== coverUrl ? [hiresUrl, coverUrl] : [coverUrl];

	for (const url of urls) {
		try {
			const resp = await safeRequest({ url });
			if (resp.arrayBuffer && resp.arrayBuffer.byteLength > 0) {
				const dir = coverPath.substring(0, coverPath.lastIndexOf('/'));
				if (dir && !(await adapter.exists(dir))) {
					await adapter.mkdir(dir);
				}
				await adapter.writeBinary(coverPath, resp.arrayBuffer);
				return coverPath;
			}
		} catch {
			continue;
		}
	}
	return null;
}
