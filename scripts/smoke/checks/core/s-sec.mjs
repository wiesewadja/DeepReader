/**
 * S-SEC: 安全模块完整性检查
 *
 * 验证 sanitizeHumanizedHtml 函数存在且能正确过滤 XSS 向量
 * 锚定: 2026-06-08 五轴审查修复 (9b4d19d5)
 * 更新: 2026-07-10 write_note 工具已删除，移除路径穿越检查
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
				const plugin = app.plugins.plugins['deepreader-dev'];
				if (!plugin) return { ok: false, error: '插件未加载' };

				const sanitizer = plugin.api?.sanitizeHumanizedHtml;
				if (typeof sanitizer !== 'function') {
					return { ok: false, error: 'sanitizeHumanizedHtml 未暴露在 api 上' };
				}

				// 验证实际过滤能力
				const xssInput = '<script>alert(1)</script><p onclick="evil()">hello</p>';
				const sanitized = sanitizer(xssInput);
				const stripsScriptTag = !sanitized.includes('<script>');
				const stripsEventHandlers = !sanitized.includes('onclick=');

				return {
					ok: stripsScriptTag && stripsEventHandlers,
					sanitizer: true,
					stripsScriptTag: stripsScriptTag,
					stripsEventHandlers: stripsEventHandlers,
				};
			})()
		`);

		if (!result.ok) {
			const detail = [];
			if (result.stripsScriptTag === false) detail.push('未过滤 script 标签');
			if (result.stripsEventHandlers === false) detail.push('未过滤事件处理器');
			throw new Error(result.error || 'sanitizeHumanizedHtml 验证失败: ' + (detail.join('、') || '未知错误'));
		}

		if (!result.sanitizer) {
			throw new Error('sanitizeHumanizedHtml 未找到');
		}

		log?.info?.('sanitizer=运行时验证通过');
		return { ok: true };
	},
};
