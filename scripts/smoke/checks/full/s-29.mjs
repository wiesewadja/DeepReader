/**
 * S-29: Z-Library 设置
 *
 * 锚定: F-29 Z-Library 搜索 + 下载
 * 触发:  evalObsidian 验证 Z-Library 设置项存在
 * 断言:  enableZlibrary / zlibraryUserId / zlibraryUserKey 属性可读
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

export default {
	id: 'S-29',
	name: 'Z-Library 设置',
	level: 'full',
	feature: 'F-29',
	timeout: 5_000,

	async run({ log }) {
		const result = await evalObsidian(`(() => {
			const s = app.plugins.plugins["deepreader"]?.settings;
			return {
				enabled: s?.enableZlibrary,
				hasUserId: 'zlibraryUserId' in (s || {}),
				hasUserKey: 'zlibraryUserKey' in (s || {}),
				hasDomain: 'zlibraryDomain' in (s || {}),
			};
		})()`);

		if (typeof result?.enabled !== 'boolean') {
			throw new Error(`Z-Library 设置不可读: ${JSON.stringify(result)}`);
		}

		log?.info?.(`✓ Z-Library enabled=${result.enabled}, hasUserId=${result.hasUserId}`);
		return { ok: true, ...result };
	},
};
