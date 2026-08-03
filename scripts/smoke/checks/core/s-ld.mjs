/**
 * S-LD: 插件加载与完整性检查
 *
 * 锚定: 所有 feature 的前置条件
 * 触发:  obsidian-cli plugin id=deepreader (验证 plugin 已加载并启用)
 * 断言:  type=community, enabled=true, 命令注册完整, API 方法完整
 * 失败信息:  plugin 命令完整输出
 *
 * 整合自 tests/e2e-cli/specs/plugin-health.mjs
 */

import { exec, evalObsidian } from '../../lib/obsidian-cli.mjs';

const PLUGIN_ID = 'deepreader-dev';

const EXPECTED_COMMANDS = [
	'open-deepreader-sidebar',
	'open-library',
	'debug-send-message',
	'open-quick-setup',
	'test-pageindex',
	'dump-system-prompt',
];

const EXPECTED_API_METHODS = [
	'indexBook',
	'isBookIndexed',
	'deleteBookIndex',
	'generateBookId',
	'parsePdf',
	'parseEpub',
	'exportToObsidian',
	'PageIndex',
];

export default {
	id: 'S-LD',
	name: '插件加载与完整性',
	level: 'core',
	feature: null,
	timeout: 15_000,

	async run({ log }) {
		const steps = [];
		const step = async (name, fn) => {
			const start = Date.now();
			try {
				const detail = await fn();
				steps.push({ name, status: 'pass', duration: Date.now() - start, detail: detail || '' });
			} catch (e) {
				steps.push({ name, status: 'fail', duration: Date.now() - start, error: e.message });
				throw e;
			}
		};

		// 1. 插件已加载且启用
		await step('插件已加载', async () => {
			const r = await exec('plugin', ['id=deepreader-dev'], { vault: 'test-vault' });
			if (r.code !== 0) {
				throw new Error(`plugin 命令失败: ${r.stderr || r.stdout}`);
			}

			const output = r.stdout;
			const enabled = /enabled\s+true/.test(output);
			const type = /type\s+(\S+)/.exec(output)?.[1];
			const version = /version\s+(\S+)/.exec(output)?.[1];

			if (!enabled) {
				throw new Error('plugin 未启用');
			}
			if (type !== 'community') {
				throw new Error(`plugin 类型错误: ${type} (期望 community)`);
			}

			return `v${version || '?'}, type=${type}`;
		});

		// 2. 命令注册完整
		await step('命令注册完整', async () => {
			const allCommands = await evalObsidian(`
				app.commands.listCommands()
					.filter(c => c.id.startsWith('${PLUGIN_ID}:'))
					.map(c => c.id.replace('${PLUGIN_ID}:', ''))
			`);
			const missing = EXPECTED_COMMANDS.filter(c => !allCommands.includes(c));
			if (missing.length > 0) throw new Error(`缺失命令: ${missing.join(', ')}`);
			return `${allCommands.length} 个命令`;
		});

		// 3. API 方法完整
		await step('API 方法完整', async () => {
			const available = await evalObsidian(`
				Object.keys(app.plugins.plugins['${PLUGIN_ID}']?.api || {})
			`);
			const missing = EXPECTED_API_METHODS.filter(m => !available.includes(m));
			if (missing.length > 0) throw new Error(`缺失 API: ${missing.join(', ')}`);
			return `${available.length} 个 API`;
		});

		// 4. manifest.id 正确
		await step('manifest.id 正确', async () => {
			const id = await evalObsidian(`app.plugins.plugins['${PLUGIN_ID}']?.manifest?.id`);
			if (id !== PLUGIN_ID) throw new Error(`manifest.id=${id}, 期望=${PLUGIN_ID}`);
		});

		log?.info?.(`✓ 插件加载与完整性检查通过`);
		return { ok: true, steps };
	},
};
