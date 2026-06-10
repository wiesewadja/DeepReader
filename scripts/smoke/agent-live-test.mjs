#!/usr/bin/env node

/**
 * 奚童问答质量快速评分脚本
 *
 * 独立运行: node scripts/smoke/agent-live-test.mjs [--only qa-001,qa-007] [--report]
 *
 * 功能:
 * 1. 加载 tests/golden/qa-quality/dataset.json
 * 2. 通过 evalObsidian 与运行中的 Obsidian 通信
 * 3. 对每个测试用例发送问题，收集回复
 * 4. 用六维评分引擎（ACC/REL/COM/REF/SAF/STY）评估回复质量
 * 5. 输出评分报告到控制台
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { evalObsidian } from './lib/obsidian-cli.mjs';
import { evaluateQaQuality, getGrade, saveResult as saveScorerResult } from '../../tests/golden/qa-quality/scorer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

// ─── 常量 ───────────────────────────────────────────────

const DATASET_PATH = join(PROJECT_ROOT, 'tests', 'golden', 'qa-quality', 'dataset.json');
const RESULTS_DIR = join(PROJECT_ROOT, 'tests', 'golden', 'qa-quality', 'results');
const PLUGIN_ID = 'deepreader-dev';

const TIMEOUT_RESPONSE = 180_000; // 单条问答超时（毫秒）
const POLL_INTERVAL = 3_000; // 轮询间隔
const COOLDOWN_MS = 2_000; // 用例间冷却，避免限流

// ─── 评分引擎（已抽取到 scorer.mjs） ──────────────────────────────────────────

// ─── Obsidian 交互层 ───────────────────────────────────────────

/**
 * 确认插件已加载且 evalBackdoor 可用
 */
async function ensureEvalBackdoor() {
	// 检查插件是否加载
	const pluginCheck = await evalObsidian(`(() => {
		const p = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
		return { loaded: !!p, hasAgent: !!p?.frontendAgent };
	})()`);

	if (!pluginCheck?.loaded) {
		throw new Error(`插件 ${PLUGIN_ID} 未加载。请确认 Obsidian 已启动并加载了插件。`);
	}
	if (!pluginCheck?.hasAgent) {
		throw new Error('frontendAgent 不存在。插件可能未完全初始化。');
	}

	// 注册 evalBackdoor（如果不存在）
	await evalObsidian(`(() => {
		const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
		if (!plugin.evalBackdoor) {
			const pending = {};
			plugin.evalBackdoor = {
				startQnA(id, question, bookId, history) {
					const adapter = app.vault.adapter;
					const agent = plugin.frontendAgent;
					(async () => {
						const metaPath = '.obsidian/plugins/deepreader-dev/pageindex/' + bookId + '/book-meta.json';
						let docMeta = {};
						try {
							const exists = await adapter.exists(metaPath);
							if (exists) {
								const raw = await adapter.read(metaPath);
								docMeta = JSON.parse(raw);
							}
						} catch(e) { /* ignore */ }
						const context = {
							vault: { app, plugin },
							book: { indexId: bookId, pdfName: docMeta.title || '', documentMetadata: docMeta },
							mode: 'normal',
						};
						const opts = {
							onProgress: () => {},
							onContent: () => {},
							onComplete: () => {},
							onError: () => {},
						};
						// 如果有历史消息，注入到 agent 的 chatHistory
						if (history && history.length > 0) {
							const sidebar = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
							if (sidebar.length > 0) {
								const view = sidebar[0].view;
								if (view._chatController) {
									// 注入历史到 _agentChatHistory
									const chatHistory = history.map(m => ({
										role: m.role,
										content: m.content,
									}));
									view._chatController._agentChatHistory = chatHistory;
								}
							}
						}
						try {
							const result = await agent.runGraphEngine(question, context, opts);
							const lastMsg = result?.messages?.slice(-1)[0];
							pending[id] = {
								response: lastMsg?.content || '',
								traceData: result?.traceData || null,
							};
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
}

/**
 * 发送问题并轮询等待回复
 */
async function runSingleQa(caseId, question, bookId, history) {
	// 启动问答
	await evalObsidian(`(() => {
		app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].evalBackdoor.startQnA(
			${JSON.stringify(caseId)},
			${JSON.stringify(question)},
			${JSON.stringify(bookId || '')},
			${JSON.stringify(history || null)}
		);
		return true;
	})()`);

	// 轮询结果
	const deadline = Date.now() + TIMEOUT_RESPONSE;
	let response = null;
	while (Date.now() < deadline) {
		try {
			const r = await evalObsidian(
				`app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].evalBackdoor.pollResult(${JSON.stringify(caseId)})`
			);
			if (r) { response = r; break; }
		} catch { /* ignore poll errors */ }
		await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
	}

	return response;
}

// ─── 报告格式化 ───────────────────────────────────────────────

function formatScore(value, max) {
	return `${value}/${max}`;
}

function printConsoleReport(results) {
	console.log('');
	console.log('奚童问答质量评估');
	console.log('='.repeat(50));
	console.log('');

	let passCount = 0;
	let totalScore = 0;
	const failedCases = [];

	for (const r of results) {
		const grade = getGrade(r.total);
		const passed = r.total >= 60 && !r.error;
		if (passed) passCount++;

		const catLabel = r.category;
		const questionPreview = r.question.length > 40 ? r.question.slice(0, 40) + '...' : r.question;

		console.log(`[${r.id}] ${catLabel}: "${questionPreview}"`);

		if (r.error) {
			console.log(`  错误: ${r.error}`);
			console.log(`  总分: 0/100 - ${grade.label}`);
			failedCases.push(`${r.id} (${r.error})`);
		} else {
			console.log(
				`  ACC: ${formatScore(r.scores.ACC, 30)}  ` +
				`REL: ${formatScore(r.scores.REL, 20)}  ` +
				`COM: ${formatScore(r.scores.COM, 15)}  ` +
				`REF: ${formatScore(r.scores.REF, 15)}  ` +
				`SAF: ${formatScore(r.scores.SAF, 10)}  ` +
				`STY: ${formatScore(r.scores.STY, 10)}`
			);
			console.log(`  总分: ${r.total}/100 ${grade.icon} ${grade.label}`);

			const details = [];
			if (r.details.matchedKeywords.length > 0) {
				details.push(`关键词命中 ${JSON.stringify(r.details.matchedKeywords)}`);
			} else if (r.expectedKeywords.length > 0) {
				details.push('关键词未命中');
			}
			if (r.details.sentinelHits.length > 0) {
				details.push(`sentinel 命中 ${JSON.stringify(r.details.sentinelHits)}`);
			}
			if (r.duration) {
				details.push(`耗时 ${(r.duration / 1000).toFixed(1)}s`);
			}
			if (r.responseLength) {
				details.push(`${r.responseLength} 字符`);
			}
			if (details.length > 0) {
				console.log(`  详情: ${details.join(' | ')}`);
			}

			if (!passed) {
				failedCases.push(`${r.id} (${grade.label}, ${r.total}分)`);
			}
		}

		totalScore += r.total;
		console.log('');
	}

	console.log('='.repeat(50));
	const avg = results.length > 0 ? Math.round(totalScore / results.length) : 0;
	console.log(`总评: ${passCount}/${results.length} 通过 | 平均分 ${avg}/100`);
	if (failedCases.length > 0) {
		console.log(`失败用例: ${failedCases.join(', ')}`);
	}
	console.log('');
}

function formatMarkdownReport(results) {
	let md = '# 奚童问答质量评估报告\n\n';
	md += `生成时间: ${new Date().toISOString()}\n\n`;

	let passCount = 0;
	let totalScore = 0;

	md += '| 用例ID | 类别 | 问题 | ACC | REL | COM | REF | SAF | STY | 总分 | 等级 |\n';
	md += '|--------|------|------|-----|-----|-----|-----|-----|-----|------|------|\n';

	for (const r of results) {
		const grade = getGrade(r.total);
		const passed = r.total >= 60 && !r.error;
		if (passed) passCount++;
		totalScore += r.total;

		const q = r.question.length > 30 ? r.question.slice(0, 30) + '...' : r.question;
		if (r.error) {
			md += `| ${r.id} | ${r.category} | ${q} | - | - | - | - | - | - | 0 | 错误: ${r.error} |\n`;
		} else {
			md += `| ${r.id} | ${r.category} | ${q} | ${r.scores.ACC}/30 | ${r.scores.REL}/20 | ${r.scores.COM}/15 | ${r.scores.REF}/15 | ${r.scores.SAF}/10 | ${r.scores.STY}/10 | ${r.total}/100 | ${grade.label} |\n`;
		}
	}

	const avg = results.length > 0 ? Math.round(totalScore / results.length) : 0;
	md += `\n**总评**: ${passCount}/${results.length} 通过 | 平均分 ${avg}/100\n`;

	// 详细分析
	md += '\n---\n\n## 详细分析\n\n';
	for (const r of results) {
		md += `### ${r.id}: ${r.question}\n\n`;
		if (r.error) {
			md += `**错误**: ${r.error}\n\n`;
			continue;
		}
		md += `- **回复长度**: ${r.responseLength} 字符\n`;
		md += `- **耗时**: ${(r.duration / 1000).toFixed(1)}s\n`;
		if (r.details.matchedKeywords.length > 0) {
			md += `- **关键词命中**: ${r.details.matchedKeywords.join(', ')}\n`;
		}
		if (r.details.sentinelHits.length > 0) {
			md += `- **Sentinel 命中**: ${r.details.sentinelHits.join(', ')}\n`;
		}
		md += '\n';
	}

	return md;
}

// ─── 结果保存 ───────────────────────────────────────────────

function saveResults(results) {
	try {
		const payload = {
			timestamp: new Date().toISOString(),
			summary: {
				total: results.length,
				passed: results.filter(r => r.total >= 60 && !r.error).length,
				avgScore: results.length > 0
					? Math.round(results.reduce((s, r) => s + r.total, 0) / results.length)
					: 0,
			},
			cases: results,
		};

		const filepath = saveScorerResult(payload, RESULTS_DIR);
		console.log(`结果已保存: ${filepath}`);
	} catch (e) {
		console.error(`保存结果失败: ${e.message}`);
	}
}

// ─── 主流程 ───────────────────────────────────────────────

async function main() {
	// 解析命令行参数
	const args = process.argv.slice(2);
	const onlyArg = args.find(a => a.startsWith('--only='));
	const reportMode = args.includes('--report');
	const onlyIds = onlyArg
		? onlyArg.split('=')[1].split(',').map(s => s.trim())
		: null;

	// 如果只传了位置参数作为查询（向后兼容旧用法）
	const positionalArgs = args.filter(a => !a.startsWith('--'));
	const customQuery = positionalArgs.length > 0 ? positionalArgs.join(' ') : null;

	// 加载数据集
	let dataset;
	try {
		const raw = readFileSync(DATASET_PATH, 'utf-8');
		dataset = JSON.parse(raw);
	} catch (e) {
		console.error(`无法加载数据集: ${DATASET_PATH}`);
		console.error(e.message);
		process.exit(1);
	}

	console.log(`数据集: ${dataset.cases.length} 条用例 (version ${dataset.version})`);

	// 连接 Obsidian
	console.log('连接 Obsidian...');
	try {
		await ensureEvalBackdoor();
		console.log('evalBackdoor 就绪');
	} catch (e) {
		console.error(`连接失败: ${e.message}`);
		console.error('');
		console.error('请确认:');
		console.error('  1. Obsidian 已启动并打开了 test-vault');
		console.error('  2. 插件 deepreader-dev 已加载');
		console.error('  3. 已运行 npm run deploy');
		process.exit(1);
	}

	// 自定义查询模式
	if (customQuery) {
		console.log(`运行自定义查询: "${customQuery}"`);
		const t0 = Date.now();
		const result = await runSingleQa('custom', customQuery, null, null);
		const duration = Date.now() - t0;

		if (!result) {
			console.error('超时无响应');
			process.exit(1);
		}
		if (result.error) {
			console.error(`错误: ${result.error}`);
			process.exit(1);
		}

		console.log('');
		console.log(`回复 (${result.response.length} 字符, ${(duration / 1000).toFixed(1)}s):`);
		console.log(result.response);
		process.exit(0);
	}

	// 筛选用例
	let cases = dataset.cases;
	if (onlyIds) {
		cases = cases.filter(c => onlyIds.includes(c.id));
		if (cases.length === 0) {
			console.error(`未找到指定用例: ${onlyIds.join(', ')}`);
			console.error(`可用: ${dataset.cases.map(c => c.id).join(', ')}`);
			process.exit(1);
		}
	}

	console.log(`待评估: ${cases.length} 条用例`);
	console.log('');

	// 逐条评估
	const results = [];

	for (const c of cases) {
		const t0 = Date.now();
		console.log(`[${c.id}] ${c.category}: "${c.question}"`);

		// 前置条件: 书籍索引检查
		if (c.bookId) {
			const hasIndex = await evalObsidian(`(() => {
				const adapter = app.vault.adapter;
				return (async () => {
					const metaPath = '.obsidian/plugins/deepreader-dev/pageindex/' + ${JSON.stringify(c.bookId)} + '/book-meta.json';
					return adapter.exists(metaPath);
				})();
			})()`);

			if (!hasIndex) {
				console.log(`  跳过: 书籍 ${c.bookId} 未索引`);
				results.push({
					id: c.id,
					category: c.category,
					question: c.question,
					error: `书籍 ${c.bookId} 未索引`,
					total: 0,
					scores: {},
					details: { matchedKeywords: [], sentinelHits: [] },
					expectedKeywords: c.expectedKeywords || [],
				});
				continue;
			}
		}

		// 运行问答
		const response = await runSingleQa(c.id, c.question, c.bookId, c.precondition?.history || null);
		const duration = Date.now() - t0;

		if (!response) {
			console.log(`  超时 (${(duration / 1000).toFixed(1)}s)`);
			results.push({
				id: c.id,
				category: c.category,
				question: c.question,
				error: '超时无响应',
				total: 0,
				scores: {},
				details: { matchedKeywords: [], sentinelHits: [] },
				expectedKeywords: c.expectedKeywords || [],
				duration,
			});
			continue;
		}

		if (response.error) {
			console.log(`  错误: ${response.error}`);
			results.push({
				id: c.id,
				category: c.category,
				question: c.question,
				error: response.error,
				total: 0,
				scores: {},
				details: { matchedKeywords: [], sentinelHits: [] },
				expectedKeywords: c.expectedKeywords || [],
				duration,
			});
			continue;
		}

		const responseText = response.response || '';
		const evaluation = evaluateQaQuality(responseText, {
			depth: c.depth,
			expectedKeywords: c.expectedKeywords,
			mustNotContain: c.mustNotContain || [],
			scoringOverrides: c.scoringOverrides,
		});

		const grade = getGrade(evaluation.total);
		console.log(
			`  ACC:${evaluation.scores.ACC}/30 REL:${evaluation.scores.REL}/20 ` +
			`COM:${evaluation.scores.COM}/15 REF:${evaluation.scores.REF}/15 ` +
			`SAF:${evaluation.scores.SAF}/10 STY:${evaluation.scores.STY}/10` +
			` | 总分 ${evaluation.total}/100 ${grade.label}`
		);

		if (evaluation.details.matchedKeywords.length > 0) {
			console.log(`  关键词命中: ${JSON.stringify(evaluation.details.matchedKeywords)}`);
		}

		results.push({
			id: c.id,
			category: c.category,
			question: c.question,
			response: responseText,
			responseLength: responseText.length,
			duration,
			total: evaluation.total,
			scores: evaluation.scores,
			details: evaluation.details,
			expectedKeywords: c.expectedKeywords || [],
			traceData: response.traceData || null,
		});

		// 用例间冷却
		if (cases.indexOf(c) < cases.length - 1) {
			await new Promise(resolve => setTimeout(resolve, COOLDOWN_MS));
		}
	}

	// 输出报告
	console.log('');
	if (reportMode) {
		console.log(formatMarkdownReport(results));
	} else {
		printConsoleReport(results);
	}

	// 保存结果
	saveResults(results);

	// 退出码: 所有通过则 0，否则 1
	const failCount = results.filter(r => r.total < 60 || r.error).length;
	process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => {
	console.error(`致命错误: ${e.message}`);
	console.error(e.stack);
	process.exit(2);
});
