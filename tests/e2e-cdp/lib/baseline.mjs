import { PLUGIN_ID, INDEX_DIR } from '../../lib/constants.mjs';
/**
 * Baseline — 业务测试的前置环境检测
 *
 * 在 spec 运行前检查：
 * - 插件是否加载
 * - 书籍索引是否完整（tree.json / chunks.jsonl / vectors.jsonl）
 * - 章节文件是否存在且含 index_id frontmatter
 * - 书籍是否已被选中（sidebar 有活动书籍）
 *
 * 不满足时返回明确的缺失列表，spec 应 SKIP。
 */

/**
 * 完整的基线检查
 *
 * @param {object} client - CDP client
 * @param {object} requires - 前置条件声明
 * @param {string} [requires.bookId] - 书籍 ID（如 'ee090e29'）
 * @param {string} [requires.chapterPath] - 章节文件 vault 路径
 * @param {boolean} [requires.bookSelected] - 是否要求书籍已被选中
 * @param {boolean} [requires.indexComplete] - 是否要求索引完整
 * @param {boolean} [requires.sidebarOpen] - 是否要求侧边栏打开
 * @param {string[]} [requires.settings] - 必须存在的设置项 key
 * @returns {Promise<{ ok: boolean, missing: string[], details: object }>}
 */
export async function checkBaseline(client, requires = {}) {
	const missing = [];
	const details = {};

	// 1. 插件加载
	const pluginLoaded = await client.evaluateJSON(`!!app.plugins?.plugins?.[${JSON.stringify(PLUGIN_ID)}]`);
	details.pluginLoaded = pluginLoaded;
	if (!pluginLoaded) {
		missing.push('插件未加载: deepreader-dev');
		return { ok: false, missing, details };
	}

	// 2. 书籍索引完整
	if (requires.indexComplete && requires.bookId) {
		const { bookId } = requires;
		const indexCheck = await client.evaluateJSON(`
			(async () => {
				const adapter = app.vault.adapter;
				const base = ${JSON.stringify(`${INDEX_DIR}/${bookId}`)};
				const required = ['tree.json', 'book-meta.json', 'chunks.jsonl'];
				const results = {};
				for (const f of required) {
					results[f] = await adapter.exists(base + '/' + f);
				}
				return results;
			})()
		`);
		details.indexFiles = indexCheck;
		for (const [file, exists] of Object.entries(indexCheck || {})) {
			if (!exists) missing.push(`索引缺失: ${bookId}/${file}`);
		}
	}

	// 3. 章节文件存在
	if (requires.chapterPath) {
		const chapterExists = await client.evaluateJSON(`
			(async () => {
				const adapter = app.vault.adapter;
				return adapter.exists(${JSON.stringify(requires.chapterPath)});
			})()
		`);
		details.chapterExists = chapterExists;
		if (!chapterExists) missing.push(`章节文件缺失: ${requires.chapterPath}`);
	}

	// 4. 章节文件 frontmatter 含 index_id
	if (requires.chapterPath && requires.bookId) {
		const frontmatter = await client.evaluateJSON(`
			(() => {
				const file = app.vault.getAbstractFileByPath(${JSON.stringify(requires.chapterPath)});
				if (!file) return null;
				const cache = app.metadataCache.getFileCache(file);
				return cache?.frontmatter || null;
			})()
		`);
		details.frontmatter = frontmatter;
		if (frontmatter && frontmatter.index_id !== requires.bookId) {
			missing.push(`章节 index_id 不匹配: 期望 ${requires.bookId}, 实际 ${frontmatter.index_id}`);
		}
	}

	// 5. 书籍已被选中
	if (requires.bookSelected) {
		const selected = await client.evaluateJSON(`
			(() => {
				const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
				const mgr = leaves[0]?.view?.bookMgr;
				return {
					indexId: mgr?._currentIndexId || null,
					bookName: mgr?._currentPdfName || null,
				};
			})()
		`);
		details.selectedBook = selected;
		if (!selected?.indexId) {
			missing.push('未选中书籍: sidebar bookMgr._currentIndexId 为空');
		}
	}

	// 6. 侧边栏已打开
	if (requires.sidebarOpen) {
		const sidebarCount = await client.count('.deeppdf-chat-container');
		details.sidebarOpen = sidebarCount > 0;
		if (sidebarCount === 0) missing.push('侧边栏未打开');
	}

	// 7. 设置项检查
	if (requires.settings?.length) {
		const keys = requires.settings;
		const settingResults = await client.evaluateJSON(`
			(() => {
				const s = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.settings;
				return ${JSON.stringify(keys)}.map(k => ({ key: k, exists: !!s?.[k] }));
			})()
		`);
		for (const { key, exists } of settingResults || []) {
			if (!exists) missing.push(`设置缺失: ${key}`);
		}
	}

	return { ok: missing.length === 0, missing, details };
}

/**
 * 快速检查 — 只检查插件和书籍索引
 */
export async function quickCheck(client, bookId) {
	return checkBaseline(client, { bookId, indexComplete: true });
}
