/**
 * 轻量 E2E: S2 Analytical Scope nodeFileMap
 *
 * 对比: tests/e2e/specs/scope-nodefilemap.e2e.ts (411 行 WDIO)
 * 验证 tree.json 的 nodeFileMap 字段 + 引用文件存在性
 * 无 LLM 部分也可验证文件结构
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const BOOK_ID = 'c9ce4d7b';
const BOOK_NAME = '优秀的绵羊';

export default {
	id: 'scope-nodefilemap',
	name: 'S2 nodeFileMap 验证',
	feature: 'F-05',
	timeout: 30_000,
	requires: {},

	async run({ log }) {
		const steps = [];

		function pass(name, duration, detail) {
			steps.push({ name, status: 'pass', duration, detail });
			log?.info?.(`  ✓ ${name} (${duration}ms)${detail ? '  ' + detail : ''}`);
		}

		function fail(name, duration, error) {
			steps.push({ name, status: 'fail', duration, error: error.message });
		}

		// ===== tree.json nodeFileMap 存在性 =====
		let nodeFileMap;
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const treePath = '.obsidian/plugins/deepreader-dev/pageindex/${BOOK_ID}/tree.json';
						const exists = await adapter.exists(treePath);
						if (!exists) return { exists: false };
						const raw = await adapter.read(treePath);
						const tree = JSON.parse(raw);
						return {
							exists: true,
							hasNodeFileMap: typeof tree.nodeFileMap === 'object',
							nodeCount: tree.nodeFileMap ? Object.keys(tree.nodeFileMap).length : 0,
						};
					})();
				})()`);

				if (!result?.exists) {
					return { status: 'skip', reason: `${BOOK_NAME} (${BOOK_ID}) 未索引，tree.json 不存在` };
				}
				if (!result.hasNodeFileMap) throw new Error('tree.json 无 nodeFileMap 字段');
				if (result.nodeCount === 0) throw new Error('nodeFileMap 为空');

				nodeFileMap = result.nodeCount;
				pass('nodeFileMap 存在', Date.now() - t0, `nodes=${nodeFileMap}`);
			} catch (e) {
				fail('nodeFileMap 存在', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== nodeFileMap 引用的文件存在性 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const treePath = '.obsidian/plugins/deepreader-dev/pageindex/${BOOK_ID}/tree.json';
						const raw = await adapter.read(treePath);
						const tree = JSON.parse(raw);
						const map = tree.nodeFileMap || {};
						const entries = Object.entries(map);
						let checked = 0;
						let missing = [];
						for (const [nodeId, files] of entries.slice(0, 20)) {
							for (const file of (Array.isArray(files) ? files : [files])) {
								checked++;
								const exists = await adapter.exists(file);
								if (!exists) missing.push(file);
							}
						}
						return { checked, missingCount: missing.length, missing: missing.slice(0, 5) };
					})();
				})()`, { timeout: 15_000 });

				if (result.missingCount > 0) {
					throw new Error(`${result.missingCount}/${result.checked} 文件缺失: ${result.missing.join(', ')}`);
				}

				pass('引用文件存在', Date.now() - t0, `checked=${result.checked}`);
			} catch (e) {
				fail('引用文件存在', Date.now() - t0, e);
			}
		}

		// ===== 多本书的 nodeFileMap =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const catPath = '.obsidian/plugins/deepreader-dev/pageindex/catalog.json';
						const exists = await adapter.exists(catPath);
						if (!exists) return { bookCount: 0 };
						const raw = await adapter.read(catPath);
						const catalog = JSON.parse(raw);
						let booksWithMap = 0;
						for (const [bookId, meta] of Object.entries(catalog)) {
							const treePath = '.obsidian/plugins/deepreader-dev/pageindex/' + bookId + '/tree.json';
							const treeExists = await adapter.exists(treePath);
							if (!treeExists) continue;
							const treeRaw = await adapter.read(treePath);
							const tree = JSON.parse(treeRaw);
							if (tree.nodeFileMap && Object.keys(tree.nodeFileMap).length > 0) booksWithMap++;
						}
						return { bookCount: Object.keys(catalog).length, booksWithMap };
					})();
				})()`, { timeout: 15_000 });

				if (result.bookCount === 0) {
					steps.push({ name: '多书 nodeFileMap', status: 'skip', duration: 0,
						error: 'catalog.json 为空' });
				} else {
					if (result.booksWithMap === 0) throw new Error('无书籍有 nodeFileMap');
					pass('多书 nodeFileMap', Date.now() - t0,
						`${result.booksWithMap}/${result.bookCount} 书有 nodeFileMap`);
				}
			} catch (e) {
				fail('多书 nodeFileMap', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
