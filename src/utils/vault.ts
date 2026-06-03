/**
 * Vault 文件操作公共工具函数
 */

import { normalizePath, type App } from 'obsidian';
import type { VaultAdapter } from '../weread/sync/state.js';

/**
 * 获取 Vault 的 FileSystemAdapter（桌面端）。
 * Obsidian 的 App.vault.adapter 类型不暴露 write/exists 等方法，
 * 但桌面端实际是 FileSystemAdapter，通过类型断言获取完整接口。
 */
export function getVaultAdapter(app: App): VaultAdapter | null {
	const adapter = (app as unknown as { vault?: { adapter?: VaultAdapter } }).vault?.adapter;
	return adapter ?? null;
}

/**
 * 确保 Vault 中的目录路径存在，逐级创建缺失的子目录。
 */
export async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
	if (!folderPath) return;
	const normalized = normalizePath(folderPath);
	if (!normalized) return;
	const parts = normalized.split('/');
	let currentPath = '';

	for (const part of parts) {
		currentPath = currentPath ? `${currentPath}/${part}` : part;
		const folder = app.vault.getAbstractFileByPath(currentPath);

		if (!folder) {
			await app.vault.createFolder(currentPath);
		}
	}
}
