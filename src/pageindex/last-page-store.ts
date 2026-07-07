/**
 * 上次阅读页码 + 最近阅读时间存储
 *
 * 为每本书记录"上次阅读到的页码"和"最近一次翻页时间戳"，跨 Obsidian 会话持久化。
 * 与 archive.ts 风格一致：纯函数 + vaultPath 参数，原子写入（tmp+rename）。
 *
 * 数据格式（v2）：
 * {
 *   "version": 2,
 *   "entries": {
 *     "books/xxx.epub": { "page": 42, "lastReadAt": 1717350000000 },
 *     "DeepReader/assets/yyy.pdf": { "page": 17, "lastReadAt": 1717350123000 }
 *   }
 * }
 *
 * 兼容 v1：旧数据 entries 为 Record<string, number>（仅页码），
 * 加载时自动迁移为 v2，lastReadAt 填 0（无时间信息，但能恢复页码位置）。
 *
 * 写入策略：debounced 200ms（避免每页都触发 fs I/O）。
 */

import { nodeFs } from '../utils/node-fs.js';
import { pageindexPaths } from './paths';

/** 容量上限：内存 map 与落盘共用同一阈值，避免漂移。单一事实源，供 PageMemoryStore 复用。 */
export const MAX_ENTRIES = 500;

export interface LastPageEntry {
	page: number;
	lastReadAt: number;
}

export interface LastPagesData {
	version: 2;
	entries: Record<string, LastPageEntry>;
}

export interface LastPagesState {
	pages: Map<string, number>;
	lastReadAt: Map<string, number>;
}

/**
 * 加载所有已记录的页码 + 最近阅读时间
 *
 * 仅从当前 pluginId 路径加载，文件不存在时返回空 maps。
 * 注意：dev/daily 共享 vault 时不会跨读对方数据（避免污染）。
 * @returns 文件不存在/解析失败时返回空 maps
 */
export async function loadLastPages(vaultPath: string, pluginId: string): Promise<LastPagesState> {
	const empty: LastPagesState = {
		pages: new Map(),
		lastReadAt: new Map(),
	};
	if (!vaultPath) return empty;
	const id = pluginId;
	const paths = pageindexPaths(id);
	const filePath = paths.lastPages(vaultPath);
	let parsed: any;
	try {
		const content = await nodeFs().readFile(filePath, 'utf-8');
		parsed = JSON.parse(content);
	} catch {
		return empty;
	}
	if (!parsed || typeof parsed !== 'object' || !parsed.entries) return empty;

	const pages = new Map<string, number>();
	const lastReadAt = new Map<string, number>();
	for (const [k, v] of Object.entries(parsed.entries)) {
		if (typeof k !== 'string' || !k) continue;
		if (parsed.version === 1) {
			// v1: entries[k] = number (仅页码)
			if (typeof v === 'number' && v >= 1 && Number.isFinite(v)) {
				pages.set(k, v);
				// v1 没有时间信息，给 0 表示"无时间数据"，自然不会被 openMostRecent 选中
				// 但首次翻页会更新 lastReadAt
				lastReadAt.set(k, 0);
			}
		} else {
			// v2: entries[k] = { page, lastReadAt }
			const entry = v as Partial<LastPageEntry> | null;
			if (
				entry &&
				typeof entry.page === 'number' && entry.page >= 1 && Number.isFinite(entry.page) &&
				typeof entry.lastReadAt === 'number' && Number.isFinite(entry.lastReadAt)
			) {
				pages.set(k, entry.page);
				lastReadAt.set(k, entry.lastReadAt);
			}
		}
	}
	return { pages, lastReadAt };
}

/**
 * 原子写入整张 map
 * 容量超过 MAX_ENTRIES 时丢弃最旧的（与 pageMemory 策略一致）
 */
export async function saveLastPages(
	vaultPath: string,
	pages: Map<string, number>,
	lastReadAt: Map<string, number>,
	pluginId: string
): Promise<void> {
	if (!vaultPath) return;

	// 合并：仅保留 pages 和 lastReadAt 都有效（或至少 page 有效）的条目
	const merged: Record<string, LastPageEntry> = {};
	for (const [k, page] of pages) {
		if (typeof page !== 'number' || page < 1 || !Number.isFinite(page)) continue;
		const ts = lastReadAt.get(k) ?? 0;
		merged[k] = { page, lastReadAt: ts };
	}

	// 截断到 MAX_ENTRIES：按 lastReadAt 升序，删除最早的
	const keys = Object.keys(merged);
	if (keys.length > MAX_ENTRIES) {
		keys.sort((a, b) => merged[a].lastReadAt - merged[b].lastReadAt);
		const toRemove = keys.slice(0, keys.length - MAX_ENTRIES);
		for (const k of toRemove) delete merged[k];
	}

	const id = pluginId;
	const paths = pageindexPaths(id);
	const filePath = paths.lastPages(vaultPath);
	const data: LastPagesData = {
		version: 2,
		entries: merged,
	};

	// 原子写入：先写临时文件再 rename
	const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
	try {
		await nodeFs().mkdir(/* dirname */ filePath.replace(/[^/]+$/, ''), { recursive: true });
		await nodeFs().writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
		await nodeFs().rename(tmpPath, filePath);
	} catch (err) {
		await nodeFs().unlink(tmpPath).catch(() => {});
		throw err;
	}
}
