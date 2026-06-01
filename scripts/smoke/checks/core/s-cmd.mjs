/**
 * S-CMD: 关键命令注册
 *
 * 触发:  evalObsidian 调 app.commands.listCommands() 拿所有 deepreader:* 命令
 * 断言:  10 个核心命令 ID 全部存在
 * 失败信息:  缺失的命令 ID 列表 + 当前所有 deepreader:* 命令
 *
 * 重要：Obsidian 生成的命令 ID 不等于命令 name 原文——
 * 中文会映射成英文（i18n），冒号被去掉。必须以实际 listCommands() 输出为准。
 * 经验证 (2026-06-01) 的映射:
 *   "Open DeepReader sidebar"    → open-deepreader-sidebar
 *   "Open Library"                → open-library
 *   "打开快速配置"                 → open-quick-setup
 *   "Test: PageIndex Core Features" → test-pageindex
 *   "微信读书：打开设置配置 API Key" → weread-login
 *   "微信读书：同步笔记"            → weread-sync
 *   "微信读书：强制全量同步"        → weread-sync-force
 *   "微信读书：清除 API Key"        → weread-logout
 *   "微信读书：重新匹配书籍"        → weread-rematch
 *   "Debug: Test analytical reading tools" → debug-analytical-reading
 */

import { listCommands } from '../../lib/obsidian-cli.mjs';

const CORE_COMMAND_IDS = [
	'deepreader:open-deepreader-sidebar',     // F-22 Sidebar
	'deepreader:open-library',                // F-23 Library
	'deepreader:open-quick-setup',            // F-24 Quick Setup
	'deepreader:test-pageindex',              // F-01/02 PageIndex
	'deepreader:weread-login',                // F-26 微信登录
	'deepreader:weread-sync',                 // F-27 微信同步
	'deepreader:weread-sync-force',           // F-28 强制全量
	'deepreader:weread-logout',               // F-26 微信登出
	'deepreader:weread-rematch',              // F-28 重新匹配
	'deepreader:debug-analytical-reading',    // F-30 PI 调试
];

export default {
	id: 'S-CMD',
	name: '关键命令注册',
	level: 'core',
	feature: 'F-22/23/24/25/26/30',
	timeout: 8_000,

	async run({ log }) {
		log?.info?.('正在拉取 Obsidian 命令列表...');
		const all = await listCommands();
		const idSet = new Set(all);
		const missing = CORE_COMMAND_IDS.filter(id => !idSet.has(id));

		if (missing.length > 0) {
			const err = new Error(
				`缺失 ${missing.length}/${CORE_COMMAND_IDS.length} 个核心命令:\n` +
				missing.map(id => `  - ${id}`).join('\n')
			);
			err.context = `当前 deepreader:* 命令 (共 ${all.length} 个):\n  ` +
				all.slice(0, 20).join('\n  ');
			throw err;
		}

		log?.info?.(`✓ ${CORE_COMMAND_IDS.length} 个核心命令全部注册 (总计 ${all.length} 个 deepreader:* 命令)`);
		return { ok: true, total: all.length, core: CORE_COMMAND_IDS.length };
	},
};
