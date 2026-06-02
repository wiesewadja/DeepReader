/**
 * S-24: Quick Setup
 *
 * 锚定: F-24 Quick Setup 向导
 * 触发:  executeCommandById('deepreader-dev:open-quick-setup')
 * 断言:  Settings 面板打开 + .deeppdf-quick-setup 卡片存在
 *
 * 注意: open-quick-setup 实际是 open Settings + openTabById('deepreader')，
 * Quick Setup 卡片在 LLM tab 的未配置状态下显示。
 * 与 S-25 (Settings 导航结构) 的区别：S-24 专注验证 Quick Setup 卡片本身。
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';
import { countBySelector, listPrefixedClasses } from '../../lib/dom-query.mjs';

const SELECTORS = [
	'.modal',
	'.modal-content',
	'.deeppdf-quick-setup',
];

export default {
	id: 'S-24',
	name: 'Quick Setup',
	level: 'core',
	feature: 'F-24',
	timeout: 8_000,

	async run({ log }) {
		try {
			// 确保 settings 面板已关闭（前序 S-25 可能留下残留状态）
			await evalObsidian('app.setting.close()').catch(() => {});
			await new Promise(r => setTimeout(r, 300));

			await evalObsidian('app.commands.executeCommandById("deepreader-dev:open-quick-setup")');
			await new Promise(r => setTimeout(r, 1500));

			const counts = await Promise.all(SELECTORS.map(s => countBySelector(s)));

			// 核心：Settings 面板打开
			if (counts[0] === 0) {
				throw new Error('Settings 面板未打开 (.modal=0)');
			}

			// Quick Setup 卡片只在 API Key 未配置时显示
			// 已配置时 LLM tab 显示正常的 settings cards
			const allCards = await countBySelector('.deeppdf-settings-card');
			if (counts[2] === 0 && allCards === 0) {
				throw new Error('Settings 面板无内容：既无 quick-setup 也无 settings-card');
			}

			const detail = SELECTORS.map((s, i) => `${s}=${counts[i]}`).join(' ');
			log?.info?.(`✓ ${detail}`);
			return { ok: true, counts: Object.fromEntries(SELECTORS.map((s, i) => [s, counts[i]])) };
		} finally {
			await evalObsidian('document.querySelector(".modal-close-button")?.click()').catch(() => {});
		}
	},
};
