/**
 * Weread 通用工具函数
 */

/**
 * 将秒数格式化为可读的中文字符串
 * @param seconds 秒数
 * @returns 如 "18小时30分钟"
 */
export function formatReadingTime(seconds: number): string {
	if (seconds <= 0) return '0分钟';

	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	if (hours > 0) {
		return `${hours}小时${minutes}分钟`;
	}
	return `${minutes}分钟`;
}

/**
 * 文件名清理：移除不合法字符
 */
export function sanitizeFileName(name: string): string {
	let sanitized = name
		.replace(/[\x00-\x1f\\/:*?"<>|]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const maxBytes = 240;
	while (new TextEncoder().encode(sanitized).byteLength > maxBytes) {
		sanitized = sanitized.slice(0, -1);
	}
	return sanitized || 'untitled';
}
