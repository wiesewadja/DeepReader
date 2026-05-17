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
