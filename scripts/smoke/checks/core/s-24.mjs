/**
 * S-24: Quick Setup
 *
 * 锚定: F-24 Quick Setup 向导
 * 触发:  evalObsidian 调 executeCommandById('deepreader:open-quick-setup')，等渲染
 * 断言:  .modal ≥ 1 + input[type="password"] ≥ 1（API Key 输入框）
 * 失败信息:  当前含 deeppdf- 前缀的 className
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';
import { countBySelector, listPrefixedClasses } from '../../lib/dom-query.mjs';

const SELECTORS = [
	'.modal',
	'.modal-content',
	'input[type="password"]',
	'.deeppdf-quick-setup',
];

export default {
	id: 'S-24',
	name: 'Quick Setup',
	level: 'core',
	feature: 'F-24',
	timeout: 5_000,

	async run({ log }) {
		try {
			log?.info?.('正在触发 Quick Setup 命令...');
			await evalObsidian('app.commands.executeCommandById("deepreader:open-quick-setup")');

			// 等 modal 渲染
			await new Promise(r => setTimeout(r, 500));

			const counts = await Promise.all(SELECTORS.map(s => countBySelector(s)));

			// 关键断言：modal 出现 + 至少 1 个 password 输入框
			if (counts[0] === 0 || counts[2] === 0) {
				const classes = await listPrefixedClasses('deeppdf-quick-setup');
				const err = new Error(
					`Quick Setup modal 未完整渲染: .modal=${counts[0]}, input[type=password]=${counts[2]}`
				);
				err.context = `当前含 deeppdf-quick-setup 前缀的 className:\n  ${classes.join('\n  ') || '(无)'}`;
				throw err;
			}

			const detail = SELECTORS.map((s, i) => `${s}=${counts[i]}`).join(' ');
			log?.info?.(`✓ ${detail}`);
			return { ok: true, counts: Object.fromEntries(SELECTORS.map((s, i) => [s, counts[i]])) };
		} finally {
			// 关闭 modal，避免污染后续测试
			await evalObsidian('document.querySelector(".modal-close-button")?.click()').catch(() => {});
		}
	},
};
