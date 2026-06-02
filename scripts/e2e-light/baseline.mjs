/**
 * Baseline 检查模块
 *
 * 在 spec 运行前检查 vault 文件、设置项等前置条件。
 * 不满足时返回明确的缺失列表，由 run.mjs 自动 SKIP。
 */

import { evalObsidian } from '../smoke/lib/obsidian-cli.mjs';

/**
 * 检查 spec 的 requires 声明
 *
 * @param {Object} requires - spec.requires 声明
 * @param {string[]} [requires.files] - vault 中必须存在的文件路径
 * @param {Object} [requires.minLines] - { path: minLineCount } 文件最小行数
 * @param {Object} [requires.settings] - { key: true } 必须存在的设置项（且非空）
 * @returns {Promise<{ ok: boolean, missing: string[] }>}
 */
export async function checkRequires(requires = {}) {
	if (!requires || Object.keys(requires).length === 0) {
		return { ok: true, missing: [] };
	}

	const missing = [];
	const { files = [], minLines = {}, settings = {} } = requires;

	// 1. 检查文件存在性
	if (files.length > 0) {
		const fileResults = await evalObsidian(`(() => {
			const adapter = app.vault.adapter;
			return Promise.all(${JSON.stringify(files)}.map(p => adapter.exists(p)));
		})()`, { timeout: 10_000 });

		for (let i = 0; i < files.length; i++) {
			if (!fileResults[i]) {
				missing.push(`文件缺失: ${files[i]}`);
			}
		}
	}

	// 2. 检查文件行数
	if (Object.keys(minLines).length > 0) {
		const paths = Object.keys(minLines);
		const limits = Object.values(minLines);
		const lineResults = await evalObsidian(`(() => {
			const adapter = app.vault.adapter;
			return Promise.all(${JSON.stringify(paths)}.map(async p => {
				try {
					const content = await adapter.read(p);
					return content.split('\\n').length;
				} catch { return 0; }
			}));
		})()`, { timeout: 10_000 });

		for (let i = 0; i < paths.length; i++) {
			if (lineResults[i] < limits[i]) {
				missing.push(`文件行数不足: ${paths[i]} (${lineResults[i]}行 < ${limits[i]}行)`);
			}
		}
	}

	// 3. 检查设置项
	if (Object.keys(settings).length > 0) {
		const keys = Object.keys(settings);
		const settingResults = await evalObsidian(`(() => {
			const s = app.plugins.plugins["deepreader-dev"]?.settings;
			return ${JSON.stringify(keys)}.map(k => !!s?.[k]);
		})()`);

		for (let i = 0; i < keys.length; i++) {
			if (!settingResults[i]) {
				missing.push(`设置缺失: ${keys[i]}`);
			}
		}
	}

	return { ok: missing.length === 0, missing };
}
