/**
 * S-26: 微信读书设置项
 *
 * 锚定: F-26 微信读书账号绑定
 * 触发:  evalObsidian 验证 weread 相关设置项
 * 断言:  wereadApiKey/wereadSyncInterval/wereadExcludeArticles 存在且类型正确
 *
 * 命令注册在 S-CMD 已覆盖，本测试补充验证设置项的可达性和类型。
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

const EXPECTED_SETTINGS = {
	wereadApiKey: 'string',
	wereadSyncInterval: 'number',
	wereadExcludeArticles: 'boolean',
	wereadNoteCountThreshold: 'number',
};

export default {
	id: 'S-26',
	name: '微信读书设置项',
	level: 'full',
	feature: 'F-26',
	timeout: 5_000,

	async run({ log }) {
		const keys = Object.keys(EXPECTED_SETTINGS);
		const result = await evalObsidian(`(() => {
			const s = app.plugins.plugins["deepreader"]?.settings;
			return ${JSON.stringify(keys)}.map(k => typeof s?.[k]);
		})()`);

		const wrong = [];
		for (let i = 0; i < keys.length; i++) {
			if (result[i] !== EXPECTED_SETTINGS[keys[i]]) {
				wrong.push(`${keys[i]}: 期望 ${EXPECTED_SETTINGS[keys[i]]}, 实际 ${result[i]}`);
			}
		}

		if (wrong.length > 0) {
			const err = new Error(`微信读书设置项类型不匹配: ${wrong.join('; ')}`);
			throw err;
		}

		log?.info?.(`✓ ${keys.length} 个 weread 设置项类型正确`);
		return { ok: true };
	},
};
