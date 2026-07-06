/**
 * PageIndex 路径迁移
 *
 * 将 .pageindex/ 从 vault 根目录迁移到 .obsidian/plugins/deepreader/pageindex/。
 * 一次性、幂等：旧目录存在就迁移，不存在就跳过。
 */

import { nodeFs } from '../utils/node-fs.js'; // 惰性 fs/promises：迁移仅桌面端触发（getVaultPath null 时跳过），与 node-fs.ts 双轨策略一致
import { nodePath } from '../utils/node-compat.js';

import { LEGACY_PAGEINDEX_DIR, PAGEINDEX_DIR, getPageindexDir } from './paths.js';


/**
 * 迁移旧路径到新路径。
 * @returns true 表示执行了迁移，false 表示无需迁移
 */
export async function migratePageindexPath(vaultPath: string): Promise<boolean> {
	const oldDir = nodePath().join(vaultPath, LEGACY_PAGEINDEX_DIR);
	const newDir = nodePath().join(vaultPath, getPageindexDir());

	// 旧路径不存在 → 无需迁移（新安装 或 已迁移）
	try { await nodeFs().access(oldDir); } catch { return false; }

	// 确保新父目录存在
	await nodeFs().mkdir(nodePath().dirname(newDir), { recursive: true });

	// 检查新目录是否已存在（部分迁移场景）
	let newDirExists = false;
	try { await nodeFs().access(newDir); newDirExists = true; } catch {}

	if (newDirExists) {
		// 新旧都存在 → 逐条目合并（处理同名条目冲突）
		const entries = await nodeFs().readdir(oldDir);
		for (const entry of entries) {
			const src = nodePath().join(oldDir, entry);
			const dst = nodePath().join(newDir, entry);
			const dstExists = await nodeFs().access(dst).then(() => true).catch(() => false);
			if (dstExists) {
				// 同名条目 → 递归复制后删除源
				await nodeFs().cp(src, dst, { recursive: true });
				await nodeFs().rm(src, { recursive: true, force: true });
			} else {
				await nodeFs().rename(src, dst);
			}
		}
		// 合并完成后删除旧目录
		await nodeFs().rm(oldDir, { recursive: true, force: true });
	} else {
		// 新目录不存在 → 直接重命名
		await nodeFs().rename(oldDir, newDir);
	}

	return true;
}
