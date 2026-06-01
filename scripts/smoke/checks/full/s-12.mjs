/**
 * S-12: Agent 工具可达
 *
 * 锚定: F-12 search_book + F-13 read_book_section
 * 触发:  evalObsidian 验证 Agent 搜索/阅读工具在渲染进程可达
 * 断言:  plugin.api 包含 searchBook + readSection
 *
 * 设计意图: F-12/F-13 要求用户能通过 Agent 搜索和阅读书籍内容。
 * 如果这两个工具不在 plugin.api 中暴露，说明工具注册链路有断点。
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

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
				hasTools: typeof p?.frontendAgent?.tools === 'object',
				toolKeys: Object.keys(p?.frontendAgent?.tools || {}),
			};
		})()`);

		if (!result?.hasApi) {
			throw new Error('plugin.api 不存在');
		}

		// F-12/F-13 核心断言：搜索和阅读工具必须可达
		const missing = [];
		if (!result.apiKeys.includes('searchBook')) missing.push('searchBook');
		if (!result.apiKeys.includes('readSection')) missing.push('readSection');

		if (missing.length > 0) {
			const err = new Error(`缺失 API 方法: ${missing.join(', ')}（F-12/F-13 工具未暴露到 plugin.api）`);
			err.context = `api 方法: ${result.apiKeys.join(', ')}\nfrontendAgent.tools: ${result.toolKeys.join(', ') || '(空)'}`;
			throw err;
		}

		log?.info?.(`✓ searchBook + readSection 均在 plugin.api 中暴露`);
		return { ok: true, apiCount: result.apiKeys.length };
	},
};
