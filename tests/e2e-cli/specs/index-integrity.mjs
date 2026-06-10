/**
 * Index Integrity — 书籍索引完整性检查
 *
 * 验证：catalog.json、每本书的 tree/bm25/chunks/vectors 文件、book-meta 信息
 */

import { evaluate } from '../lib/cli-client.mjs';
import { checkBaseline } from '../lib/baseline.mjs';
import { PLUGIN_ID, INDEX_DIR } from '../../lib/constants.mjs';

const spec = {
	id: 'index-integrity',
	name: '书籍索引完整性',
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

		await step('基线: 插件加载', async () => {
			const bl = await checkBaseline({});
			if (!bl.ok) throw new Error(bl.missing.join('; '));
		});

		let bookIds = [];
		await step('catalog.json 可解析', async () => {
			const catalog = await evaluate(`
				(async () => {
					const raw = await app.vault.adapter.read(${JSON.stringify(`${INDEX_DIR}/catalog.json`)});
					return JSON.parse(raw);
				})()
			`);
			if (!catalog?.books || typeof catalog.books !== 'object') throw new Error('catalog 格式错误');
			bookIds = Object.keys(catalog.books);
			if (bookIds.length === 0) throw new Error('catalog 无书籍记录');
			return `${bookIds.length} 本书`;
		});

		await step('每本书索引文件完整', async () => {
			const required = ['tree.json', 'book-meta.json', 'chunks.jsonl', 'vectors.jsonl', 'bm25.json'];
			const issues = await evaluate(`
				(async () => {
					const adapter = app.vault.adapter;
					const required = ${JSON.stringify(required)};
					const bookIds = ${JSON.stringify(bookIds)};
					const base = ${JSON.stringify(INDEX_DIR)};
					const results = [];
					for (const bid of bookIds) {
						for (const f of required) {
							if (!(await adapter.exists(base + '/' + bid + '/' + f))) {
								results.push(bid + '/' + f);
							}
						}
					}
					return results;
				})()
			`);
			if (issues.length > 0) throw new Error(`索引文件缺失: ${issues.join(', ')}`);
			return `${bookIds.length} 本书全部完整`;
		});

		await step('book-meta 包含必要字段', async () => {
			const issues = await evaluate(`
				(async () => {
					const adapter = app.vault.adapter;
					const bookIds = ${JSON.stringify(bookIds)};
					const base = ${JSON.stringify(INDEX_DIR)};
					const issues = [];
					for (const bid of bookIds) {
						const raw = await adapter.read(base + '/' + bid + '/book-meta.json');
						const meta = JSON.parse(raw);
						if (!meta.title) issues.push(bid + ': missing title');
						if (!meta.fileType) issues.push(bid + ': missing fileType');
					}
					return issues;
				})()
			`);
			if (issues.length > 0) throw new Error(issues.join('; '));
		});

		await step('tree.json 可解析', async () => {
			const result = await evaluate(`
				(async () => {
					const adapter = app.vault.adapter;
					const bookIds = ${JSON.stringify(bookIds)};
					const base = ${JSON.stringify(INDEX_DIR)};
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
				})()
			`);
			if (result?.error) throw new Error(result.error);
			return `${result.totalNodes} 个节点`;
		});

		await step('BM25 索引可解析', async () => {
			const result = await evaluate(`
				(async () => {
					const adapter = app.vault.adapter;
					const bookIds = ${JSON.stringify(bookIds)};
					const base = ${JSON.stringify(INDEX_DIR)};
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
				})()
			`);
			if (result?.issues?.length > 0) throw new Error(result.issues.join('; '));
			return `${result.totalNodes} 个 BM25 节点`;
		});

		await step('vectors.jsonl 格式有效', async () => {
			const result = await evaluate(`
				(async () => {
					const adapter = app.vault.adapter;
					const bookIds = ${JSON.stringify(bookIds)};
					const base = ${JSON.stringify(INDEX_DIR)};
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
				})()
			`);
			if (result?.issues?.length > 0) throw new Error(result.issues.join('; '));
			return `${result.totalVectors} 条向量`;
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
