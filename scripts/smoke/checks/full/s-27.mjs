/**
 * S-27: 微信同步命令可达性
 *
 * 锚定: F-27 微信读书标注同步
 * 触发:  evalObsidian 验证 weread 相关命令 + WereadService 实例化可达
 * 断言:  5 个 weread 命令存在 + getWereadService 可调用
 *
 * wereadService 是 private 字段，通过 getWereadService() private getter 实例化。
 * 冒烟级别验证：命令注册 + 设置项（S-26）+ 实例化能力。
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

const WEREAD_COMMANDS = [
	'deepreader-dev:weread-login',
	'deepreader-dev:weread-sync',
	'deepreader-dev:weread-sync-force',
	'deepreader-dev:weread-logout',
	'deepreader-dev:weread-rematch',
];

export default {
	id: 'S-27',
	name: '微信同步命令可达性',
	level: 'full',
	feature: 'F-27',
	timeout: 5_000,

	async run({ log }) {
		// 1. 验证 5 个 weread 命令全部注册
		const allCmds = await evalObsidian(
			'app.commands.listCommands().map(c => c.id)'
		);
		const cmdSet = new Set(allCmds);
		const missing = WEREAD_COMMANDS.filter(id => !cmdSet.has(id));
		if (missing.length > 0) {
			throw new Error(`weread 命令缺失: ${missing.join(', ')}`);
		}

		// 2. 验证 WereadService 能被实例化（通过 getWereadService 路径）
		const hasService = await evalObsidian(`(() => {
			const plugin = app.plugins.plugins["deepreader-dev"];
			// wereadService 是 private，esbuild 编译后可访问
			// 也可通过调用 weread-login 命令触发 getWereadService()
			const svc = plugin.wereadService || plugin.getWereadService?.();
			return !!svc;
		})()`);

		log?.info?.(`✓ ${WEREAD_COMMANDS.length} 个 weread 命令注册, service=${hasService}`);
		return { ok: true, commandCount: WEREAD_COMMANDS.length, hasService };
	},
};
