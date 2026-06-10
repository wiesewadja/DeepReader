/**
 * Book Search — 书籍搜索功能验证
 *
 * 验证：BM25 搜索、向量格式、搜索工具可达性
 * 需要：至少一本书已索引
 */

import { evaluate } from '../lib/cli-client.mjs';
import { checkBaseline } from '../lib/baseline.mjs';
import { PLUGIN_ID } from '../../lib/constants.mjs';

const BOOK_ID = 'ee090e29'; // AI极简经济学

const spec = {
	id: 'book-search',
	name: '书籍搜索功能',
	timeout: 30_000,

	async run() {
		const steps = [];
		const step = async (name, fn) => {
			const start = Date.now();
			try {
				const detail = await fn();
				steps.push({ name, status: 'pass', duration: Date.now() - start, detail: detail || '' });
			} catch (e) {
				steps.push({ name, status: 'fail', duration: Date.now() - start, error: e.message });
				throw e;
			}
		};

		await step('基线: 索引完整', async () => {
			const bl = await checkBaseline({ bookId: BOOK_ID, indexComplete: true });
			if (!bl.ok) throw new Error(bl.missing.join('; '));
		});

		await step('BM25 索引包含目标关键词', async () => {
			const result = await evaluate(`
				(async () => {
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
				})()
			`);
			if (result.count === 0) throw new Error(`关键词 "${result.keyword}" 无命中`);
			return `${result.count} 条命中, top: "${result.top?.snippet?.substring(0, 30)}..."`;
		});

		await step('向量数据可检索', async () => {
			const result = await evaluate(`
				(async () => {
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
				})()
			`);
			if (result.totalLines === 0) throw new Error('无向量数据');
			if (result.vectorDim === 0) throw new Error('向量维度为 0');
			return `${result.totalLines} 条, dim=${result.vectorDim}`;
		});

		await step('tree 节点可定位', async () => {
			const result = await evaluate(`
				(async () => {
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
				})()
			`);
			if (result.withTitle === 0) throw new Error('无有效节点');
			return `${result.total} 个节点, ${result.withFileMap} 有文件映射`;
		});

		await step('搜索数据完整性', async () => {
			const result = await evaluate(`
				(async () => {
					const adapter = app.vault.adapter;
					const base = '.obsidian/plugins/${PLUGIN_ID}/pageindex/${BOOK_ID}';
					const checks = {};
					for (const f of ['tree.json', 'bm25.json', 'chunks.jsonl', 'vectors.jsonl', 'book-meta.json']) {
						checks[f] = await adapter.exists(base + '/' + f);
					}
					const missing = Object.entries(checks).filter(([k,v]) => !v).map(([k]) => k);
					return { missing, checks };
				})()
			`);
			if (result.missing.length > 0) throw new Error(`缺失: ${result.missing.join(', ')}`);
			return '5 个搜索数据文件齐全';
		});

		return { steps };
	},
};

// 独立运行
const url = import.meta.url;
if (process.argv[1] && url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
	console.log(`\n🧪 ${spec.name}`);
	try {
		const result = await spec.run();
		for (const s of result.steps) {
			const icon = s.status === 'pass' ? '✅' : '❌';
			console.log(`  ${icon} ${s.name} (${s.duration}ms)${s.detail ? ' — ' + s.detail : ''}`);
		}
		console.log();
	} catch (e) {
		console.error(`\n❌ 测试失败: ${e.message}\n`);
		process.exit(1);
	}
}

export default spec;
