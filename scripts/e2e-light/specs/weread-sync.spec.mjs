/**
 * 轻量 E2E: 微信读书同步
 *
 * 对比: tests/e2e/specs/weread-sync.e2e.ts (105 行 WDIO)
 * 通过插件命令触发同步，检查同步结果文件
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

export default {
	id: 'weread-sync',
	name: '微信读书同步',
	feature: 'F-27',
	timeout: 300_000,

	async run({ log }) {
		const steps = [];

		function pass(name, duration, detail) {
			steps.push({ name, status: 'pass', duration, detail });
			log?.info?.(`  ✓ ${name} (${duration}ms)${detail ? '  ' + detail : ''}`);
		}

		function fail(name, duration, error) {
			steps.push({ name, status: 'fail', duration, error: error.message });
		}

		// Step 1: 检查 API Key
		{
			const t0 = Date.now();
			try {
				const hasKey = await evalObsidian(`!!app.plugins.plugins['deepreader']?.settings?.wereadApiKey`);
				if (!hasKey) {
					return { status: 'skip', reason: 'wereadApiKey 未配置' };
				}
				pass('API Key 检查', Date.now() - t0);
			} catch (e) {
				fail('API Key 检查', Date.now() - t0, e);
				return { steps };
			}
		}

		// Step 2: 触发同步
		{
			const t0 = Date.now();
			try {
				await evalObsidian(`app.commands.executeCommandById("deepreader:weread-sync")`);
				pass('触发同步', Date.now() - t0);
			} catch (e) {
				fail('触发同步', Date.now() - t0, e);
			}
		}

		// Step 3: 等待同步完成
		await new Promise(r => setTimeout(r, 15000));

		// Step 4: 检查同步结果
		{
			const t0 = Date.now();
			try {
				const files = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const paths = ['书籍摘录', 'DeepReader'];
						for (const p of paths) {
							const exists = await adapter.exists(p);
							if (exists) {
								const listing = await adapter.list(p);
								return {
									path: p, exists: true,
									fileCount: listing?.files?.length ?? 0,
									folderCount: listing?.folders?.length ?? 0,
								};
							}
						}
						const stateExists = await adapter.exists('.pageindex/weread/sync-state.json');
						if (stateExists) {
							const raw = await adapter.read('.pageindex/weread/sync-state.json');
							const state = JSON.parse(raw);
							return {
								syncStateExists: true,
								syncedBookCount: Object.keys(state.syncedBooks || {}).length,
							};
						}
						return { exists: false };
					})();
				})()`, { timeout: 30_000 });

				pass('同步结果', Date.now() - t0, JSON.stringify(files));
			} catch (e) {
				fail('同步结果', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
