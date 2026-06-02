/**
 * 同步状态持久化 — 通过 VaultAdapter 读写 <pluginDir>/pageindex/weread/ 下的 JSON 文件
 *
 * VaultAdapter 是 Obsidian 的 FileSystemAdapter（Node.js 环境下的适配器），
 * 提供 read/write/exists/mkdir 等 Promise 方法。
 *
 * 注：pluginDir 由调用方传入（dev='deepreader-dev'，daily='deepreader'），
 *     保证 dev/daily 部署到不同物理目录时数据落在各自 plugin 目录下。
 */

import { join } from 'path';
import type { WereadSyncState, WereadMapping } from '../types';

const SYNC_STATE_FILE = 'sync-state.json';
const MAPPING_FILE = 'mapping.json';

/** VaultAdapter 最小接口 — Obsidian FileSystemAdapter 的子集，路径均为 vault-relative */
export interface VaultAdapter {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	exists(path: string, sensitive?: boolean): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	stat(path: string): Promise<{ size: number } | null>;
}

/**
 * 同步状态管理器
 *
 * 封装 <pluginDir>/pageindex/weread/ 下所有 JSON 文件的读写操作。
 * 所有路径均为 vault-relative。
 */
export class SyncStateManager {
	private readonly wereadDir: string;

	constructor(
		private readonly adapter: VaultAdapter,
		pluginDir: string = 'deepreader',
	) {
		this.wereadDir = `${pluginDir}/pageindex/weread`;
	}

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
				return { lastSyncTime: 0, syncedBooks: {}, excludedBooks: [] };
			}
			const raw = await this.adapter.read(filePath);
			const state = JSON.parse(raw) as WereadSyncState;
			// 兼容旧数据
			if (!state.excludedBooks) state.excludedBooks = [];
			return state;
		} catch {
			return { lastSyncTime: 0, syncedBooks: {}, excludedBooks: [] };
		}
	}

	/** 写入同步状态 */
	async saveSyncState(state: WereadSyncState): Promise<void> {
		await this.ensureDir();
		const filePath = join(this.wereadDir, SYNC_STATE_FILE);
		await this.adapter.write(filePath, JSON.stringify(state, null, 2));
	}

	/** 将书籍加入排除列表 */
	async excludeBook(bookId: string): Promise<void> {
		const state = await this.loadSyncState();
		if (!state.excludedBooks.includes(bookId)) {
			state.excludedBooks.push(bookId);
		}
		// 同时从 syncedBooks 移除，避免残留
		delete state.syncedBooks[bookId];
		await this.saveSyncState(state);
	}

	/** 将书籍从排除列表移除（恢复同步） */
	async unexcludeBook(bookId: string): Promise<void> {
		const state = await this.loadSyncState();
		state.excludedBooks = state.excludedBooks.filter(id => id !== bookId);
		await this.saveSyncState(state);
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
