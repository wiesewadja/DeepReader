/**
 * PageIndex: 集中路径管理
 *
 * 所有 pageindex 相关路径通过本模块导出，
 * 确保存储位置（.obsidian/plugins/<pluginId>/pageindex/）在唯一一处定义。
 *
 * ⚠️ PAGEINDEX_DIR 是动态值：
 * - 运行期值由 setActivePluginId(pluginId) 决定（main.ts onload 中调用）
 * - 使用 Proxy 拦截 toString/valueOf/Symbol.toPrimitive，使 `${PAGEINDEX_DIR}/...` 拼接自动跟随
 * - **不要**解构为 const 变量、**不要**用 typeof 判定、**不要**用 === 字符串比较
 * - 新代码建议直接用 pageindexPaths(pluginId) 或 getPageindexDir() 显式函数
 */

import { join } from 'node:path';

/** 当前激活的 pluginId（main.ts 在 onload 中设置） */
let _activePluginId: string = 'deepreader';

/** 设置当前激活的 pluginId（在 plugin.onload 中调用） */
export function setActivePluginId(pluginId: string): void {
	_activePluginId = pluginId;
}

/** 读取当前激活的 pluginId */
export function getActivePluginId(): string {
	return _activePluginId;
}

/** 读取当前 pageindex 相对路径（vault-relative） */
export function getPageindexDir(): string {
	return `.obsidian/plugins/${_activePluginId}/pageindex`;
}

/**
 * pageindex 存储 base dir（vault 相对路径，用于 app.vault.adapter）
 *
 * 实现机制：Proxy 拦截 toString/valueOf/Symbol.toPrimitive，返回当前 pluginId 对应的路径。
 * 这样所有 `${PAGEINDEX_DIR}/xxx` 模板字符串拼接无需改写，自动跟随当前 pluginId。
 *
 * 声明类型为 string 是为了保持现有 87 个调用点零改动；运行时是 Proxy 对象。
 */
export const PAGEINDEX_DIR: string = new Proxy({} as object, {
	get(_target, prop) {
		if (prop === 'toString' || prop === 'valueOf') {
			return () => getPageindexDir();
		}
		if (typeof prop === 'symbol' && prop === Symbol.toPrimitive) {
			return () => getPageindexDir();
		}
		return undefined;
	},
}) as unknown as string;

/** 旧路径（仅迁移时使用） */
export const LEGACY_PAGEINDEX_DIR = '.pageindex';

/**
 * 为指定 pluginId 计算 pageindex 路径族（静态、显式）
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
	return join(vaultPath, getPageindexDir());
}

export function getBookDir(vaultPath: string, bookId: string): string {
	return join(vaultPath, getPageindexDir(), bookId);
}

export function getBookFile(vaultPath: string, bookId: string, filename: string): string {
	return join(vaultPath, getPageindexDir(), bookId, filename);
}

export function getCatalogPath(vaultPath: string): string {
	return join(vaultPath, getPageindexDir(), 'catalog.json');
}

export function getLastPagesPath(vaultPath: string): string {
	return join(vaultPath, getPageindexDir(), 'last-pages.json');
}

// ── adapter 相对路径通过 PAGEINDEX_DIR 常量拼接 ──
