/**
 * S-23: Library 书库
 *
 * 锚定: F-23 Library 书库管理
 * 触发:  evalObsidian 数 DOM 元素
 * 断言:  .deeppdf-library-view 存在
 * 失败信息:  当前 Library 相关 className 列表
 */

import { countBySelector, listPrefixedClasses } from '../../lib/dom-query.mjs';

const SELECTORS = [
	'.deeppdf-library-view',
	'.deeppdf-library-item',     // 列表项（库里有书时）
	'.deeppdf-add-book-btn',     // 添加按钮
];

export default {
	id: 'S-23',
	name: 'Library 书库',
	level: 'core',
	feature: 'F-23',
	timeout: 5_000,

	async run({ log }) {
		const counts = await Promise.all(SELECTORS.map(s => countBySelector(s)));
		// 至少 library-view 容器必须存在；item 和 add-book 是 nice-to-have
		if (counts[0] === 0) {
			const classes = await listPrefixedClasses('deeppdf-library-');
			const err = new Error('.deeppdf-library-view 容器未找到');
			err.context = `当前含 deeppdf-library- 前缀的 className: ${classes.join(', ') || '(无)'}`;
			throw err;
		}

		const detail = SELECTORS.map((s, i) => `${s}=${counts[i]}`).join(' ');
		log?.info?.(`✓ ${detail}`);
		return { ok: true, counts: Object.fromEntries(SELECTORS.map((s, i) => [s, counts[i]])) };
	},
};
