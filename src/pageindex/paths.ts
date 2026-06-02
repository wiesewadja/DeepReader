/**
 * PageIndex: 集中路径管理
 *
 * 所有 pageindex 相关路径通过本模块导出，
 * 确保存储位置（.obsidian/plugins/<pluginId>/pageindex/）在唯一一处定义。
 *
 * 调用方式：
 * - main.ts 在 onload 中调用 setActivePluginId(this.manifest.id)
 * - 之后 PAGEINDEX_DIR 自动跟随当前 pluginId 变化（dev/daily 隔离）
 * - 也可直接使用 pageindexPaths(pluginId) 系列函数（静态、显式）
 */

import { join } from 'node:path';

/** 当前激活的 pluginId（main.ts 在 onload 中设置） */
let _activePluginId: string = 'deepreader';

/** 设置当前激活的 pluginId（在 plugin.onload 中调用） */
export function setActivePluginId(pluginId: string): void {
	_activePluginId = pluginId;
}

/** pageindex 存储 base dir（vault 相对路径，用于 app.vault.adapter）
 *  使用 String 对象 + toString/valueOf 拦截，使所有模板字符串拼接自动使用当前 pluginId。
 *  导出类型标记为 string 以保持调用方零改动；运行时为 String 对象，字符串拼接/toString() 自动跟随。
 */
export const PAGEINDEX_DIR: string = new String('') as unknown as string;
(PAGEINDEX_DIR as any).toString = () => `.obsidian/plugins/${_activePluginId}/pageindex`;
(PAGEINDEX_DIR as any).valueOf = () => `.obsidian/plugins/${_activePluginId}/pageindex`;

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
	return join(vaultPath, String(PAGEINDEX_DIR));
}

export function getBookDir(vaultPath: string, bookId: string): string {
	return join(vaultPath, String(PAGEINDEX_DIR), bookId);
}

export function getBookFile(vaultPath: string, bookId: string, filename: string): string {
	return join(vaultPath, String(PAGEINDEX_DIR), bookId, filename);
}

export function getCatalogPath(vaultPath: string): string {
	return join(vaultPath, String(PAGEINDEX_DIR), 'catalog.json');
}

export function getLastPagesPath(vaultPath: string): string {
	return join(vaultPath, String(PAGEINDEX_DIR), 'last-pages.json');
}

// ── adapter 相对路径通过 PAGEINDEX_DIR 常量拼接 ──
