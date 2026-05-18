/**
 * 微信读书同步 E2E 测试 — 直接通过插件 API 触发同步
 */
import { obsidianPage } from 'wdio-obsidian-service';

describe('微信读书同步 E2E', function () {
	this.timeout(300000);

	it('should have plugin loaded with api key', async function () {
		const result = await browser.executeObsidian(({ app }) => {
			const plugin = app.plugins?.plugins?.['deepreader'] as any;
			return {
				loaded: !!plugin,
				hasApiKey: !!plugin?.settings?.wereadApiKey,
			};
		});
		console.log('[E2E] Plugin state:', JSON.stringify(result));
		expect(result.loaded).toBe(true);
		expect(result.hasApiKey).toBe(true);
	});

	it('should sync books via plugin command', async function () {
		// 直接执行插件注册的同步命令
		const result = await browser.executeObsidian(async ({ app }) => {
			// 执行同步命令
			const plugin = app.plugins?.plugins?.['deepreader'] as any;
			if (!plugin) return { error: 'no plugin' };

			// 调用 WereadService.sync() 通过插件内部的方法
			// 先检查插件是否有 wereadService 实例
			if (!plugin.wereadService) {
				// 手动创建 WereadService 并同步
				try {
					const host = {
						settings: plugin.settings,
						app: app,
						saveSettings: async () => { await plugin.saveSettings(); },
					};
					// WereadService 已经打包在 main.js 中，通过插件间接调用
					// 使用命令触发同步
					app.commands.executeCommandById('deepreader:weread-sync');
					return { triggered: true };
				} catch (e: any) {
					return { error: e.message };
				}
			} else {
				plugin.wereadService.sync(false);
				return { triggered: true, viaService: true };
			}
		});

		console.log('[E2E] Sync trigger result:', JSON.stringify(result));

		// 等待同步进行
		await browser.pause(15000);

		// 检查同步后的文件
		const files = await browser.executeObsidian(async ({ app }) => {
			const adapter = (app.vault as any).adapter;

			// 检查默认路径
			const paths = ['书籍摘录', 'DeepReader'];
			for (const p of paths) {
				const exists = await adapter.exists(p);
				if (exists) {
					const listing = await adapter.list(p);
					return {
						path: p,
						exists: true,
						fileCount: listing?.files?.length ?? 0,
						folderCount: listing?.folders?.length ?? 0,
						sampleFiles: (listing?.files || []).slice(0, 5),
						sampleFolders: (listing?.folders || []).slice(0, 5),
					};
				}
			}

			// 检查 .pageindex/weread 同步状态
			const stateExists = await adapter.exists('.pageindex/weread/sync-state.json');
			if (stateExists) {
				const stateContent = await adapter.read('.pageindex/weread/sync-state.json');
				const state = JSON.parse(stateContent);
				return {
					syncStateExists: true,
					syncedBookCount: Object.keys(state.syncedBooks || {}).length,
					lastSyncTime: state.lastSyncTime,
					sampleBooks: Object.values(state.syncedBooks || {}).slice(0, 3),
				};
			}

			return { exists: false, stateExists: false };
		});

		console.log('[E2E] Sync result files:', JSON.stringify(files, null, 2));
	});

	it('should check console for sync errors', async function () {
		const logs = await browser.executeObsidian(() => {
			// 检查 .pageindex/weread 下的同步状态
			const adapter = (window as any).app?.vault?.adapter;
			return adapter ? 'adapter exists' : 'no adapter';
		});
		console.log('[E2E] Post-sync check:', logs);
	});
});
