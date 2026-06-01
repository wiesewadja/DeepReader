/**
 * S-LD: 插件加载
 *
 * 锚定: 所有 feature 的前置条件
 * 触发:  obsidian-cli plugin id=deepreader (验证 plugin 已加载并启用)
 * 断言:  type=community, enabled=true
 * 失败信息:  plugin 命令完整输出
 *
 * 备注:  obsidian-cli 没有 plugin:reload 子命令（只有 plugin:enable/disable）。
 *        本 check 验证 plugin **当前** 已加载且启用，不做"重载"。
 *        真重载验证归 E2E。
 */

import { exec } from '../../lib/obsidian-cli.mjs';

export default {
	id: 'S-LD',
	name: '插件加载',
	level: 'core',
	feature: null,
	timeout: 5_000,

	async run({ log }) {
		const r = await exec('plugin', ['id=deepreader']);
		if (r.code !== 0) {
			throw new Error(`plugin 命令失败: ${r.stderr || r.stdout}`);
		}

		const output = r.stdout;
		const enabled = /enabled\s+true/.test(output);
		const type = /type\s+(\S+)/.exec(output)?.[1];
		const version = /version\s+(\S+)/.exec(output)?.[1];

		if (!enabled) {
			const err = new Error('plugin 未启用');
			err.context = output;
			throw err;
		}
		if (type !== 'community') {
			const err = new Error(`plugin 类型错误: ${type} (期望 community)`);
			err.context = output;
			throw err;
		}

		log?.info?.(`✓ type=${type}, enabled=${enabled}, version=${version}`);
		return { ok: true, type, enabled, version };
	},
};
