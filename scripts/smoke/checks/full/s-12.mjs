/**
 * S-12: Agent 工具可达
 *
 * 锚定: F-12 search_book + F-13 read_book_section
 * 触发:  evalObsidian 验证 plugin.api 层
 * 断言:  api 存在 + 包含索引/解析基础设施（searchBook/readSection 在 PI 子进程中）
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

const REQUIRED_APIS = ['indexBook', 'parsePdf', 'parseEpub'];

export default {
	id: 'S-12',
	name: 'Agent 工具可达',
	level: 'full',
	feature: 'F-12/13',
	timeout: 5_000,

	async run({ log }) {
		const result = await evalObsidian(`(() => {
			const p = app.plugins.plugins["deepreader"];
			return {
				hasApi: typeof p?.api === 'object',
				apiKeys: Object.keys(p?.api || {}),
			};
		})()`);

		if (!result?.hasApi) {
			throw new Error('plugin.api 不存在');
		}

		const missing = REQUIRED_APIS.filter(k => !result.apiKeys.includes(k));
		if (missing.length > 0) {
			const err = new Error(`缺失 API 方法: ${missing.join(', ')}`);
			err.context = `当前 api 方法: ${result.apiKeys.join(', ')}`;
			throw err;
		}

		log?.info?.(`✓ api 存在, ${REQUIRED_APIS.length}/${result.apiKeys.length} 个核心方法就绪`);
		return { ok: true, apiCount: result.apiKeys.length };
	},
};
