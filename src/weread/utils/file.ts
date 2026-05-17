/**
 * 文件名清理：移除不合法字符
 */
export function sanitizeFileName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 200);
}
