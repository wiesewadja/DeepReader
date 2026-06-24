/**
 * 书籍归档管理
 *
 * 提供归档/取消归档操作的纯函数封装，
 * 读写全局目录 catalog.json 中每本书的 archived 字段。
 *
 * 所有函数接收 vaultPath（vault 根目录的绝对路径），
 * 与 library-view.ts 中 fs I/O 的模式一致。
 */

import { nodeFs } from '../utils/node-fs.js';
import { normalizePath } from 'obsidian';
import { getCatalogPath } from './paths.js';
import type { CatalogMeta } from './vault/types.js';

const path = new Proxy({}, {
  get(target, prop) {
    return require('path')[prop];
  }
}) as any;

function getApp(): any {
	return (typeof window !== 'undefined' && (window as any).app) || null;
}

async function readFileCompat(filePath: string): Promise<string> {
	const app = getApp();
	if (app) {
		return await app.vault.adapter.read(normalizePath(filePath));
	}
	return await nodeFs().readFile(filePath, 'utf-8');
}

async function writeFileCompat(filePath: string, content: string): Promise<void> {
	const app = getApp();
	if (app) {
		await app.vault.adapter.write(normalizePath(filePath), content);
		return;
	}
	await nodeFs().writeFile(filePath, content, 'utf-8');
}

async function mkdirCompat(dirPath: string): Promise<void> {
	const app = getApp();
	if (app) {
		await app.vault.adapter.mkdir(normalizePath(dirPath));
		return;
	}
	await nodeFs().mkdir(dirPath, { recursive: true });
}

async function renameCompat(oldPath: string, newPath: string): Promise<void> {
	const app = getApp();
	if (app) {
		await app.vault.adapter.rename(normalizePath(oldPath), normalizePath(newPath));
		return;
	}
	await nodeFs().rename(oldPath, newPath);
}

async function unlinkCompat(filePath: string): Promise<void> {
	const app = getApp();
	if (app) {
		await app.vault.adapter.remove(normalizePath(filePath));
		return;
	}
	await nodeFs().unlink(filePath);
}

/**
 * 加载所有已归档的书籍 ID
 */
export async function loadArchivedBookIds(vaultPath: string): Promise<Set<string>> {
	try {
		const catalogPath = getCatalogPath(vaultPath);
		const content = await readFileCompat(catalogPath);
		const catalog = JSON.parse(content) as CatalogMeta;
		const archived = new Set<string>();
		for (const [bookId, entry] of Object.entries(catalog.books)) {
			if (entry.archived) {
				archived.add(bookId);
			}
		}
		return archived;
	} catch {
		return new Set();
	}
}

/**
 * 切换书籍的归档状态
 *
 * @returns 切换后的状态（true = 已归档，false = 未归档）
 */
export async function toggleArchive(vaultPath: string, bookId: string): Promise<boolean> {
	const catalogPath = getCatalogPath(vaultPath);

	let catalog: CatalogMeta;
	try {
		const content = await readFileCompat(catalogPath);
		catalog = JSON.parse(content) as CatalogMeta;
	} catch {
		catalog = { version: 1, books: {} };
	}

	const entry = catalog.books[bookId];
	if (!entry) {
		// 书中不存在目录条目，创建占位并归档
		catalog.books[bookId] = {
			title: '',
			vectorModel: '',
			dimensions: 0,
			nodeCount: 0,
			hasPropositions: false,
			indexedAt: '',
			archived: true,
		};
		await writeCatalog(catalogPath, catalog);
		return true;
	}

	const newState = !entry.archived;
	entry.archived = newState;
	await writeCatalog(catalogPath, catalog);
	return newState;
}

/**
 * 从 catalog 中清理指定 bookId 的条目（删除索引时调用）
 */
export async function removeFromCatalog(vaultPath: string, bookId: string): Promise<void> {
	const catalogPath = getCatalogPath(vaultPath);
	try {
		const content = await readFileCompat(catalogPath);
		const catalog = JSON.parse(content) as CatalogMeta;
		delete catalog.books[bookId];
		await writeCatalog(catalogPath, catalog);
	} catch {
		// catalog 不存在则无需清理
	}
}

/**
 * 批量切换归档状态（单次读写 catalog.json）
 *
 * @param archive - true = 归档, false = 取消归档
 * @returns 成功切换的数量
 */
export async function batchToggleArchive(
	vaultPath: string,
	bookIds: string[],
	archive: boolean,
): Promise<number> {
	const catalogPath = getCatalogPath(vaultPath);

	let catalog: CatalogMeta;
	try {
		const content = await readFileCompat(catalogPath);
		catalog = JSON.parse(content) as CatalogMeta;
	} catch {
		catalog = { version: 1, books: {} };
	}

	let count = 0;
	for (const bookId of bookIds) {
		const entry = catalog.books[bookId];
		if (!entry) continue;
		if (entry.archived !== archive) {
			entry.archived = archive;
			count++;
		}
	}

	if (count > 0) {
		await writeCatalog(catalogPath, catalog);
	}
	return count;
}

async function writeCatalog(catalogPath: string, catalog: CatalogMeta): Promise<void> {
	await mkdirCompat(path.dirname(catalogPath));
	// 原子写入：先写临时文件再 rename，避免进程被 kill 时部分写入导致 catalog.json 损坏
	const tmpPath = `${catalogPath}.tmp.${process.pid}.${Date.now()}`;
	try {
		await writeFileCompat(tmpPath, JSON.stringify(catalog, null, 2));
		await renameCompat(tmpPath, catalogPath);
	} catch (err) {
		// 清理临时文件（rename 失败或 writeFile 失败）
		await unlinkCompat(tmpPath).catch(() => {});
		throw err;
	}
}
