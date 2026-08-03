/**
 * 轻量 E2E: 索引 trace 日志
 *
 * 对比: tests/e2e/specs/index-trace.e2e.ts (375 行 WDIO)
 * 触发索引并验证 trace 日志和 JSON 结构
 * 需要 LLM
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const TEST_BOOK = {
	id: 'c9ce4d7b',
	title: '优秀的绵羊',
	filePattern: '优秀的绵羊',
 epubFile: 'DeepReader/assets/优秀的绵羊 ([美]威廉•德雷谢维奇 著) (z-library.sk, 1lib.sk, z-lib.sk).epub',
};

export default {
	id: 'index-trace',
	name: '索引 trace 日志',
	feature: 'F-05',
	timeout: 300_000,
	requires: {
		files: [TEST_BOOK.epubFile],
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

		// ===== 查找 EPUB 文件并触发索引 =====
		let bookId;
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader-dev"];
					const s = plugin.settings;
					const pageindexRole = s?.roles?.pageindex;
					const provider = s?.providers?.[pageindexRole?.provider];
					if (!provider?.apiKey) return { error: '未配置 LLM API Key' };

					const adapter = app.vault.adapter;
					return (async () => {
						// 清理旧索引
						const piBase = '.obsidian/plugins/deepreader-dev/pageindex';
						const bookDir = piBase + '/' + ${JSON.stringify(TEST_BOOK.id)};
						const exists = await adapter.exists(bookDir);
						if (exists) {
							try { await adapter.rmdir(bookDir, true); } catch {}
						}

						// 查找 EPUB
						const assetsExists = await adapter.exists('DeepReader/assets');
						if (!assetsExists) return { error: 'DeepReader/assets 不存在' };
						const listing = await adapter.list('DeepReader/assets');
						const epubFile = (listing.files || []).find(f =>
							f.includes(${JSON.stringify(TEST_BOOK.filePattern)}) && f.endsWith('.epub')
						);
						if (!epubFile) return { error: '未找到 EPUB: ' + ${JSON.stringify(TEST_BOOK.filePattern)} };

						const basePath = adapter.basePath;
						const fullPath = basePath + '/' + epubFile;

						return plugin.api.indexBook({
							filePath: fullPath,
							fileType: 'epub',
							outputDir: basePath + '/DeepReader',
							model: pageindexRole?.model || 'deepseek-chat',
							apiKey: provider.apiKey,
							baseUrl: provider.baseUrl,
							addNodeSummary: false,
						});
					})();
				})()`, { timeout: 240_000 });

				if (result?.error) throw new Error(result.error);
				if (!result?.bookId) throw new Error('indexBook 无返回');

				bookId = result.bookId;
				pass('触发索引', Date.now() - t0, `bookId=${bookId}`);
			} catch (e) {
				fail('触发索引', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== 验证 trace JSON =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const tracePath = '.obsidian/plugins/deepreader-dev/pageindex/traces/' + ${JSON.stringify(bookId)} + '.json';
						const exists = await adapter.exists(tracePath);
						if (!exists) return { exists: false };

						const raw = await adapter.read(tracePath);
						const trace = JSON.parse(raw);
						return {
							exists: true,
							title: trace.title,
							success: trace.success,
							bookId: trace.bookId,
							fileType: trace.fileType,
							phasesCount: trace.phases?.length || 0,
							hasLlmSummary: !!trace.llmSummary,
							totalCalls: trace.llmSummary?.totalCalls || 0,
						};
					})();
				})()`, { timeout: 10_000 });

				if (!result?.exists) throw new Error('trace JSON 不存在');
				if (!result.success) throw new Error('trace 显示索引失败');
				if (result.bookId !== bookId) throw new Error(`bookId 不匹配: ${result.bookId} vs ${bookId}`);

				pass('trace JSON', Date.now() - t0,
					`phases=${result.phasesCount}, llmCalls=${result.totalCalls}`);
			} catch (e) {
				fail('trace JSON', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
