/**
 * 从 .pageindex 目录加载已索引书籍列表
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import type { IndexedBook } from '../sync/matcher';
import { getPageindexRoot } from '../../pageindex/paths.js';

export async function loadIndexedBooks(vaultPath: string): Promise<IndexedBook[]> {
	const pageindexDir = getPageindexRoot(vaultPath);
	const books: IndexedBook[] = [];

	let entries: string[];
	try {
		entries = await fs.readdir(pageindexDir);
	} catch {
		return books;
	}

	for (const entry of entries) {
		const metaPath = join(pageindexDir, entry, 'book-meta.json');
		try {
			const raw = await fs.readFile(metaPath, 'utf-8');
			const meta = JSON.parse(raw);
			if (meta.bookId && meta.title) {
				books.push({
					bookId: meta.bookId,
					title: meta.title,
					author: meta.author ?? '',
				});
			}
		} catch {
			// 忽略无法读取的文件
		}
	}

	return books;
}
