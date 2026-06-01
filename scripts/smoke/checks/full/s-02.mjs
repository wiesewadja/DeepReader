/**
 * S-02: EPUB 索引命令
 *
 * 锚定: F-02 EPUB 索引
 * 触发:  listCommands 验证 EPUB 索引相关命令
 * 断言:  test-pageindex 命令存在 + focusIndex 模块可达
 *
 * 设计意图: EPUB 索引依赖 focusIndex（EpubSplitting）模块，
 * 如果该模块不可达，说明 EPUB 索引链路有断点。
 */

import { evalObsidian, listCommands } from '../../lib/obsidian-cli.mjs';

export default {
	id: 'S-02',
	name: 'EPUB 索引命令',
	level: 'full',
	feature: 'F-02',
	timeout: 8_000,

	async run({ log }) {
		const all = await listCommands();
		const idSet = new Set(all);
		if (!idSet.has('deepreader:test-pageindex')) {
			throw new Error('test-pageindex 命令不存在');
		}

		// F-02 核心断言：EPUB splitting 模块必须可达
		const hasFocusIndex = await evalObsidian(
			'typeof app.plugins.plugins["deepreader"]?.api?.focusIndex === "object"'
		);
		if (!hasFocusIndex) {
			const apiKeys = await evalObsidian('Object.keys(app.plugins.plugins["deepreader"]?.api || {})');
			const err = new Error('api.focusIndex 不可达（EPUB splitting 模块未暴露）');
			err.context = `当前 api 方法: ${apiKeys.join(', ')}`;
			throw err;
		}

		log?.info?.('✓ test-pageindex 存在, focusIndex 模块可达');
		return { ok: true };
	},
};
