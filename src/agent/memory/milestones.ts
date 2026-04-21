/**
 * 阅读里程碑记录器
 *
 * 负责：
 * 1. 监听书籍切换 -> 记录到 HISTORY.md
 * 2. 生成人类可读的里程碑日志
 * 3. 启动时从 HISTORY.md 恢复状态，避免重复记录
 *
 * HISTORY.md 记录的事件类型：
 * - 📖 开始阅读新书（同一本书每天最多记录一次）
 * - 🔄 切换书籍（前后是不同书才记录）
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
	/** 同一本书最近一次记录的日期（YYYY-MM-DD），用于去重 */
	private lastRecordDate: string | null = null;

	constructor(app: App) {
		this.app = app;
		this.store = new MemoryStore(app);
	}

	/**
	 * 从 HISTORY.md 最后一条记录恢复 currentBook 状态
	 * 避免视图重建后对同一本书重复生成"开始阅读"里程碑
	 */
	async restoreFromHistory(): Promise<void> {
		try {
			const history = await this.store.readHistory();
			if (!history) return;

			const lines = history.split('\n');
			// 从后往前找最后一条里程碑
			for (let i = lines.length - 1; i >= 0; i--) {
				const line = lines[i].trim();
				// 匹配 📖 或 🔄 开头的记录
				if (line.startsWith('📖') || line.startsWith('🔄')) {
					// 提取书名：📖 开始阅读《xxx》 或 🔄 从《xxx》切换到《yyy》
					const switchMatch = line.match(/切换到《(.+?)》/);
					const startMatch = line.match(/开始阅读《(.+?)》/);

					if (switchMatch) {
						this.currentBook = switchMatch[1];
					} else if (startMatch) {
						this.currentBook = startMatch[1];
					}

					// 提取日期用于去重
					const dateMatch = line.match(/\[(\d{4}-\d{2}-\d{2})/);
					if (dateMatch) {
						this.lastRecordDate = dateMatch[1];
					}

					if (this.currentBook) {
						log(`[Milestone] 从 HISTORY.md 恢复: currentBook="${this.currentBook}", lastDate=${this.lastRecordDate}`);
					}
					return;
				}
			}
		} catch (err) {
			log('[Milestone] 恢复状态失败（非致命）:', err);
		}
	}

	/**
	 * 获取今天的日期字符串
	 */
	private getToday(): string {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
			this.lastRecordDate = this.getToday();
		} catch (err) {
			log('[Milestone] 记录失败:', err);
		}
	}

	/**
	 * 处理书籍切换
	 *
	 * 去重规则：
	 * - 同一本书同一天只记录一次"开始阅读"
	 * - 前后是不同书才记录"切换"
	 * - 启动时恢复状态后，同一本书不会重复触发
	 */
	async handleBookSwitch(newBook: string): Promise<boolean> {
		const today = this.getToday();

		// 同一本书、同一天 -> 不记录
		if (this.currentBook === newBook) {
			return false;
		}

		// 切换到不同书
		if (this.currentBook && this.currentBook !== newBook) {
			await this.recordMilestone('switch_book', {
				bookName: newBook,
				previousBook: this.currentBook,
			});
		} else {
			// currentBook 为 null（首次或重启后恢复失败）
			// 检查今天是否已经为这本书记录过
			if (this.lastRecordDate === today) {
				// 今天已有记录，跳过
				log(`[Milestone] 今日已记录，跳过: ${newBook}`);
			} else {
				await this.recordMilestone('start_reading', { bookName: newBook });
			}
		}

		this.currentBook = newBook;
		return true;
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
