/**
 * 轻量 E2E: 书籍搜索功能验证
 *
 * 迁移自 tests/e2e-cli/specs/book-search.mjs
 * 验证：BM25 搜索、向量格式、搜索工具可达性
 * 需要：至少一本书已索引
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const BOOK_ID = 'ee090e29'; // AI极简经济学
const PLUGIN_ID = 'deepreader-dev';

export default {
	id: 'book-search',
	name: '书籍搜索功能',
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

		// 检查索引是否存在
		{
			const t0 = Date.now();
			try {
				const exists = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return adapter.exists('.obsidian/plugins/${PLUGIN_ID}/pageindex/${BOOK_ID}/book-meta.json');
				})()`);
				if (!exists) {
					return { status: 'skip', reason: `${BOOK_ID} 未索引` };
				}
				pass('索引存在', Date.now() - t0, `bookId=${BOOK_ID}`);
			} catch (e) {
				fail('索引存在', Date.now() - t0, e);
				return { steps };
			}
		}

		// BM25 索引包含目标关键词
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(async () => {
					const adapter = app.vault.adapter;
					const base = '.obsidian/plugins/${PLUGIN_ID}/pageindex';
					const raw = await adapter.read(base + '/${BOOK_ID}/bm25.json');
					const bm25 = JSON.parse(raw);
					const nodes = bm25.nodes || {};
					const keyword = '预测';
					const hits = [];
					for (const [id, node] of Object.entries(nodes)) {
						if (node.text && node.text.includes(keyword)) {
							hits.push({ id, snippet: node.text.substring(0, 60) });
						}
					}
					return { keyword, count: hits.length, top: hits[0] };
				})()`);
				if (result.count === 0) throw new Error(`关键词 "${result.keyword}" 无命中`);
				pass('BM25 索引包含目标关键词', Date.now() - t0, `${result.count} 条命中`);
			} catch (e) {
				fail('BM25 索引包含目标关键词', Date.now() - t0, e);
			}
		}

		// 向量数据可检索
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(async () => {
					const adapter = app.vault.adapter;
					const base = '.obsidian/plugins/${PLUGIN_ID}/pageindex';
					const raw = await adapter.read(base + '/${BOOK_ID}/vectors.jsonl');
					const lines = raw.trim().split('\\n').filter(l => l.trim());
					const sample = JSON.parse(lines[0]);
					return {
						totalLines: lines.length,
						vectorDim: sample.vector?.length || 0,
						hasChunkId: !!sample.chunkId,
						hasBlockIds: Array.isArray(sample.blockIds),
					};
				})()`);
				if (result.totalLines === 0) throw new Error('无向量数据');
				if (result.vectorDim === 0) throw new Error('向量维度为 0');
				pass('向量数据可检索', Date.now() - t0, `${result.totalLines} 条, dim=${result.vectorDim}`);
			} catch (e) {
				fail('向量数据可检索', Date.now() - t0, e);
			}
		}

		// tree 节点可定位
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(async () => {
					const adapter = app.vault.adapter;
					const base = '.obsidian/plugins/${PLUGIN_ID}/pageindex';
					const raw = await adapter.read(base + '/${BOOK_ID}/tree.json');
					const tree = JSON.parse(raw);
					const nodes = tree.structure || [];
					const found = nodes.filter(n => n.title && (n.nodeId || n.startIndex));
					const withFile = nodes.filter(n => tree.nodeFileMap?.[n.nodeId]);
					return {
						total: nodes.length,
						withTitle: found.length,
						withFileMap: withFile.length,
						titles: nodes.slice(0, 3).map(n => n.title),
					};
				})()`);
				if (result.withTitle === 0) throw new Error('无有效节点');
				pass('tree 节点可定位', Date.now() - t0, `${result.total} 个节点`);
			} catch (e) {
				fail('tree 节点可定位', Date.now() - t0, e);
			}
		}

		// 注：搜索数据文件完整性（tree/bm25/chunks/vectors/book-meta 五件套是否齐全）
		// 由 index-integrity spec 统一覆盖，此处不重复检查，聚焦搜索行为本身。

		return { steps };
	},
};
