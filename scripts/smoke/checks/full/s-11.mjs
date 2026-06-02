/**
 * S-11: 主动引导引擎
 *
 * 锚定: F-11 主动阅读引导
 * 触发:  evalObsidian 验证 settings.proactiveGuidanceEnabled 存在
 * 断言:  proactiveGuidanceEnabled 属性可读（boolean）
 *
 * 真实验证: frontendAgent 没有 proactiveEngine 属性（undefined），
 *           但 settings.proactiveGuidanceEnabled = true。
 *           引擎运行时由 piManager 或 graph 驱动，不在 frontendAgent 顶层。
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

export default {
	id: 'S-11',
	name: '主动引导引擎',
	level: 'full',
	feature: 'F-11',
	timeout: 5_000,

	async run({ log }) {
		const result = await evalObsidian(`(() => {
			const s = app.plugins.plugins["deepreader-dev"]?.settings;
			return {
				enabled: s?.proactiveGuidanceEnabled,
				cooldown: s?.proactiveCooldownMinutes,
			};
		})()`);

		if (typeof result?.enabled !== 'boolean') {
			throw new Error(`proactiveGuidanceEnabled 不可读: ${JSON.stringify(result)}`);
		}

		log?.info?.(`✓ proactiveGuidanceEnabled=${result.enabled}, cooldown=${result.cooldown}min`);
		return { ok: true, enabled: result.enabled, cooldown: result.cooldown };
	},
};
