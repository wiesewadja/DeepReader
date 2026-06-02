/**
 * PageIndex: 集中路径管理
 *
 * 所有 pageindex 相关路径通过本模块导出，
 * 确保存储位置（.obsidian/plugins/deepreader/pageindex/）在唯一一处定义。
 *
 * 注: dev/daily 分离后，PAGEINDEX_DIR 仍硬编码为 `deepreader`（向后兼容）。
 *     新引入 pluginId 的存储路径请使用 pageindexPaths(pluginId) 系列函数。
 */

import { join } from 'node:path';

/** pageindex 存储 base dir（vault 相对路径，用于 app.vault.adapter） */
export const PAGEINDEX_DIR = '.obsidian/plugins/deepreader/pageindex';

/** 旧路径（仅迁移时使用） */
export const LEGACY_PAGEINDEX_DIR = '.pageindex';

/**
 * 为指定 pluginId 计算 pageindex 路径族
 * - dev 部署（pluginId="deepreader-dev"）→ .obsidian/plugins/deepreader-dev/pageindex
 * - daily 部署（pluginId="deepreader"）→ .obsidian/plugins/deepreader/pageindex
 */
export function pageindexPaths(pluginId: string) {
	const base = `.obsidian/plugins/${pluginId}/pageindex`;
	return {
		rel: base,
		root: (vaultPath: string) => join(vaultPath, base),
		bookDir: (vaultPath: string, bookId: string) => join(vaultPath, base, bookId),
		bookFile: (vaultPath: string, bookId: string, filename: string) =>
			join(vaultPath, base, bookId, filename),
		catalog: (vaultPath: string) => join(vaultPath, base, 'catalog.json'),
		lastPages: (vaultPath: string) => join(vaultPath, base, 'last-pages.json'),
	};
}

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

export function getLastPagesPath(vaultPath: string): string {
	return join(vaultPath, PAGEINDEX_DIR, 'last-pages.json');
}

// ── adapter 相对路径通过 PAGEINDEX_DIR 常量拼接 ──
