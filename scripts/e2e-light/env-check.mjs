/**
 * 环境健康检查模块
 *
 * 在测试套件运行前检查 test-vault 是否可用且基础设施数据齐全。
 * 只检查一次，有问题就整个套件停止。
 *
 * 检查项：
 * 1. Obsidian 已连接（evalObsidian 可用）
 * 2. 插件已加载（deepreader-dev）
 * 3. catalog.json 存在且可解析
 * 4. 索引文件完整（tree.json、bm25.json、chunks.jsonl、vectors.jsonl、book-meta.json）
 * 5. API Key 已配置
 */

import { evalObsidian } from '../smoke/lib/obsidian-cli.mjs';

const PLUGIN_ID = 'deepreader-dev';
const INDEX_DIR = `.obsidian/plugins/${PLUGIN_ID}/pageindex`;
const REQUIRED_INDEX_FILES = ['tree.json', 'bm25.json', 'chunks.jsonl', 'vectors.jsonl', 'book-meta.json'];

/**
 * 执行环境健康检查
 *
 * @returns {Promise<{ ok: boolean, errors: string[] }>}
 */
export async function checkEnvironment() {
	const errors = [];

	// 1. 检查 Obsidian 是否已连接
	try {
		const connected = await evalObsidian('true', { timeout: 5_000 });
		if (connected !== true) {
			errors.push('Obsidian 未连接（evalObsidian 返回异常）');
			return { ok: false, errors };
		}
	} catch (e) {
		errors.push(`Obsidian 未连接: ${e.message}`);
		return { ok: false, errors };
	}

	// 2. 检查插件是否已加载
	try {
		const pluginLoaded = await evalObsidian(`!!app.plugins?.plugins?.["${PLUGIN_ID}"]`);
		if (!pluginLoaded) {
			errors.push('插件 deepreader-dev 未加载');
			return { ok: false, errors };
		}
	} catch (e) {
		errors.push(`插件加载检查失败: ${e.message}`);
		return { ok: false, errors };
	}

	// 3 + 4. 一次读取 catalog.json：校验格式 + 取出 bookIds（后续索引文件检查复用）
	let bookIds = [];
	try {
		const catalogInfo = await evalObsidian(`(async () => {
			const adapter = app.vault.adapter;
			if (!(await adapter.exists('${INDEX_DIR}/catalog.json'))) {
				return { exists: false };
			}
			try {
				const raw = await adapter.read('${INDEX_DIR}/catalog.json');
				const catalog = JSON.parse(raw);
				const valid = catalog?.books && typeof catalog.books === 'object';
				return {
					exists: true,
					valid,
					bookIds: valid ? Object.keys(catalog.books) : [],
				};
			} catch {
				return { exists: true, valid: false, bookIds: [] };
			}
		})()`);

		if (!catalogInfo?.exists) {
			errors.push('catalog.json 不存在');
		} else if (!catalogInfo.valid) {
			errors.push('catalog.json 格式错误或无书籍记录');
		} else {
			bookIds = catalogInfo.bookIds;
		}

		// 4. 检查每本书的索引文件（复用已取到的 bookIds）
		if (bookIds.length > 0) {
			const missingFiles = await evalObsidian(`(async () => {
				const adapter = app.vault.adapter;
				const bookIds = ${JSON.stringify(bookIds)};
				const required = ${JSON.stringify(REQUIRED_INDEX_FILES)};
				const base = '${INDEX_DIR}';
				const results = [];
				for (const bid of bookIds) {
					for (const f of required) {
						if (!(await adapter.exists(base + '/' + bid + '/' + f))) {
							results.push(bid + '/' + f);
						}
					}
				}
				return results;
			})()`);

			if (missingFiles && missingFiles.length > 0) {
				errors.push(`索引文件缺失: ${missingFiles.slice(0, 5).join(', ')}${missingFiles.length > 5 ? ` 等 ${missingFiles.length} 个` : ''}`);
			}
		}
	} catch (e) {
		errors.push(`索引文件检查失败: ${e.message}`);
	}

	// 5. 检查 API Key
	try {
		const hasApiKey = await evalObsidian(`(() => {
			const s = app.plugins.plugins["${PLUGIN_ID}"]?.settings;
			const providers = s?.providers || {};
			return !!(s?.deepseekApiKey || s?.customApiKey || s?.openaiApiKey || Object.values(providers).some(p => !!p.apiKey));
		})()`);
		if (!hasApiKey) {
			errors.push('未配置任何 LLM API Key');
		}
	} catch (e) {
		errors.push(`API Key 检查失败: ${e.message}`);
	}

	return { ok: errors.length === 0, errors };
}
