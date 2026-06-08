/**
 * 书籍 ID 解析 — 从文件名查找 bookId
 *
 * 桌面端用 basePath + vault 相对路径哈希（与索引构建一致）
 * 移动端通过 book-meta.json 标题匹配查找已有的 bookId
 */

import { type App, type TFile } from 'obsidian';
import { sha256Hex } from '../utils/mobile-fs.js';
import { PAGEINDEX_DIR, getPageindexDir } from './paths.js';

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
		return (await sha256Hex(`${basePath}/${bookFile.path}`)).slice(0, 8);
	}

	// 移动端：遍历 pageindex 目录，通过 book-meta.json 的标题匹配
	const bookTitle = pdfName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '');
	try {
		const { folders } = await app.vault.adapter.list(getPageindexDir());
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
