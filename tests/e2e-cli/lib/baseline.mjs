/**
 * 业务基线检查 — CLI 层
 *
 * 在 spec 运行前检查插件状态、书籍索引、配置等前置条件。
 */

import { evaluate } from './cli-client.mjs';
import { PLUGIN_ID, INDEX_DIR } from '../../lib/constants.mjs';

/**
 * 基线检查
 *
 * @param {object} requires
 * @param {string} [requires.bookId] - 书籍 ID
 * @param {boolean} [requires.indexComplete] - 索引完整性
 * @param {string} [requires.settingKeys] - 必须存在的设置 key
 * @param {string[]} [requires.files] - 必须存在的文件路径
 * @returns {Promise<{ ok: boolean, missing: string[], details: object }>}
 */
export async function checkBaseline(requires = {}) {
	const missing = [];
	const details = {};

	// 1. 插件加载
	const pluginLoaded = await evaluate(`!!app.plugins?.plugins?.[${JSON.stringify(PLUGIN_ID)}]`);
	details.pluginLoaded = pluginLoaded;
	if (!pluginLoaded) {
		missing.push('插件未加载');
		return { ok: false, missing, details };
	}

	// 2. 索引完整
	if (requires.indexComplete && requires.bookId) {
		const indexCheck = await evaluate(`
			(async () => {
				const adapter = app.vault.adapter;
				const base = ${JSON.stringify(`${INDEX_DIR}/${requires.bookId}`)};
				const required = ['tree.json', 'book-meta.json', 'chunks.jsonl', 'vectors.jsonl'];
				const results = {};
				for (const f of required) {
					results[f] = await adapter.exists(base + '/' + f);
				}
				return results;
			})()
		`);
		details.indexFiles = indexCheck;
		for (const [file, exists] of Object.entries(indexCheck || {})) {
			if (!exists) missing.push(`索引缺失: ${requires.bookId}/${file}`);
		}
	}

	// 3. 设置项
	if (requires.settingKeys?.length) {
		const settingResults = await evaluate(`
			(() => {
				const s = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.settings;
				return ${JSON.stringify(requires.settingKeys)}.map(k => ({ key: k, exists: !!s?.[k] }));
			})()
		`);
		for (const { key, exists } of settingResults || []) {
			if (!exists) missing.push(`设置缺失: ${key}`);
		}
	}

	// 4. 文件存在
	if (requires.files?.length) {
		const fileResults = await evaluate(`
			(async () => {
				const adapter = app.vault.adapter;
				return Promise.all(${JSON.stringify(requires.files)}.map(p => adapter.exists(p)));
			})()
		`);
		for (let i = 0; i < requires.files.length; i++) {
			if (!fileResults[i]) missing.push(`文件缺失: ${requires.files[i]}`);
		}
	}

	return { ok: missing.length === 0, missing, details };
}
