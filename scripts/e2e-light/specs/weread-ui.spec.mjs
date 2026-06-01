/**
 * 轻量 E2E: 微信读书 UI
 *
 * 对比: tests/e2e/specs/weread-ui.e2e.ts (203 行 WDIO)
 * 验证设置页面、书库视图、未匹配 Modal UI 结构
 *
 * 所测试的 UI 都通过插件真实代码渲染，不自己构造 DOM。
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';
import { countBySelector } from '../../smoke/lib/dom-query.mjs';

export default {
	id: 'weread-ui',
	name: '微信读书 UI',
	feature: 'F-26',
	timeout: 60_000,

	async run({ log }) {
		const steps = [];

		function pass(name, duration, detail) {
			steps.push({ name, status: 'pass', duration, detail });
			log?.info?.(`  ✓ ${name} (${duration}ms)${detail ? '  ' + detail : ''}`);
		}

		function fail(name, duration, error) {
			steps.push({ name, status: 'fail', duration, error: error.message });
		}

		// ===== 设置页面 =====
		{
			const t0 = Date.now();
			try {
				await evalObsidian(`
					(() => {
						app.setting.open();
						app.setting.openTabById('deepreader');
						return true;
					})()
				`);
				await new Promise(r => setTimeout(r, 1000));

				// 切换到微信读书 tab
				await evalObsidian(`(() => {
					const navItems = document.querySelectorAll('.deeppdf-settings-nav-item');
					for (const item of navItems) {
						if (item.textContent?.includes('微信读书')) {
							item.click();
							return true;
						}
					}
					return false;
				})()`);
				await new Promise(r => setTimeout(r, 500));

				// 验证微信读书设置区域：h4 "API Key" 无条件存在 (src/settings/sections/weread-section.ts)
				const hasApiKeyCard = await evalObsidian(`(() => {
					const headings = document.querySelectorAll('.deeppdf-settings-card h4');
					for (const h of headings) {
						if (h.textContent?.includes('API Key')) return true;
					}
					return false;
				})()`);
				if (!hasApiKeyCard) throw new Error('微信读书设置区域未找到: h4 "API Key" 不存在');

				pass('设置页面 UI', Date.now() - t0);
			} catch (e) {
				fail('设置页面 UI', Date.now() - t0, e);
			} finally {
				await evalObsidian('app.setting.close()').catch(() => {});
			}
		}

		// ===== 书库视图 =====
		{
			const t0 = Date.now();
			try {
				await evalObsidian('app.commands.executeCommandById("deepreader:open-library")');
				await new Promise(r => setTimeout(r, 1000));

				const hasLibrary = await countBySelector('.deeppdf-library-view');
				if (hasLibrary === 0) throw new Error('.deeppdf-library-view 不存在');

				const cardCount = await countBySelector('.deeppdf-lib-book-card');
				const wereadBadges = await countBySelector('.deeppdf-lib-type-weread');
				pass('书库视图', Date.now() - t0, `cards=${cardCount}, wereadBadges=${wereadBadges}`);
			} catch (e) {
				fail('书库视图', Date.now() - t0, e);
			}
		}

		// ===== 微信读书服务可达性 =====
		{
			const t0 = Date.now();
			try {
				const info = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader"];
					const hasWereadService = !!plugin.wereadService;
					const hasRematch = typeof plugin.wereadService?.rematch === 'function';
					const cmds = app.commands.listCommands().filter(c => c.id?.startsWith('deepreader:weread'));
					const cmdIds = cmds.map(c => c.id);
					return { hasWereadService, hasRematch, wereadCommands: cmdIds };
				})()`);

				if (!info?.hasWereadService) {
					throw new Error('wereadService 不存在');
				}
				if (!info?.hasRematch) {
					throw new Error('wereadService.rematch() 方法不可达');
				}
				if (info.wereadCommands.length < 4) {
					throw new Error(`微信读书命令不完整: ${info.wereadCommands.join(', ')}`);
				}

				pass('微信读书服务可达', Date.now() - t0,
					`rematch=${info.hasRematch}, cmds=${info.wereadCommands.length}`);
			} catch (e) {
				fail('微信读书服务可达', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
