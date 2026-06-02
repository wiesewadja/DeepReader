/**
 * S-19: 阅读进度可达性
 *
 * 锚定: F-19 阅读进度追踪
 * 触发:  evalObsidian 验证 readingModeService 公共方法
 * 断言:  readingModeService 存在 + 关键方法可调用
 *
 * 不需要实际进入阅读模式，验证服务可达性和方法签名。
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

export default {
	id: 'S-19',
	name: '阅读进度可达性',
	level: 'full',
	feature: 'F-19',
	timeout: 5_000,

	async run({ log }) {
		const result = await evalObsidian(`(() => {
			const svc = app.plugins.plugins["deepreader-dev"]?.readingModeService;
			if (!svc) return { exists: false };

			return {
				exists: true,
				hasActivate: typeof svc.activate === 'function',
				hasDeactivate: typeof svc.deactivate === 'function',
				hasGetCurrentFile: typeof svc.getCurrentFile === 'function',
				hasGetPaginator: typeof svc.getPaginator === 'function',
				hasGetChapterNavigation: typeof svc.getChapterNavigation === 'function',
				style: svc.getStyle?.() ?? 'unknown',
			};
		})()`);

		if (!result?.exists) {
			throw new Error('readingModeService 不存在');
		}

		const missingMethods = [];
		if (!result.hasActivate) missingMethods.push('activate');
		if (!result.hasDeactivate) missingMethods.push('deactivate');
		if (!result.hasGetCurrentFile) missingMethods.push('getCurrentFile');
		if (!result.hasGetPaginator) missingMethods.push('getPaginator');
		if (!result.hasGetChapterNavigation) missingMethods.push('getChapterNavigation');

		if (missingMethods.length > 0) {
			throw new Error(`readingModeService 缺少方法: ${missingMethods.join(', ')}`);
		}

		log?.info?.(`✓ readingModeService 可达, style=${result.style}`);
		return { ok: true };
	},
};
