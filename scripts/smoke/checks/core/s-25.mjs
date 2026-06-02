/**
 * S-25: Settings 面板
 *
 * 锚定: F-25 Settings 面板（双层 providers/roles）
 * 触发:  evalObsidian 调 app.setting.open() + openTabById('deepreader')，等渲染
 * 断言:  真实选择器 .deeppdf-settings-nav-item / .deeppdf-settings-content / .deeppdf-settings-card 至少存在
 * 失败信息:  当前含 deeppdf-settings- 前缀的 className
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';
import { countBySelector, listPrefixedClasses } from '../../lib/dom-query.mjs';

const SELECTORS = [
	'.deeppdf-settings-nav-item',
	'.deeppdf-settings-content',
	'.deeppdf-settings-card',
];

export default {
	id: 'S-25',
	name: 'Settings 面板',
	level: 'core',
	feature: 'F-25',
	timeout: 10_000,

	async run({ log }) {
		try {
			// 1. 打开 settings 面板 + 切到 DeepReader tab
			log?.info?.('正在打开 Settings 面板...');
			await evalObsidian(`
				(() => {
					app.setting.open();
					app.setting.openTabById('deepreader-dev');
					return true;
				})()
			`);

			// 2. 等渲染
			await new Promise(r => setTimeout(r, 2000));

			// 3. 验证关键元素
			const counts = await Promise.all(SELECTORS.map(s => countBySelector(s)));
			const missing = SELECTORS.filter((_, i) => counts[i] === 0);

			if (missing.length > 0) {
				const classes = await listPrefixedClasses('deeppdf-settings-');
				const err = new Error(`未匹配的选择器: ${missing.join(', ')}`);
				err.context = `当前含 deeppdf-settings- 前缀的 className:\n  ${classes.join('\n  ') || '(无)'}`;
				throw err;
			}

			const detail = SELECTORS.map((s, i) => `${s}=${counts[i]}`).join(' ');
			log?.info?.(`✓ ${detail}`);
			return { ok: true, counts: Object.fromEntries(SELECTORS.map((s, i) => [s, counts[i]])) };
		} finally {
			// 4. 关闭 settings，避免污染后续测试
			await evalObsidian('app.setting.close()').catch(() => {});
		}
	},
};
