/**
 * S-22: Sidebar 聊天界面
 *
 * 锚定: F-22 Sidebar 聊天界面
 * 触发:  evalObsidian 直接数 DOM 元素（plugin 已加载，sidebar 视图在 DOM）
 * 断言:  3 个关键 class 各 ≥ 1
 * 失败信息:  哪个选择器未匹配 + 当前含 deeppdf- 前缀的 className 列表
 */

import { countBySelector, listPrefixedClasses } from '../../lib/dom-query.mjs';

const SELECTORS = [
	'.deeppdf-topbar-action-btn',
	'.deeppdf-chat-input-textarea',
	'.deeppdf-message-list',
];

export default {
	id: 'S-22',
	name: 'Sidebar 聊天界面',
	level: 'core',
	feature: 'F-22',
	timeout: 5_000,

	async run({ log }) {
		const counts = await Promise.all(SELECTORS.map(s => countBySelector(s)));
		const missing = SELECTORS.filter((_, i) => counts[i] === 0);

		if (missing.length > 0) {
			const classes = await listPrefixedClasses('deeppdf-');
			const err = new Error(`未匹配的选择器: ${missing.join(', ')}`);
			err.context = `当前含 deeppdf- 前缀的 className (前 20 个): ${classes.join(', ')}`;
			throw err;
		}

		const detail = SELECTORS.map((s, i) => `${s}=${counts[i]}`).join(' ');
		log?.info?.(`✓ ${detail}`);
		return { ok: true, counts: Object.fromEntries(SELECTORS.map((s, i) => [s, counts[i]])) };
	},
};
