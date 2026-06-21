/**
 * 从 pageindex 目录加载已索引书籍列表
 * 
 * 采用 100% 跨平台安全的 app.vault.adapter API，
 * 避免对 Node.js 'fs' 和 'path' 的依赖，以支持移动端。
 */

import { type App } from 'obsidian';
import { getPageindexDir } from '../../pageindex/paths.js';
import type { IndexedBook } from '../sync/matcher.js';

export async function loadIndexedBooks(app: App): Promise<IndexedBook[]> {
	const books: IndexedBook[] = [];
	const pageindexDir = getPageindexDir();

	let folders: string[];
	try {
		const result = await app.vault.adapter.list(pageindexDir);
		folders = result.folders;
	} catch {
		return books;
	}

	for (const folder of folders) {
		const metaPath = `${folder}/book-meta.json`;
		try {
			const raw = await app.vault.adapter.read(metaPath);
			const meta = JSON.parse(raw);
			if (meta.bookId && meta.title) {
				books.push({
					bookId: meta.bookId,
					title: meta.title,
					author: meta.author ?? '',
				});
			}
		} catch {
			// 忽略不存在或无法解析的 book-meta.json
		}
	}

	return books;
}
