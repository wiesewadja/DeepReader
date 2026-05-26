/**
 * PageIndex 路径迁移
 *
 * 将 .pageindex/ 从 vault 根目录迁移到 .obsidian/plugins/deepreader/pageindex/。
 * 一次性、幂等：旧目录存在就迁移，不存在就跳过。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LEGACY_PAGEINDEX_DIR, PAGEINDEX_DIR } from './paths.js';

/**
 * 迁移旧路径到新路径。
 * @returns true 表示执行了迁移，false 表示无需迁移
 */
export async function migratePageindexPath(vaultPath: string): Promise<boolean> {
	const oldDir = path.join(vaultPath, LEGACY_PAGEINDEX_DIR);
	const newDir = path.join(vaultPath, PAGEINDEX_DIR);

	// 旧路径不存在 → 无需迁移（新安装 或 已迁移）
	try { await fs.access(oldDir); } catch { return false; }

	// 确保新父目录存在
	await fs.mkdir(path.dirname(newDir), { recursive: true });

	// 检查新目录是否已存在（部分迁移场景）
	let newDirExists = false;
	try { await fs.access(newDir); newDirExists = true; } catch {}

	if (newDirExists) {
		// 新旧都存在 → 逐条目合并
		const entries = await fs.readdir(oldDir);
		for (const entry of entries) {
			const src = path.join(oldDir, entry);
			const dst = path.join(newDir, entry);
			await fs.rename(src, dst);
		}
		// 合并完成后删除旧目录
		await fs.rm(oldDir, { recursive: true, force: true });
	} else {
		// 新目录不存在 → 直接重命名
		await fs.rename(oldDir, newDir);
	}

	return true;
}
