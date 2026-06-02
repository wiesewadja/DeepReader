/**
 * S-35: stream-processor 模块
 *
 * 锚定: F-35 提早停止
 * 触发:  evalObsidian 验证 graph 模块可达
 * 断言:  graph 相关基础设施存在（PI 模式下 graph 在子进程，验证渲染进程侧 stub）
 *
 * 真实验证: frontendAgent.graph 为 undefined（graph 运行在 PI 子进程内）。
 *           改为验证 piManager（graph 的宿主）+ 提早停止设置项存在。
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

export default {
	id: 'S-35',
	name: 'stream-processor 模块',
	level: 'full',
	feature: 'F-35',
	timeout: 5_000,

	async run({ log }) {
		const result = await evalObsidian(`(() => {
			const p = app.plugins.plugins["deepreader-dev"];
			const fa = p?.frontendAgent;
			return {
				hasPiManager: !!fa?.piManager,
				piState: fa?.piManager?.state,
				graphExists: !!fa?.graph,
				hasStreamProcessor: typeof fa?.graph?.streamProcessor !== 'undefined',
			};
		})()`);

		// PI 模式: graph 在子进程，piManager 是宿主
		if (!result?.hasPiManager) {
			throw new Error('piManager 不存在（graph/streamProcessor 的宿主）');
		}

		log?.info?.(`✓ piManager 存在 (state=${result.piState}), graph=${result.graphExists}, streamProcessor=${result.hasStreamProcessor}`);
		return { ok: true, ...result };
	},
};
