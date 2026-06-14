/**
 * 轻量 E2E: 书籍索引完整性检查
 *
 * 迁移自 tests/e2e-cli/specs/index-integrity.mjs
 * 验证：catalog.json、每本书的 tree/bm25/chunks/vectors 文件、book-meta 信息
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const PLUGIN_ID = 'deepreader-dev';
const INDEX_DIR = `.obsidian/plugins/${PLUGIN_ID}/pageindex`;

export default {
	id: 'index-integrity',
	name: '书籍索引完整性',
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

		// 检查插件是否加载
		{
			const t0 = Date.now();
			try {
				const loaded = await evalObsidian('!!app.plugins?.plugins?.["deepreader-dev"]');
				if (!loaded) throw new Error('插件未加载');
				pass('插件已加载', Date.now() - t0);
			} catch (e) {
				fail('插件已加载', Date.now() - t0, e);
				return { steps };
			}
		}

		let bookIds = [];

		// catalog.json 可解析
		{
			const t0 = Date.now();
			try {
				const catalog = await evalObsidian(`(async () => {
					const raw = await app.vault.adapter.read('${INDEX_DIR}/catalog.json');
					return JSON.parse(raw);
				})()`);
				if (!catalog?.books || typeof catalog.books !== 'object') throw new Error('catalog 格式错误');
				bookIds = Object.keys(catalog.books);
				if (bookIds.length === 0) throw new Error('catalog 无书籍记录');
				pass('catalog.json 可解析', Date.now() - t0, `${bookIds.length} 本书`);
			} catch (e) {
				fail('catalog.json 可解析', Date.now() - t0, e);
				return { steps };
			}
		}

		// 每本书索引文件完整
		{
			const t0 = Date.now();
			try {
				const required = ['tree.json', 'book-meta.json', 'chunks.jsonl', 'vectors.jsonl', 'bm25.json'];
				const issues = await evalObsidian(`(async () => {
					const adapter = app.vault.adapter;
					const required = ${JSON.stringify(required)};
					const bookIds = ${JSON.stringify(bookIds)};
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
				if (issues.length > 0) throw new Error(`索引文件缺失: ${issues.join(', ')}`);
				pass('每本书索引文件完整', Date.now() - t0, `${bookIds.length} 本书全部完整`);
			} catch (e) {
				fail('每本书索引文件完整', Date.now() - t0, e);
			}
		}

		// book-meta 包含必要字段
		{
			const t0 = Date.now();
			try {
				const issues = await evalObsidian(`(async () => {
					const adapter = app.vault.adapter;
					const bookIds = ${JSON.stringify(bookIds)};
					const base = '${INDEX_DIR}';
					const issues = [];
					for (const bid of bookIds) {
						const raw = await adapter.read(base + '/' + bid + '/book-meta.json');
						const meta = JSON.parse(raw);
						if (!meta.title) issues.push(bid + ': missing title');
						if (!meta.fileType) issues.push(bid + ': missing fileType');
					}
					return issues;
				})()`);
				if (issues.length > 0) throw new Error(issues.join('; '));
				pass('book-meta 包含必要字段', Date.now() - t0);
			} catch (e) {
				fail('book-meta 包含必要字段', Date.now() - t0, e);
			}
		}

		// tree.json 可解析
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(async () => {
					const adapter = app.vault.adapter;
					const bookIds = ${JSON.stringify(bookIds)};
					const base = '${INDEX_DIR}';
					let totalNodes = 0;
					for (const bid of bookIds) {
						const raw = await adapter.read(base + '/' + bid + '/tree.json');
						const tree = JSON.parse(raw);
						if (!tree.structure || !Array.isArray(tree.structure)) {
							return { error: bid + ': tree.structure invalid' };
						}
						totalNodes += tree.structure.length;
					}
					return { totalNodes };
				})()`);
				if (result?.error) throw new Error(result.error);
				pass('tree.json 可解析', Date.now() - t0, `${result.totalNodes} 个节点`);
			} catch (e) {
				fail('tree.json 可解析', Date.now() - t0, e);
			}
		}

		// BM25 索引可解析
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(async () => {
					const adapter = app.vault.adapter;
					const bookIds = ${JSON.stringify(bookIds)};
					const base = '${INDEX_DIR}';
					let totalNodes = 0;
					const issues = [];
					for (const bid of bookIds) {
						const raw = await adapter.read(base + '/' + bid + '/bm25.json');
						const bm25 = JSON.parse(raw);
						if (!bm25.nodes || typeof bm25.nodes !== 'object') {
							issues.push(bid + ': bm25.nodes invalid');
							continue;
						}
						totalNodes += Object.keys(bm25.nodes).length;
					}
					return { totalNodes, issues };
				})()`);
				if (result?.issues?.length > 0) throw new Error(result.issues.join('; '));
				pass('BM25 索引可解析', Date.now() - t0, `${result.totalNodes} 个 BM25 节点`);
			} catch (e) {
				fail('BM25 索引可解析', Date.now() - t0, e);
			}
		}

		// vectors.jsonl 格式有效
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(async () => {
					const adapter = app.vault.adapter;
					const bookIds = ${JSON.stringify(bookIds)};
					const base = '${INDEX_DIR}';
					const issues = [];
					let totalVectors = 0;
					for (const bid of bookIds) {
						const raw = await adapter.read(base + '/' + bid + '/vectors.jsonl');
						const lines = raw.trim().split('\\n').filter(l => l.trim());
						if (lines.length === 0) { issues.push(bid + ': empty vectors'); continue; }
						try {
							const first = JSON.parse(lines[0]);
							if (!first.chunkId || !Array.isArray(first.vector)) issues.push(bid + ': invalid format');
							totalVectors += lines.length;
						} catch { issues.push(bid + ': parse error'); }
					}
					return { totalVectors, issues };
				})()`);
				if (result?.issues?.length > 0) throw new Error(result.issues.join('; '));
				pass('vectors.jsonl 格式有效', Date.now() - t0, `${result.totalVectors} 条向量`);
			} catch (e) {
				fail('vectors.jsonl 格式有效', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
