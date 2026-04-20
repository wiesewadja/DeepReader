/**
 * 阅读里程碑记录器
 *
 * 负责：
 * 1. 监听书籍切换 -> 记录到 HISTORY.md
 * 2. 生成人类可读的里程碑日志
 *
 * HISTORY.md 记录的事件类型：
 * - 📖 开始阅读新书
 * - 🔄 切换书籍
 */

import type { App } from 'obsidian';
import { MemoryStore } from './store.js';
import { agentLog as log } from '../../utils/logger.js';

/** 里程碑类型 */
export type MilestoneType =
	| 'start_reading'
	| 'switch_book';

/** 里程碑配置 */
interface MilestoneConfig {
	emoji: string;
	template: (data: MilestoneData) => string;
}

/** 里程碑数据 */
interface MilestoneData {
	bookName: string;
	previousBook?: string;
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
};

/**
 * 阅读里程碑记录器
 */
export class MilestoneRecorder {
	private app: App;
	private store: MemoryStore;
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
