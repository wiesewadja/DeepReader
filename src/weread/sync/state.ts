/**
 * 同步状态持久化 — 通过 VaultAdapter 读写 .pageindex/weread/ 下的 JSON 文件
 *
 * VaultAdapter 是 Obsidian 的 FileSystemAdapter（Node.js 环境下的适配器），
 * 提供 read/write/exists/mkdir 等 Promise 方法。
 */

import { join } from 'path';
import type { WereadSyncState, WereadMapping } from '../types';

/** 微信读书数据目录（相对于 vault 根目录） */
const WEREAD_DIR = '.pageindex/weread';
const SYNC_STATE_FILE = 'sync-state.json';
const MAPPING_FILE = 'mapping.json';

/** VaultAdapter 最小接口 — Obsidian FileSystemAdapter 的子集，路径均为 vault-relative */
export interface VaultAdapter {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	exists(path: string, sensitive?: boolean): Promise<boolean>;
	mkdir(path: string): Promise<void>;
}

/**
 * 同步状态管理器
 *
 * 封装 .pageindex/weread/ 下所有 JSON 文件的读写操作。
 * 所有路径均为 vault-relative。
 */
export class SyncStateManager {
	private readonly wereadDir = WEREAD_DIR;

	constructor(
		private readonly adapter: VaultAdapter,
	) {}

	/** 确保 .pageindex/weread/ 目录存在 */
	async ensureDir(): Promise<void> {
		if (!(await this.adapter.exists(this.wereadDir))) {
			await this.adapter.mkdir(this.wereadDir);
		}
	}

	/** 读取同步状态，文件不存在时返回空状态 */
	async loadSyncState(): Promise<WereadSyncState> {
		const filePath = join(this.wereadDir, SYNC_STATE_FILE);
		try {
			if (!(await this.adapter.exists(filePath))) {
				return { lastSyncTime: 0, syncedBooks: {} };
			}
			const raw = await this.adapter.read(filePath);
			return JSON.parse(raw) as WereadSyncState;
		} catch {
			return { lastSyncTime: 0, syncedBooks: {} };
		}
	}

	/** 写入同步状态 */
	async saveSyncState(state: WereadSyncState): Promise<void> {
		await this.ensureDir();
		const filePath = join(this.wereadDir, SYNC_STATE_FILE);
		await this.adapter.write(filePath, JSON.stringify(state, null, 2));
	}

	/** 读取映射关系，文件不存在时返回空映射 */
	async loadMapping(): Promise<WereadMapping> {
		const filePath = join(this.wereadDir, MAPPING_FILE);
		try {
			if (!(await this.adapter.exists(filePath))) {
				return { mappings: {} };
			}
			const raw = await this.adapter.read(filePath);
			return JSON.parse(raw) as WereadMapping;
		} catch {
			return { mappings: {} };
		}
	}

	/** 写入映射关系 */
	async saveMapping(mapping: WereadMapping): Promise<void> {
		await this.ensureDir();
		const filePath = join(this.wereadDir, MAPPING_FILE);
		await this.adapter.write(filePath, JSON.stringify(mapping, null, 2));
	}
}
