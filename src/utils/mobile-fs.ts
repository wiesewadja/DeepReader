/**
 * 跨平台文件系统工具函数
 *
 * 封装 Obsidian vault.adapter API，替代 Node.js fs/path 模块。
 * 桌面端和移动端使用同一套代码路径（vault.adapter 在两端均可用）。
 */

import { type App, normalizePath } from 'obsidian';
import { join } from 'path';
import type { TFile } from 'obsidian';
import { PAGEINDEX_DIR } from '../pageindex/paths.js';

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
	const adapter = app.vault.adapter as any;
	const dir = normalizePath(relativePath);
	if (typeof adapter.rmdir === 'function') {
		return adapter.rmdir(dir, true);
	}
	// Fallback: 手动递归删除（兼容不同 adapter 实现）
	const { files, folders } = await adapter.list(dir);
	for (const f of files) await adapter.remove(f);
	for (const d of folders) await vaultRmdir(app, d);
	await adapter.remove(dir);
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
 * 桌面端用 basePath + vault 相对路径哈希（与索引构建一致）
 * 移动端通过 book-meta.json 标题匹配查找已有的 bookId
 */
export async function resolveBookIdFromPdf(app: App, pdfName: string): Promise<string | null> {
	const basePath = (app.vault.adapter as any).basePath as string | undefined;

	if (basePath) {
		// 桌面端：直接用绝对路径哈希（与索引构建时的 bookId 一致）
		const bookName = pdfName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
		const files = app.vault.getFiles();
		const bookFile = files.find((f: TFile) =>
			f.path.includes(bookName) && (f.extension === 'pdf' || f.extension === 'epub')
		);
		if (!bookFile) return null;
		return (await sha256Hex(join(basePath, bookFile.path))).slice(0, 8);
	}

	// 移动端：遍历 pageindex 目录，通过 book-meta.json 的标题匹配
	const bookTitle = pdfName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
	try {
		const { folders } = await app.vault.adapter.list(PAGEINDEX_DIR);
		for (const folder of folders) {
			const bookId = folder.split('/').pop() || folder;
			try {
				const meta = await app.vault.adapter.read(`${PAGEINDEX_DIR}/${bookId}/book-meta.json`);
				const parsed = JSON.parse(meta);
				if (parsed.title && parsed.title.includes(bookTitle)) {
					return bookId;
				}
			} catch { continue; }
		}
	} catch { /* pageindex dir not found */ }
	return null;
}
