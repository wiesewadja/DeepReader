/**
 * S-32: 画像数据
 *
 * 锚定: F-32 用户画像 + 长期记忆
 * 触发:  evalObsidian 验证 frontendAgent.memoryStore 存在
 * 断言:  typeof === 'object'
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

export default {
	id: 'S-32',
	name: '画像数据',
	level: 'full',
	feature: 'F-32',
	timeout: 5_000,

	async run({ log }) {
		const type = await evalObsidian(
			'typeof app.plugins.plugins["deepreader"]?.frontendAgent?.memoryStore'
		);

		if (type !== 'object') {
			throw new Error(`memoryStore 类型为 ${type}，期望 object`);
		}

		log?.info?.('✓ memoryStore 存在');
		return { ok: true, type };
	},
};
