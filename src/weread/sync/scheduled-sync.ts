/**
 * 微信读书定时同步调度器
 *
 * 从 main.ts 抽离，避免主入口继续膨胀。
 */

import { Notice } from 'obsidian';
import { serviceLog as logger } from '../../utils/logger';
import { WereadService } from '../index';

export interface ScheduledSyncOptions {
	autoSync: boolean;
	intervalMinutes: number;
}

export class WereadScheduledSync {
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly service: WereadService,
		private readonly options: ScheduledSyncOptions,
	) {}

	start(): void {
		this.stop();

		if (!this.options.autoSync) {
			return;
		}

		if (!this.service.isLoggedIn()) {
			return;
		}

		const intervalMinutes = Math.max(1, this.options.intervalMinutes || 30);
		const intervalMs = intervalMinutes * 60 * 1000;

		logger.info(`[WereadScheduledSync] 设置定时同步，间隔 ${intervalMinutes} 分钟`);

		this.timer = setInterval(async () => {
			logger.info('[WereadScheduledSync] 执行定时同步');
			try {
				const result = await this.service.sync(false, {
					onNotice: (msg: string) => { new Notice(msg); },
				});
				logger.info(`[WereadScheduledSync] 定时同步完成：新增 ${result.added} 本，更新 ${result.updated} 本`);
			} catch (e) {
				logger.error('[WereadScheduledSync] 定时同步失败:', e);
			}
		}, intervalMs);
	}

	stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
			logger.info('[WereadScheduledSync] 已停止定时同步');
		}
	}

	restart(options?: ScheduledSyncOptions): void {
		if (options) {
			this.options.autoSync = options.autoSync;
			this.options.intervalMinutes = options.intervalMinutes;
		}
		this.start();
	}
}
