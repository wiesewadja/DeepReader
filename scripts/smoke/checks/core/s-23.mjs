/**
 * S-23: Library 书库
 *
 * 锚定: F-23 Library 书库管理
 * 触发:  executeCommandById("deepreader:open-library") → 等 DOM 渲染
 * 断言:  .deeppdf-library-view 容器存在
 * 失败信息:  当前 Library 相关 className 列表
 *
 * 真实选择器 (2026-06-01 源码实证, src/views/library-view.ts):
 *   - .deeppdf-library-view  (容器, line 128)
 *   - .deeppdf-lib-grid      (卡片网格, line 236)
 *   - .deeppdf-lib-add-btn   (添加按钮, line 211)
 *   - .deeppdf-lib-header    (头部, line 192)
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';
import { countBySelector, listPrefixedClasses } from '../../lib/dom-query.mjs';

const SELECTORS = [
	'.deeppdf-library-view',
	'.deeppdf-lib-grid',
	'.deeppdf-lib-add-btn',
];

export default {
	id: 'S-23',
	name: 'Library 书库',
	level: 'core',
	feature: 'F-23',
	timeout: 8_000,

	async run({ log }) {
		// 1. 先打开 Library 视图
		await evalObsidian('app.commands.executeCommandById("deepreader:open-library")');
		await new Promise(r => setTimeout(r, 1000));

		// 2. 检查 DOM
		const counts = await Promise.all(SELECTORS.map(s => countBySelector(s)));
		if (counts[0] === 0) {
			const classes = await listPrefixedClasses('deeppdf-lib-');
			const err = new Error('.deeppdf-library-view 容器未找到');
			err.context = `当前含 deeppdf-lib- 前缀的 className: ${classes.join(', ') || '(无)'}`;
			throw err;
		}

		const detail = SELECTORS.map((s, i) => `${s}=${counts[i]}`).join(' ');
		log?.info?.(`✓ ${detail}`);
		return { ok: true, counts: Object.fromEntries(SELECTORS.map((s, i) => [s, counts[i]])) };
	},
};
