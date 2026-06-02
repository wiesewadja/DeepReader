/**
 * 轻量 E2E: L2 向量化诊断
 *
 * 对比: tests/e2e/specs/l2-vectorization.e2e.ts (447 行 WDIO)
 * 验证 chunks.jsonl 无 fabricated links + trace 记录向量化调用
 * 无 LLM 部分：纯文件系统验证
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const BOOK_ID = 'c9ce4d7b';
const BOOK_NAME = '优秀的绵羊';

export default {
	id: 'l2-vectorization',
	name: 'L2 向量化诊断',
	feature: 'F-35',
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

		// ===== chunks.jsonl fabricated links 检测 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const chunksPath = '.obsidian/plugins/deepreader-dev/pageindex/${BOOK_ID}/chunks.jsonl';
						const exists = await adapter.exists(chunksPath);
						if (!exists) return { exists: false };

						const raw = await adapter.read(chunksPath);
						const lines = raw.split('\\n').filter(l => l.trim());
						let totalChunks = 0;
						let fabricatedLinks = [];
						const linkPattern = /\\[\\[[^\\]]+\\]\\]/g;

						for (const line of lines.slice(0, 100)) {
							try {
								const chunk = JSON.parse(line);
								totalChunks++;
								const content = chunk.content || '';
								const matches = content.match(linkPattern);
								if (matches) {
									fabricatedLinks.push(...matches.slice(0, 3));
								}
							} catch {}
						}
						return {
							exists: true,
							totalChunks,
							fabricatedLinksFound: fabricatedLinks.length > 0,
							fabricatedCount: fabricatedLinks.length,
							samples: fabricatedLinks.slice(0, 5),
						};
					})();
				})()`);

				if (!result?.exists) {
					return { status: 'skip', reason: `${BOOK_NAME} (${BOOK_ID}) 未索引，chunks.jsonl 不存在` };
				}
				if (result.fabricatedLinksFound) {
					throw new Error(`发现 fabricated links: ${result.samples.join(', ')}`);
				}

				pass('chunks 无 fabricated links', Date.now() - t0, `checked=${result.totalChunks}`);
			} catch (e) {
				fail('chunks 无 fabricated links', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== trace 文件记录向量化 token =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const tracePath = '.obsidian/plugins/deepreader-dev/pageindex/traces/${BOOK_ID}.json';
						const exists = await adapter.exists(tracePath);
						if (!exists) return { exists: false };

						const raw = await adapter.read(tracePath);
						const trace = JSON.parse(raw);
						const summary = trace.llmSummary || {};
						return {
							exists: true,
							totalCalls: summary.totalCalls || 0,
							totalInputTokens: summary.totalInputTokens || 0,
							totalOutputTokens: summary.totalOutputTokens || 0,
							phases: (trace.phases || []).length,
						};
					})();
				})()`);

				if (!result?.exists) {
					steps.push({ name: 'trace 向量化', status: 'skip', duration: 0,
						error: 'trace JSON 不存在' });
				} else {
					if (result.totalCalls === 0) throw new Error('llmSummary.totalCalls=0');
					pass('trace 向量化', Date.now() - t0,
						`calls=${result.totalCalls}, tokens=${result.totalInputTokens}+${result.totalOutputTokens}`);
				}
			} catch (e) {
				fail('trace 向量化', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
