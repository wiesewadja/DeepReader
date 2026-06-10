/**
 * Plugin Health — 插件加载与 API 完整性检查
 *
 * 验证：插件注册、命令列表、API 暴露、设置完整性
 */

import { evaluate, command, getSettings } from '../lib/cli-client.mjs';
import { PLUGIN_ID } from '../../lib/constants.mjs';

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

const spec = {
	id: 'plugin-health',
	name: '插件加载与 API 完整性',
	timeout: 15_000,

	async run() {
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

		await step('插件已加载', async () => {
			const loaded = await evaluate(`!!app.plugins?.plugins?.[${JSON.stringify(PLUGIN_ID)}]`);
			if (!loaded) throw new Error('插件未加载');
			const version = await evaluate(`app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.manifest?.version`);
			return `v${version || '?'}`;
		});

		await step('命令注册完整', async () => {
			const allCommands = await evaluate(`
				app.commands.listCommands()
					.filter(c => c.id.startsWith(${JSON.stringify(`${PLUGIN_ID}:`)}))
					.map(c => c.id.replace(${JSON.stringify(`${PLUGIN_ID}:`)}, ''))
			`);
			const missing = EXPECTED_COMMANDS.filter(c => !allCommands.includes(c));
			if (missing.length > 0) throw new Error(`缺失命令: ${missing.join(', ')}`);
			return `${allCommands.length} 个命令`;
		});

		await step('API 方法完整', async () => {
			const available = await evaluate(`
				Object.keys(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.api || {})
			`);
			const missing = EXPECTED_API_METHODS.filter(m => !available.includes(m));
			if (missing.length > 0) throw new Error(`缺失 API: ${missing.join(', ')}`);
			return `${available.length} 个 API`;
		});

		await step('设置结构完整', async () => {
			const s = await getSettings();
			if (!s) throw new Error('设置为 null');
			const requiredKeys = ['providers', 'roles', 'booklistHistory'];
			const missing = requiredKeys.filter(k => !(k in s));
			if (missing.length > 0) throw new Error(`缺失设置: ${missing.join(', ')}`);
			const providerCount = Object.keys(s.providers || {}).length;
			return `${providerCount} 个 provider`;
		});

		await step('manifest.id 正确', async () => {
			const id = await evaluate(`app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.manifest?.id`);
			if (id !== PLUGIN_ID) throw new Error(`manifest.id=${id}, 期望=${PLUGIN_ID}`);
		});

		return { steps };
	},
};

// 独立运行
const url = import.meta.url;
if (process.argv[1] && url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
	console.log(`\n🧪 ${spec.name}`);
	try {
		const result = await spec.run();
		for (const s of result.steps) {
			const icon = s.status === 'pass' ? '✅' : '❌';
			console.log(`  ${icon} ${s.name} (${s.duration}ms)${s.detail ? ' — ' + s.detail : ''}`);
		}
		console.log();
	} catch (e) {
		console.error(`\n❌ 测试失败: ${e.message}\n`);
		process.exit(1);
	}
}

export default spec;
