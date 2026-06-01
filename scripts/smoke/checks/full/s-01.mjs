/**
 * S-01: PDF 索引命令
 *
 * 锚定: F-01 PDF 索引
 * 触发:  listCommands 验证 test-pageindex 命令
 * 断言:  deepreader:test-pageindex 命令存在
 *
 * 备注: 实证显示 "Process PDF with PageIndex" 和 "Test: PageIndex Core Features"
 *       派生同一 ID test-pageindex
 */

import { listCommands } from '../../lib/obsidian-cli.mjs';

const EXPECTED_IDS = [
	'deepreader:test-pageindex',
];

export default {
	id: 'S-01',
	name: 'PDF 索引命令',
	level: 'full',
	feature: 'F-01',
	timeout: 8_000,

	async run({ log }) {
		const all = await listCommands();
		const idSet = new Set(all);
		const missing = EXPECTED_IDS.filter(id => !idSet.has(id));

		if (missing.length > 0) {
			const err = new Error(`缺失 PDF 索引命令: ${missing.join(', ')}`);
			err.context = `当前 deepreader:* 命令: ${all.join(', ')}`;
			throw err;
		}

		log?.info?.(`✓ ${EXPECTED_IDS.join(', ')} 存在`);
		return { ok: true };
	},
};
