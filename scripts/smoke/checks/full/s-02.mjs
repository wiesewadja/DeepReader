/**
 * S-02: EPUB 索引可达性
 *
 * 锚定: F-02 EPUB 索引
 * 触发:  evalObsidian 验证 EPUB 索引链路的核心入口
 * 断言:  parseEpub 在 plugin.api 上存在（EPUB 索引的核心入口）
 *
 * EPUB 索引链路: parseEpub() → EpubSplitting → chunks → PageIndex
 * test-pageindex 命令（PDF+EPUB 共用）已在 S-01 验证。
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

export default {
	id: 'S-02',
	name: 'EPUB 索引可达性',
	level: 'full',
	feature: 'F-02',
	timeout: 5_000,

	async run({ log }) {
		const result = await evalObsidian(`(() => {
			const p = app.plugins.plugins["deepreader-dev"];
			return {
				hasParseEpub: typeof p?.api?.parseEpub === 'function',
				hasIndexBook: typeof p?.api?.indexBook === 'function',
				hasPageIndex: typeof p?.api?.PageIndex === 'function',
				apiKeys: Object.keys(p?.api || {}),
			};
		})()`);

		const missing = [];
		if (!result?.hasParseEpub) missing.push('parseEpub');
		if (!result?.hasIndexBook) missing.push('indexBook');
		if (!result?.hasPageIndex) missing.push('PageIndex');

		if (missing.length > 0) {
			const err = new Error(`EPUB 索引链路缺失: ${missing.join(', ')}`);
			err.context = `当前 api 方法: ${result?.apiKeys?.join(', ')}`;
			throw err;
		}

		log?.info?.('✓ parseEpub + indexBook + PageIndex 均可达');
		return { ok: true };
	},
};
