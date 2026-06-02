/**
 * S-20: 高亮 + 摘录链路可达性
 *
 * 锚定: F-20 高亮 + 摘录保存
 * 触发:  evalObsidian 验证高亮/摘录服务的可达性
 * 断言:  readingModeService 的 callbacks 包含高亮/摘录入口
 *
 * 高亮功能通过 ReadingModeService 的 callback 触发：
 *   onSaveHighlight → HighlightService.saveHighlight()
 *   onExcerpt → 触发 deeppdf:excerpt-selection 事件
 * 没有独立的命令入口。
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

export default {
	id: 'S-20',
	name: '高亮摘录链路可达性',
	level: 'full',
	feature: 'F-20',
	timeout: 5_000,

	async run({ log }) {
		const result = await evalObsidian(`(() => {
			const svc = app.plugins.plugins["deepreader-dev"]?.readingModeService;
			if (!svc) return { exists: false };

			// 高亮通过 callback 链路: ReadingModeService → HighlightService
			// 验证 callback 是否已设置
			const callbacks = svc.callbacks || {};
			return {
				exists: true,
				hasOnSaveHighlight: typeof callbacks.onSaveHighlight === 'function',
				hasOnRemoveHighlight: typeof callbacks.onRemoveHighlight === 'function',
				hasOnExcerpt: typeof callbacks.onExcerpt === 'function',
			};
		})()`);

		if (!result?.exists) {
			throw new Error('readingModeService 不存在');
		}

		const missing = [];
		if (!result.hasOnSaveHighlight) missing.push('onSaveHighlight');
		if (!result.hasOnRemoveHighlight) missing.push('onRemoveHighlight');
		if (!result.hasOnExcerpt) missing.push('onExcerpt');

		if (missing.length > 0) {
			throw new Error(`高亮/摘录回调未设置: ${missing.join(', ')}`);
		}

		log?.info?.('✓ 高亮 + 摘录 callback 链路完整');
		return { ok: true };
	},
};
