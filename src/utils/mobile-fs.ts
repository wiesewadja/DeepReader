/**
 * 跨平台文件系统工具函数
 *
 * 封装 Obsidian vault.adapter API，替代 Node.js fs/path 模块。
 * 桌面端和移动端使用同一套代码路径（vault.adapter 在两端均可用）。
 */

import { type App, normalizePath } from 'obsidian';
import type { TFile } from 'obsidian';

/** 通过 Vault API 读取文本文件 */
export async function vaultRead(app: App, relativePath: string): Promise<string> {
	return app.vault.adapter.read(normalizePath(relativePath));
}

/** 通过 Vault API 读取二进制文件 */
export async function vaultReadBinary(app: App, relativePath: string): Promise<ArrayBuffer> {
	return app.vault.adapter.readBinary(normalizePath(relativePath));
}

/** 检查文件或目录是否存在 */
export async function vaultExists(app: App, relativePath: string): Promise<boolean> {
	const stat = await app.vault.adapter.stat(normalizePath(relativePath));
	return stat != null;
}

/** 列出目录内容 */
export async function vaultList(app: App, dirPath: string): Promise<{ files: string[]; folders: string[] }> {
	return app.vault.adapter.list(normalizePath(dirPath));
}

/** 创建目录 */
export async function vaultMkdir(app: App, dirPath: string): Promise<void> {
	return app.vault.adapter.mkdir(normalizePath(dirPath));
}

/** 删除文件 */
export async function vaultRemove(app: App, relativePath: string): Promise<void> {
	return app.vault.adapter.remove(normalizePath(relativePath));
}

/** 递归删除目录 */
export async function vaultRmdir(app: App, relativePath: string): Promise<void> {
	return (app.vault.adapter as any).rmdir(normalizePath(relativePath), true);
}

/** 写入文本文件 */
export async function vaultWrite(app: App, relativePath: string, content: string): Promise<void> {
	return app.vault.adapter.write(normalizePath(relativePath), content);
}

/** 写入二进制文件 */
export async function vaultWriteBinary(app: App, relativePath: string, data: ArrayBuffer): Promise<void> {
	return app.vault.adapter.writeBinary(normalizePath(relativePath), data);
}

/** Web Crypto API SHA-256 哈希 */
export async function sha256Hex(data: string): Promise<string> {
	const encoded = new TextEncoder().encode(data);
	const hash = await crypto.subtle.digest('SHA-256', encoded);
	return Array.from(new Uint8Array(hash))
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');
}

/** 轻量路径拼接（替代 path.join） */
export function joinPath(...segments: string[]): string {
	return normalizePath(segments.filter(Boolean).join('/'));
}

/** 提取文件名（替代 path.basename） */
export function basename(filePath: string, ext?: string): string {
	const name = filePath.split('/').pop() || '';
	return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
}

/**
 * 从 pdfName 查找书籍文件并计算 bookId（fallback 路径）
 * 桌面端用绝对路径哈希，移动端用 vault 相对路径
 */
export async function resolveBookIdFromPdf(app: App, pdfName: string): Promise<string | null> {
	const bookName = pdfName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
	const files = app.vault.getFiles();
	const bookFile = files.find((f: TFile) =>
		f.path.includes(bookName) && (f.extension === 'pdf' || f.extension === 'epub')
	);
	if (!bookFile) return null;
	const basePath = (app.vault.adapter as any).basePath as string | undefined;
	const hashInput = basePath ? `${basePath}/${bookFile.path}` : bookFile.path;
	return (await sha256Hex(hashInput)).slice(0, 8);
}
