/**
 * 轻量 E2E: Agent Q&A 评测
 *
 * 对比: tests/e2e/specs/eval-agent.e2e.ts (231 行 WDIO)
 * 通过 evalBackdoor API 运行 Agent 问答并收集响应
 * 需要 LLM + 已索引的书籍 + golden.json 数据集
 * 集成六维评分: ACC(30) + REL(20) + COM(15) + REF(15) + SAF(10) + STY(10)
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';
import { evaluateQaQuality } from '../../../tests/golden/qa-quality/scorer.mjs';

const EVAL_BOOK = process.env.EVAL_BOOK || '反脆弱';

// 六维评分最低阈值
const THRESHOLD_TOTAL = 60;
const THRESHOLD_ACC = 15;
const THRESHOLD_SAF = 8;

export default {
	id: 'eval-agent',
	name: 'Agent Q&A 评测',
	feature: 'F-07/08/09',
	timeout: 600_000,
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

		// 检查前置条件
		const precheck = await evalObsidian(`(() => {
			const adapter = app.vault.adapter;
			const plugin = app.plugins.plugins["deepreader-dev"];
			return (async () => {
				const goldenPath = '.eval/datasets/' + ${JSON.stringify(EVAL_BOOK)} + '/golden.json';
				const exists = await adapter.exists(goldenPath);
				const hasApiKey = !!(plugin?.settings?.deepseekApiKey || plugin?.settings?.customApiKey);
				return { hasGolden: exists, hasApiKey };
			})();
		})()`);

		if (!precheck?.hasGolden) {
			return { status: 'skip', reason: `.eval/datasets/${EVAL_BOOK}/golden.json 不存在` };
		}
		if (!precheck?.hasApiKey) {
			return { status: 'skip', reason: '未配置 LLM API Key' };
		}

		// 读取 golden questions
		const golden = await evalObsidian(`(() => {
			const adapter = app.vault.adapter;
			return (async () => {
				const raw = await adapter.read('.eval/datasets/' + ${JSON.stringify(EVAL_BOOK)} + '/golden.json');
				return JSON.parse(raw);
			})();
		})()`);

		if (!golden?.questions?.length) {
			return { status: 'skip', reason: 'golden.json 无 questions' };
		}

		// 注册 evalBackdoor
		await evalObsidian(`(() => {
			const plugin = app.plugins.plugins["deepreader-dev"];
			if (!plugin.evalBackdoor) {
				const pending = {};
				plugin.evalBackdoor = {
					startQnA(id, question, bookId) {
						const adapter = app.vault.adapter;
						const agent = plugin.frontendAgent;
						(async () => {
							const metaPath = '.obsidian/plugins/deepreader-dev/pageindex/' + bookId + '/book-meta.json';
							const exists = await adapter.exists(metaPath);
							let docMeta = {};
							if (exists) {
								const raw = await adapter.read(metaPath);
								docMeta = JSON.parse(raw);
							}
							const context = {
								vault: { app, plugin },
								book: { indexId: bookId, pdfName: docMeta.title || '', documentMetadata: docMeta },
								mode: 'normal',
							};
							try {
								const result = await agent.runGraphEngine(question, context, {
									onProgress: () => {},
									onContent: () => {},
									onComplete: () => {},
									onError: () => {},
								});
								pending[id] = { response: result?.messages?.slice(-1)[0]?.content || '', traceData: result?.traceData };
							} catch (e) {
								pending[id] = { error: e.message };
							}
						})();
					},
					pollResult(id) {
						const r = pending[id];
						if (r) { delete pending[id]; return r; }
						return null;
					},
				};
			}
			return true;
		})()`);

		// 获取 bookId
		const bookId = await evalObsidian(`(() => {
			const adapter = app.vault.adapter;
			return (async () => {
				const catPath = '.obsidian/plugins/deepreader-dev/pageindex/catalog.json';
				const exists = await adapter.exists(catPath);
				if (!exists) return null;
				const raw = await adapter.read(catPath);
				const catalog = JSON.parse(raw);
				const entry = Object.entries(catalog).find(([_, v]) => v.title?.includes(${JSON.stringify(EVAL_BOOK)}));
				return entry ? entry[0] : null;
			})();
		})()`);

		if (!bookId) {
			return { status: 'skip', reason: `catalog 中未找到 ${EVAL_BOOK}` };
		}

		// 对每个 golden question 运行评测
		const questions = golden.questions.slice(0, 3); // 限制数量
		for (const q of questions) {
			const t0 = Date.now();
			const qId = q.id || q.question.slice(0, 20);

			// 启动 Q&A
			await evalObsidian(`(() => {
				app.plugins.plugins["deepreader-dev"].evalBackdoor.startQnA(
					${JSON.stringify(qId)}, ${JSON.stringify(q.question)}, ${JSON.stringify(bookId)}
				);
				return true;
			})()`);

			// 轮询结果
			let response = null;
			const deadline = Date.now() + 180_000;
			while (Date.now() < deadline) {
				try {
					const r = await evalObsidian(
						'app.plugins.plugins["deepreader-dev"].evalBackdoor.pollResult(' + JSON.stringify(qId) + ')'
					);
					if (r) { response = r; break; }
				} catch { /* ignore */ }
				await new Promise(r => setTimeout(r, 5_000));
			}

			if (!response) {
				fail(`[${q.type}] ${qId}`, Date.now() - t0, new Error('超时无响应'));
			} else if (response.error) {
				fail(`[${q.type}] ${qId}`, Date.now() - t0, new Error(response.error));
			} else if (!response.response || response.response.length < 10) {
				fail(`[${q.type}] ${qId}`, Date.now() - t0,
					new Error(`响应过短: ${response.response?.length || 0}`));
			} else {
				// 六维评分检查
				const evalResult = evaluateQaQuality(response.response, {
					depth: q.depth ?? 0,
					expectedKeywords: q.expectedKeywords || [],
					mustNotContain: q.mustNotContain || [],
					scoringOverrides: q.scoringOverrides || {},
				});
				const { total, scores, grade, details } = evalResult;
				const scoreDetail = `${total}${grade.icon} ACC=${scores.ACC} REL=${scores.REL} COM=${scores.COM} REF=${scores.REF} SAF=${scores.SAF} STY=${scores.STY}`;

				// 最低阈值判定
				if (total < THRESHOLD_TOTAL) {
					fail(`[${q.type}] ${qId}`, Date.now() - t0,
						new Error(`总分 ${total} < ${THRESHOLD_TOTAL} (${grade.label}): ${scoreDetail}`));
				} else if (scores.ACC < THRESHOLD_ACC) {
					fail(`[${q.type}] ${qId}`, Date.now() - t0,
						new Error(`ACC ${scores.ACC} < ${THRESHOLD_ACC}: ${scoreDetail}`));
				} else if (scores.SAF < THRESHOLD_SAF) {
					fail(`[${q.type}] ${qId}`, Date.now() - t0,
						new Error(`SAF ${scores.SAF} < ${THRESHOLD_SAF} (sentinel=${details.sentinelHits?.join(',') || 'none'}): ${scoreDetail}`));
				} else {
					pass(`[${q.type}] ${qId}`, Date.now() - t0,
						`${response.response.length} chars | ${scoreDetail}`);
				}
			}
		}

		return { steps };
	},
};
