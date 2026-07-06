/**
 * 阅读模式页码记忆存储（深模块）
 *
 * 把 ReadingModeService 中与"页码记忆 / 最近阅读时间 / 持久化"相关的纯逻辑
 * 抽到本模块，使 Shell（ReadingModeService）退化为生命周期编排器。
 *
 * 依赖边界：
 * - 通过注入的 `app`（Obsidian API）读写 vault 路径与校验文件存在性；
 * - 持久化委托给 `pageindex/last-page-store` 的 `loadLastPages` / `saveLastPages`；
 * - 不持有 Paginator / DOM / 聊天态，保持单一职责、可独立单测。
 */

import type { App } from "obsidian";
import { TFile } from "obsidian";
import { loadLastPages, saveLastPages } from "../../pageindex/last-page-store.js";
import { getVaultPath } from "../../utils/mobile-fs.js";
import { serviceLog } from "../../utils/logger.js";

/** 与 last-page-store.MAX_ENTRIES 对齐，防止长期运行 map 无限增长 */
const MAX_ENTRIES = 500;

export class PageMemoryStore {
	private app: App;
	private pluginId: string;
	/** 翻页上限来源（由 Shell 注入 paginator.getTotalPages），用于 recordPage 的越界守卫 */
	private totalPagesProvider: () => number;
	private pageMemory: Map<string, number> = new Map();
	private lastReadAt: Map<string, number> = new Map();
	private _saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(app: App, pluginId: string, totalPagesProvider: () => number = () => 0) {
		this.app = app;
		this.pluginId = pluginId;
		this.totalPagesProvider = totalPagesProvider;
	}

	/**
	 * 从磁盘加载历史到内存 map（fire-and-forget 异步）
	 * 注意：加载完成前 pageMemory 为空 Map，页码恢复会静默跳过。
	 */
	loadLastPagesFromDisk(): void {
		const vaultPath = getVaultPath(this.app);
		if (!vaultPath) return;
		loadLastPages(vaultPath, this.pluginId)
			.then(({ pages, lastReadAt }) => {
				this.pageMemory = pages;
				this.lastReadAt = lastReadAt;
				serviceLog("[ReadingMode] Loaded last-pages:", pages.size, "entries");
			})
			.catch((err) => {
				serviceLog("[ReadingMode] loadLastPages failed:", err);
			});
	}

	/**
	 * 记录页码 + 标记最近阅读时间 + 调度 debounced 持久化
	 */
	recordPage(filePath: string, page: number): void {
		if (!filePath) return;
		if (typeof page !== "number" || !Number.isFinite(page) || page < 1) return;
		const total = this.totalPagesProvider();
		if (total > 0 && page > total) return;
		this.pageMemory.set(filePath, page);
		this.lastReadAt.set(filePath, Date.now());
		// 内存侧淘汰：与 last-page-store MAX_ENTRIES 同步
		if (this.pageMemory.size > MAX_ENTRIES) {
			let oldest: string | null = null;
			let oldestTime = Infinity;
			for (const [k, ts] of this.lastReadAt) {
				if (ts < oldestTime) {
					oldestTime = ts;
					oldest = k;
				}
			}
			if (oldest) {
				this.pageMemory.delete(oldest);
				this.lastReadAt.delete(oldest);
			}
		}
		this.scheduleSave();
	}

	/**
	 * 调度 debounced 持久化（200ms 内合并多次翻页）
	 */
	scheduleSave(): void {
		if (this._saveTimer) clearTimeout(this._saveTimer);
		this._saveTimer = setTimeout(() => {
			this._saveTimer = null;
			this.flushSave().catch((err) => {
				serviceLog("[ReadingMode] flushSave failed:", err);
			});
		}, 200);
	}

	/**
	 * 立即保存到磁盘（取消 pending timer）
	 */
	async flushSave(): Promise<void> {
		if (this._saveTimer) {
			clearTimeout(this._saveTimer);
			this._saveTimer = null;
		}
		const vaultPath = getVaultPath(this.app);
		if (!vaultPath) return;
		// 没有历史可写
		if (this.pageMemory.size === 0) return;
		await saveLastPages(vaultPath, this.pageMemory, this.lastReadAt, this.pluginId);
	}

	/**
	 * 在指定文件夹下查找最近阅读的文件路径。
	 * 用于书库点击书籍时定位到上次阅读的章节。
	 */
	findMostRecentInFolder(folderPath: string): string | null {
		let bestPath: string | null = null;
		let bestTime = -1;
		for (const [path, time] of this.lastReadAt) {
			if (path.startsWith(folderPath + "/") && time > bestTime) {
				bestTime = time;
				bestPath = path;
			}
		}
		return bestPath;
	}

	/**
	 * 获取指定文件夹下最近阅读的时间戳。用于书库按最近阅读时间排序。
	 * @returns 最近阅读的时间戳，如果没有阅读记录返回 0
	 */
	getBookLastReadTime(folderPath: string): number {
		let bestTime = 0;
		for (const [path, time] of this.lastReadAt) {
			if (path.startsWith(folderPath + "/") && time > bestTime) {
				bestTime = time;
			}
		}
		return bestTime;
	}

	/**
	 * 读取已保存的页码（供分页器恢复上次阅读位置）。无记录返回 undefined。
	 */
	getPage(filePath: string): number | undefined {
		return this.pageMemory.get(filePath);
	}

	/**
	 * 从 lastReadAt 中找出最近阅读的文件路径（不含存在性校验）。
	 * 供 resolveMostRecentFile 复用。
	 */
	private findMostRecentPath(): string | null {
		let bestPath: string | null = null;
		let bestTime = -1;
		for (const [path, time] of this.lastReadAt) {
			if (time > bestTime) {
				bestTime = time;
				bestPath = path;
			}
		}
		return bestPath;
	}

	/**
	 * 解析最近阅读的文件（含存在性校验 + 删除清理）。
	 * 供 Shell.openMostRecent 调用：返回 TFile 或 null。
	 */
	resolveMostRecentFile(): TFile | null {
		const path = this.findMostRecentPath();
		if (!path) return null;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			// 文件已被删除，清理历史
			serviceLog("[ReadingMode] openMostRecent: file no longer exists:", path);
			this.pageMemory.delete(path);
			this.lastReadAt.delete(path);
			this.scheduleSave();
			return null;
		}
		return file;
	}
}
