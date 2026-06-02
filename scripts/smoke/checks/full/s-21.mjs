/**
 * S-21: 摘录服务
 *
 * 锚定: F-21 摘录按书籍/日期组织
 * 触发:  evalObsidian 验证 highlightService 存在
 * 断言:  typeof === 'object'
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

export default {
	id: 'S-21',
	name: '摘录服务',
	level: 'full',
	feature: 'F-21',
	timeout: 5_000,

	async run({ log }) {
		const type = await evalObsidian(
			'typeof app.plugins.plugins["deepreader-dev"]?.highlightService'
		);

		if (type !== 'object') {
			throw new Error(`highlightService 类型为 ${type}，期望 object`);
		}

		log?.info?.('✓ highlightService 存在');
		return { ok: true, type };
	},
};
