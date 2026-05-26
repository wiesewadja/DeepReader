/**
 * PageIndex: 集中路径管理
 *
 * 所有 pageindex 相关路径通过本模块导出，
 * 确保存储位置（.obsidian/plugins/deepreader/pageindex/）在唯一一处定义。
 */

import { join } from 'node:path';

/** pageindex 存储 base dir（vault 相对路径，用于 app.vault.adapter） */
export const PAGEINDEX_DIR = '.obsidian/plugins/deepreader/pageindex';

/** 旧路径（仅迁移时使用） */
export const LEGACY_PAGEINDEX_DIR = '.pageindex';

// ── fs 绝对路径（用于 node:fs 操作） ──

export function getPageindexRoot(vaultPath: string): string {
	return join(vaultPath, PAGEINDEX_DIR);
}

export function getBookDir(vaultPath: string, bookId: string): string {
	return join(vaultPath, PAGEINDEX_DIR, bookId);
}

export function getBookFile(vaultPath: string, bookId: string, filename: string): string {
	return join(vaultPath, PAGEINDEX_DIR, bookId, filename);
}

export function getCatalogPath(vaultPath: string): string {
	return join(vaultPath, PAGEINDEX_DIR, 'catalog.json');
}

// ── adapter 相对路径（用于 app.vault.adapter 操作） ──

export function getAdapterBookFile(bookId: string, filename: string): string {
	return `${PAGEINDEX_DIR}/${bookId}/${filename}`;
}

export function getAdapterWereadFile(filename: string): string {
	return `${PAGEINDEX_DIR}/weread/${filename}`;
}

export function getAdapterJournalDir(hash: string): string {
	return `${PAGEINDEX_DIR}/journal_${hash}`;
}
