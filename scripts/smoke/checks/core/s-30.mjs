/**
 * S-30: PI 子进程
 *
 * 锚定: F-30 PI 子进程（持久 AI 进程）
 * 触发:  evalObsidian 验证 piManager 实例存在 + 公共方法可达
 * 断言:  piManager 存在 + getState()/isReady() 可调用
 * 失败信息:  piManager 状态详情
 *
 * 真实路径:  app.plugins.plugins['deepreader-dev'].frontendAgent.piManager
 * 注意: piManager 和其内部属性都是 private，只使用公共 getter 方法
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
			const pm = app.plugins.plugins["deepreader-dev"]?.frontendAgent?.piManager;
			if (!pm) return { exists: false };

			// 只使用公共 API，不访问 private 字段
			return {
				exists: true,
				state: typeof pm.getState === 'function' ? pm.getState() : 'no-getState',
				ready: typeof pm.isReady === 'function' ? pm.isReady() : 'no-isReady',
				busy: typeof pm.isBusy === 'function' ? pm.isBusy() : 'no-isBusy',
			};
		})()`);

		if (!result?.exists) {
			throw new Error('piManager 不存在 (frontendAgent.piManager)');
		}

		// 验证公共方法存在且可调用
		if (result.state === 'no-getState') {
			throw new Error('piManager.getState() 方法不存在');
		}

		log?.info?.(`✓ piManager: state=${result.state}, ready=${result.ready}, busy=${result.busy}`);
		return result;
	},
};
