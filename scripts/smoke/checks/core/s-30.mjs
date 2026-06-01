/**
 * S-30: PI 子进程
 *
 * 锚定: F-30 PI 子进程（持久 AI 进程）
 * 触发:  evalObsidian 验证 frontendAgent.piManager 实例
 * 断言:  piManager 存在 + process 状态可读
 * 失败信息:  piManager 状态详情
 *
 * 真实路径:  app.plugins.plugins['deepreader'].frontendAgent.piManager
 * (不是 app.plugins.plugins['deepreader'].piManager, 那个不存在)
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

export default {
	id: 'S-30',
	name: 'PI 子进程',
	level: 'core',
	feature: 'F-30',
	timeout: 5_000,

	async run({ log }) {
		const result = await evalObsidian(`(() => {
			const pm = app.plugins.plugins["deepreader"]?.frontendAgent?.piManager;
			if (!pm) return { exists: false };
			return {
				exists: true,
				hasProcess: !!pm.process,
				hasRpc: !!pm.rpcClient,
				busy: pm.busy,
				state: pm.state,
				hasHeartbeat: !!pm._heartbeatTimer,
			};
		})()`);

		if (!result?.exists) {
			throw new Error('piManager 不存在 (frontendAgent.piManager)');
		}

		log?.info?.(`✓ piManager 存在: hasProcess=${result.hasProcess}, hasRpc=${result.hasRpc}, state=${result.state}`);
		return result;
	},
};
