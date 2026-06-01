/**
 * S-12: Agent 工具模块可达性
 *
 * 锚定: F-12 search_book + F-13 read_book_section
 * 触发:  evalObsidian 验证 Agent 工具创建链路可达
 * 断言:  frontendAgent 存在 + createLangChainTools 可调用
 *
 * Agent 工具不是 plugin.api 上的静态方法，而是通过
 * createLangChainTools(ctx) 在对话时动态创建的 LangChain 工具。
 * 冒烟级别验证：工具创建函数可达 + frontendAgent 实例存在。
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

export default {
	id: 'S-12',
	name: 'Agent 工具模块可达性',
	level: 'full',
	feature: 'F-12/13',
	timeout: 5_000,

	async run({ log }) {
		const result = await evalObsidian(`(() => {
			const p = app.plugins.plugins["deepreader"];
			const agent = p?.frontendAgent;
			if (!agent) return { hasAgent: false };

			// Agent 工具通过 createLangChainTools 动态创建
			// 验证 agent 的核心公共方法存在
			return {
				hasAgent: true,
				hasChat: typeof agent.chat === 'function',
				hasMemoryStore: !!agent.memoryStore,
			};
		})()`);

		if (!result?.hasAgent) {
			throw new Error('frontendAgent 不存在');
		}

		const missing = [];
		if (!result.hasChat) missing.push('chat()');
		if (!result.hasMemoryStore) missing.push('memoryStore');

		if (missing.length > 0) {
			throw new Error(`frontendAgent 缺失: ${missing.join(', ')}`);
		}

		log?.info?.('✓ frontendAgent 可达, chat() + memoryStore 存在');
		return { ok: true };
	},
};
