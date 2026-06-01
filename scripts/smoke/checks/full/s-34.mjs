/**
 * S-34: LangSmith 设置项
 *
 * 锚定: F-34 LangSmith 追踪
 * 触发:  evalObsidian 验证 settings 中 LangSmith 相关字段
 * 断言:  langsmithApiKey / langsmithProject / langsmithEnabled 存在且类型正确
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

const EXPECTED_FIELDS = ['langsmithApiKey', 'langsmithProject', 'langsmithEnabled'];

export default {
	id: 'S-34',
	name: 'LangSmith 设置项',
	level: 'full',
	feature: 'F-34',
	timeout: 5_000,

	async run({ log }) {
		const result = await evalObsidian(`(() => {
			const s = app.plugins.plugins["deepreader"]?.settings;
			if (!s) return null;
			return {
				apiKey: typeof s.langsmithApiKey,
				project: typeof s.langsmithProject,
				enabled: typeof s.langsmithEnabled,
			};
		})()`);

		if (!result) {
			throw new Error('settings 不可读');
		}

		const issues = [];
		if (result.apiKey !== 'string') issues.push(`apiKey=${result.apiKey}`);
		if (result.project !== 'string') issues.push(`project=${result.project}`);
		if (result.enabled !== 'boolean') issues.push(`enabled=${result.enabled}`);

		if (issues.length > 0) {
			throw new Error(`LangSmith 字段类型异常: ${issues.join(', ')}`);
		}

		log?.info?.('✓ LangSmith 设置项存在 (apiKey=string, project=string, enabled=boolean)');
		return { ok: true, ...result };
	},
};
