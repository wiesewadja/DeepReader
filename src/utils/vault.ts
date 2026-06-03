/**
 * Vault 文件操作公共工具函数
 */

import { normalizePath, type App } from 'obsidian';

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
