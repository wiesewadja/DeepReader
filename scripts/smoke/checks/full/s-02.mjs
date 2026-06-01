/**
 * S-02: EPUB 索引命令
 *
 * 锚定: F-02 EPUB 索引
 * 触发:  listCommands 验证 EPUB 索引相关命令
 * 断言:  test-pageindex 命令存在（PDF/EPUB 共用）+ parseEpub API 可达
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

		// 验证 parseEpub API 可达
		const hasParseEpub = await evalObsidian(
			'typeof app.plugins.plugins["deepreader"]?.api?.parseEpub === "function"'
		);
		if (!hasParseEpub) {
			throw new Error('api.parseEpub 不可达');
		}

		log?.info?.('✓ test-pageindex 存在, parseEpub 可达');
		return { ok: true };
	},
};
