/**
 * 文件名清理：移除不合法字符
 */
export function sanitizeFileName(name: string): string {
	let sanitized = name
		.replace(/[\\/:*?"<>|]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	// 按字节截断，确保不超过文件系统 255 字节限制（预留扩展名字节数）
	const maxBytes = 240;
	while (new TextEncoder().encode(sanitized).byteLength > maxBytes) {
		sanitized = sanitized.slice(0, -1);
	}
	return sanitized;
}
