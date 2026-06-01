/**
 * 轻量 E2E: PDF 索引+导出
 *
 * 对比: tests/e2e/specs/pdf-index-export.e2e.ts (285 行 WDIO)
 * 通过 plugin API 直接调用 indexBook + 验证索引产物
 * 需要 LLM（从插件设置读取）
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const PDF_FILE = 'agentic-design-patterns-chinese.pdf';

export default {
	id: 'pdf-index-export',
	name: 'PDF 索引+导出',
	feature: 'F-01/04',
	timeout: 300_000,
	requires: {
		files: [PDF_FILE],
	},

	async run({ log }) {
		const steps = [];

		function pass(name, duration, detail) {
			steps.push({ name, status: 'pass', duration, detail });
			log?.info?.(`  ✓ ${name} (${duration}ms)${detail ? '  ' + detail : ''}`);
		}

		function fail(name, duration, error) {
			steps.push({ name, status: 'fail', duration, error: error.message });
		}

		const basePath = await evalObsidian('app.vault.adapter.basePath');
		const fullPath = basePath + '/' + PDF_FILE;

		// ===== 触发索引 =====
		let bookId;
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader"];
					const s = plugin.settings;
					const pageindexRole = s?.roles?.pageindex;
					const provider = s?.providers?.[pageindexRole?.provider];
					if (!provider?.apiKey) return { error: '未配置 LLM API Key (roles.pageindex)' };

					return plugin.api.indexBook({
						filePath: ${JSON.stringify(fullPath)},
						fileType: 'pdf',
						outputDir: ${JSON.stringify(basePath + '/DeepReader')},
						model: pageindexRole?.model || 'deepseek-chat',
						apiKey: provider.apiKey,
						baseUrl: provider.baseUrl,
						addNodeSummary: false,
					});
				})()`, { timeout: 240_000 });

				if (result?.error) throw new Error(result.error);
				if (!result?.bookId) throw new Error(`indexBook 无 bookId: ${JSON.stringify(result)?.slice(0, 100)}`);

				bookId = result.bookId;
				pass('indexBook', Date.now() - t0, `bookId=${bookId}, ch=${result.chaptersCount}`);
			} catch (e) {
				fail('indexBook', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== 验证 book-meta.json =====
		{
			const t0 = Date.now();
			try {
				const meta = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const exists = await adapter.exists('.pageindex/${bookId}/book-meta.json');
						// pageindex dir is under .obsidian/plugins/deepreader/
						const piPath = '.obsidian/plugins/deepreader/pageindex';
						const files = await adapter.list(piPath);
						const hasBookDir = files.folders?.includes(piPath + '/' + ${JSON.stringify(bookId)}) ||
							files.folders?.some(f => f.includes(${JSON.stringify(bookId)}));
						return { exists, hasBookDir };
					})();
				})()`, { timeout: 10_000 });

				if (!meta?.hasBookDir && !meta?.exists) {
					throw new Error(`book-meta.json 不存在 (bookId=${bookId})`);
				}

				pass('book-meta.json', Date.now() - t0);
			} catch (e) {
				fail('book-meta.json', Date.now() - t0, e);
			}
		}

		// ===== 验证导出文件 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const exists = await adapter.exists('DeepReader');
						if (!exists) return { exported: false };
						const listing = await adapter.list('DeepReader');
						const mdFiles = (listing.files || []).filter(f => f.endsWith('.md'));
						return { exported: mdFiles.length > 0, count: mdFiles.length };
					})();
				})()`, { timeout: 10_000 });

				if (!result?.exported) throw new Error('DeepReader 目录下无导出文件');

				pass('导出文件', Date.now() - t0, `count=${result.count}`);
			} catch (e) {
				fail('导出文件', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
