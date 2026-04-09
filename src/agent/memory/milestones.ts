/**
 * 阅读里程碑记录器
 *
 * 负责：
 * 1. 监听书籍切换 -> 记录到 HISTORY.md
 * 2. 监听阅读进度里程碑 -> 记录到 HISTORY.md
 * 3. 生成人类可读的里程碑日志
 *
 * HISTORY.md 记录的事件类型：
 * - 📖 开始阅读新书
 * - 🔄 切换书籍
 * - 📍 进度里程碑 (25%/50%/75%)
 * - 💡 吸收度提升 (>20%)
 * - ✅ 完成一轮阅读
 * - 🔁 开始新一轮阅读
 */

import type { App } from 'obsidian';
import { MemoryStore } from './store.js';
import { readReadingProgress, type ReadingProgressData } from '../utils/plugin-data.js';
import { agentLog as log } from '../../utils/logger.js';

/** 里程碑类型 */
export type MilestoneType =
	| 'start_reading'
	| 'switch_book'
	| 'coverage_25'
	| 'coverage_50'
	| 'coverage_75'
	| 'absorption_boost'
	| 'round_complete'
	| 'round_start';

/** 里程碑配置 */
interface MilestoneConfig {
	emoji: string;
	template: (data: MilestoneData) => string;
}

/** 里程碑数据 */
interface MilestoneData {
	bookName: string;
	coverage?: number;
	absorption?: number;
	previousBook?: string;
	round?: number;
}

/** 里程碑配置表 */
const MILESTONE_CONFIGS: Record<MilestoneType, MilestoneConfig> = {
	start_reading: {
		emoji: '📖',
		template: (d) => `📖 开始阅读《${d.bookName}》`,
	},
	switch_book: {
		emoji: '🔄',
		template: (d) => `🔄 从《${d.previousBook}》切换到《${d.bookName}》`,
	},
	coverage_25: {
		emoji: '📍',
		template: (d) => `📍 《${d.bookName}》阅读进度 25%（覆盖度 ${d.coverage}%，吸收度 ${d.absorption}%）`,
	},
	coverage_50: {
		emoji: '📍',
		template: (d) => `📍 《${d.bookName}》阅读过半（覆盖度 ${d.coverage}%，吸收度 ${d.absorption}%）`,
	},
	coverage_75: {
		emoji: '📍',
		template: (d) => `📍 《${d.bookName}》阅读进度 75%（覆盖度 ${d.coverage}%，吸收度 ${d.absorption}%）`,
	},
	absorption_boost: {
		emoji: '💡',
		template: (d) => `💡 《${d.bookName}》理解加深（吸收度 ${d.absorption}%）`,
	},
	round_complete: {
		emoji: '✅',
		template: (d) => `✅ 完成《${d.bookName}》第 ${d.round} 轮阅读（覆盖度 ${d.coverage}%，吸收度 ${d.absorption}%）`,
	},
	round_start: {
		emoji: '🔁',
		template: (d) => `🔁 开始《${d.bookName}》第 ${d.round} 轮阅读`,
	},
};

/**
 * 阅读里程碑记录器
 */
export class MilestoneRecorder {
	private app: App;
	private store: MemoryStore;
	private lastCoverage: Map<string, number> = new Map();
	private lastAbsorption: Map<string, number> = new Map();
	private currentBook: string | null = null;

	constructor(app: App) {
		this.app = app;
		this.store = new MemoryStore(app);
	}

	/**
	 * 记录里程碑事件
	 */
	async recordMilestone(type: MilestoneType, data: MilestoneData): Promise<void> {
		const config = MILESTONE_CONFIGS[type];
		const entry = config.template(data);

		try {
			await this.store.appendHistory(entry);
			log(`[Milestone] ${entry}`);
		} catch (err) {
			log('[Milestone] 记录失败:', err);
		}
	}

	/**
	 * 处理书籍切换
	 *
	 * @param newBook 新书名
	 * @returns 是否是首次阅读该书
	 */
	async handleBookSwitch(newBook: string): Promise<boolean> {
		const isFirstTime = this.currentBook === null;

		if (this.currentBook && this.currentBook !== newBook) {
			// 切换书籍
			await this.recordMilestone('switch_book', {
				bookName: newBook,
				previousBook: this.currentBook,
			});
		} else if (isFirstTime) {
			// 首次阅读
			await this.recordMilestone('start_reading', { bookName: newBook });
		}

		this.currentBook = newBook;
		return isFirstTime;
	}

	/**
	 * 检查并记录进度里程碑
	 *
	 * @param progress 当前阅读进度
	 * @returns 是否触发了里程碑
	 */
	async checkProgressMilestones(progress: ReadingProgressData): Promise<MilestoneType[]> {
		const triggered: MilestoneType[] = [];
		const bookName = progress.bookName;
		const coverage = progress.coverage;
		const absorption = progress.absorption;

		const lastCov = this.lastCoverage.get(bookName) || 0;
		const lastAbs = this.lastAbsorption.get(bookName) || 0;

		// 检查覆盖度里程碑 (25%, 50%, 75%)
		const coverageMilestones: Array<{ threshold: number; type: MilestoneType }> = [
			{ threshold: 25, type: 'coverage_25' },
			{ threshold: 50, type: 'coverage_50' },
			{ threshold: 75, type: 'coverage_75' },
		];

		for (const { threshold, type } of coverageMilestones) {
			if (lastCov < threshold && coverage >= threshold) {
				await this.recordMilestone(type, { bookName, coverage, absorption });
				triggered.push(type);
			}
		}

		// 检查吸收度提升 (>20% 跳跃)
		if (lastAbs > 0 && absorption - lastAbs >= 20) {
			await this.recordMilestone('absorption_boost', { bookName, absorption });
			triggered.push('absorption_boost');
		}

		// 更新缓存
		this.lastCoverage.set(bookName, coverage);
		this.lastAbsorption.set(bookName, absorption);

		return triggered;
	}

	/**
	 * 初始化书籍进度缓存
	 *
	 * 在插件加载时调用，预先读取所有书籍的进度
	 */
	async initializeCache(): Promise<void> {
		try {
			// 读取所有已读书籍的进度
			const { listAllReadingProgress } = await import('../utils/plugin-data.js');
			const progressList = await listAllReadingProgress(this.app);

			for (const progress of progressList) {
				this.lastCoverage.set(progress.bookName, progress.coverage);
				this.lastAbsorption.set(progress.bookName, progress.absorption);
			}

			log(`[Milestone] 初始化缓存: ${progressList.length} 本书`);
		} catch (err) {
			log('[Milestone] 初始化缓存失败:', err);
		}
	}

	/**
	 * 获取当前书籍
	 */
	getCurrentBook(): string | null {
		return this.currentBook;
	}

	/**
	 * 设置当前书籍（用于恢复状态）
	 */
	setCurrentBook(bookName: string): void {
		this.currentBook = bookName;
	}
}
