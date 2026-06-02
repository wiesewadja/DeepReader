/**
 * S-04: 索引导出模块
 *
 * 锚定: F-04 索引导出为 Obsidian 笔记
 * 触发:  evalObsidian 验证 api.exportToObsidian
 * 断言:  typeof === 'function'
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

export default {
	id: 'S-04',
	name: '索引导出模块',
	level: 'full',
	feature: 'F-04',
	timeout: 5_000,

	async run({ log }) {
		const type = await evalObsidian(
			'typeof app.plugins.plugins["deepreader-dev"]?.api?.exportToObsidian'
		);

		if (type !== 'function') {
			throw new Error(`api.exportToObsidian 类型为 ${type}，期望 function`);
		}

		log?.info?.('✓ api.exportToObsidian 是 function');
		return { ok: true, type };
	},
};
