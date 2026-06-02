/**
 * 轻量 E2E: 微信读书同步
 *
 * 对比: tests/e2e/specs/weread-sync.e2e.ts (105 行 WDIO)
 * 通过插件命令触发同步，轮询同步状态，验证同步结果
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const SYNC_TIMEOUT = 60_000;
const POLL_INTERVAL = 3_000;

// 在 vault 适配器中读取 sync-state.json 的辅助 eval（带 try/catch 单次容错）
function readSyncStateEval() {
	return `(() => {
		const adapter = app.vault.adapter;
		const pluginDir = '.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev']?.manifest?.id || 'deepreader');
		const syncPath = pluginDir + '/pageindex/weread/sync-state.json';
		return (async () => {
			const exists = await adapter.exists(syncPath);
			if (!exists) return { lastSyncTime: null, syncedBookCount: 0, exists: false };
			const raw = await adapter.read(syncPath);
			const state = JSON.parse(raw);
			return {
				lastSyncTime: state.lastSyncTime || null,
				syncedBookCount: Object.keys(state.syncedBooks || {}).length,
				exists: true,
			};
		})();
	})()`;
}

export default {
	id: 'weread-sync',
	name: '微信读书同步',
	feature: 'F-27',
	timeout: 300_000,
	requires: {
		settings: { wereadApiKey: true },
	},

	async run({ log }) {
		const steps = [];

		function pass(name, duration, detail) {
			steps.push({ name, status: 'pass', duration, detail });
			log?.info?.(`  ✓ ${name} (${duration}ms)${detail ? '  ' + detail : ''}`);
		}

		function fail(name, duration, error) {
			steps.push({ name, status: 'fail', duration, error: error.message });
		}

		// Step 1: 记录同步前状态
		let syncStateBefore;
		{
			const t0 = Date.now();
			try {
				syncStateBefore = await evalObsidian(readSyncStateEval(), { timeout: 10_000 });
				pass('同步前状态', Date.now() - t0, `lastSync=${syncStateBefore?.lastSyncTime}, books=${syncStateBefore?.syncedBookCount}`);
			} catch (e) {
				fail('同步前状态', Date.now() - t0, e);
				return { steps };
			}
		}

		// Step 2: 触发同步
		{
			const t0 = Date.now();
			try {
				await evalObsidian(`app.commands.executeCommandById("deepreader-dev:weread-sync")`);
				await new Promise(r => setTimeout(r, 2000));
				pass('触发同步', Date.now() - t0);
			} catch (e) {
				fail('触发同步', Date.now() - t0, e);
				return { steps };
			}
		}

		// Step 3: 轮询等待同步完成（lastSyncTime 更新或超时）
		let syncCompleted = false;
		{
			const t0 = Date.now();
			try {
				const deadline = Date.now() + SYNC_TIMEOUT;
				while (Date.now() < deadline) {
					try {
						const state = await evalObsidian(readSyncStateEval(), { timeout: 10_000 });

						if (state?.lastSyncTime && state.lastSyncTime !== syncStateBefore?.lastSyncTime) {
							syncCompleted = true;
							break;
						}
					} catch {
						// 单次轮询失败不终止
					}
					await new Promise(r => setTimeout(r, POLL_INTERVAL));
				}

				if (!syncCompleted) {
					throw new Error(`同步未在 ${SYNC_TIMEOUT / 1000}s 内完成 (lastSyncTime 未更新)`);
				}
				pass('同步完成', Date.now() - t0);
			} catch (e) {
				fail('同步完成', Date.now() - t0, e);
			}
		}

		// Step 4: 验证同步结果
		if (syncCompleted) {
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					const pluginDir = '.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev']?.manifest?.id || 'deepreader');
					const syncPath = pluginDir + '/pageindex/weread/sync-state.json';
					return (async () => {
						const stateRaw = await adapter.read(syncPath);
						const state = JSON.parse(stateRaw);
						const syncedCount = Object.keys(state.syncedBooks || {}).length;

						// 检查同步文件夹
						const paths = ['书籍摘录', 'DeepReader'];
						let foundPath = null;
						let fileCount = 0;
						for (const p of paths) {
							const exists = await adapter.exists(p);
							if (exists) {
								const listing = await adapter.list(p);
								foundPath = p;
								fileCount = listing?.files?.length ?? 0;
								break;
							}
						}

						return {
							syncedBookCount: syncedCount,
							foundPath,
							fileCount,
							lastSyncTime: state.lastSyncTime,
						};
					})();
				})()`, { timeout: 15_000 });

				if (!result) throw new Error('同步结果读取失败');

				// 断言：至少同步了 1 本书
				if (result.syncedBookCount < 1) {
					throw new Error(`syncedBookCount = ${result.syncedBookCount}，预期 ≥ 1`);
				}

				pass('同步结果', Date.now() - t0,
					`books=${result.syncedBookCount}, path=${result.foundPath || '(无)'}, files=${result.fileCount}`);
			} catch (e) {
				fail('同步结果', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
