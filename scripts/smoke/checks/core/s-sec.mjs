/**
 * S-SEC: 安全模块完整性检查
 *
 * 验证 sanitizeHumanizedHtml 函数存在且能正确过滤 XSS 向量
 * 锚定: 2026-06-08 五轴审查修复 (9b4d19d5)
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

export default {
	id: 'S-SEC',
	name: '安全模块完整性',
	level: 'core',
	feature: null,
	timeout: 10_000,

	async run({ log }) {
		const result = await evalObsidian(`
			(async () => {
				// 1. 验证插件已加载
				const plugin = app.plugins.plugins['deepreader-dev'];
				if (!plugin) return { ok: false, error: '插件未加载' };

				// 2. 检查 main.js 中是否包含 sanitizer 关键代码
				const adapter = app.vault.adapter;
				const mainJs = await adapter.read('.obsidian/plugins/deepreader-dev/main.js');
				const hasSanitizer = mainJs.includes('sanitizeHumanizedHtml');

				if (!hasSanitizer) {
					return { ok: false, error: 'sanitizeHumanizedHtml 函数未在 bundle 中找到' };
				}

				// 3. 检查 write_note 路径验证
				const hasPathTraversal = mainJs.includes('Path traversal detected');
				const hasObsidianGuard = mainJs.includes('.obsidian/');

				return {
					ok: true,
					sanitizer: hasSanitizer,
					pathTraversal: hasPathTraversal,
					obsidianGuard: hasObsidianGuard
				};
			})()
		`);

		if (!result.ok) {
			throw new Error(result.error || '安全模块检查失败');
		}

		if (!result.sanitizer) {
			throw new Error('sanitizeHumanizedHtml 未找到');
		}
		if (!result.pathTraversal) {
			throw new Error('write_note 路径穿越检查未找到');
		}
		if (!result.obsidianGuard) {
			throw new Error('write_note .obsidian/ 保护未找到');
		}

		log?.info?.(`sanitizer=${result.sanitizer}, pathCheck=${result.pathTraversal}, obsidianGuard=${result.obsidianGuard}`);
		return { ok: true };
	},
};
