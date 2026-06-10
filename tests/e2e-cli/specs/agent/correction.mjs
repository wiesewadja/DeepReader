/**
 * 奚童纠正检测质量评估
 *
 * 验证：用户表达"你说得不对/再找找"时，router 检测到纠正意图，升级到 depth=2
 * 路由预期：第一轮正常回复 → 第二轮"不对"触发纠正 → depth 升级到 2 → 重新搜索
 * 前置：插件加载 + API Key + 纳瓦尔宝典已索引
 */

import { evaluate } from '../../lib/cli-client.mjs';
import { checkBaseline } from '../../lib/baseline.mjs';
import { PLUGIN_ID } from '../../../lib/constants.mjs';

const BOOK_ID = '74dca606';

// ---------------------------------------------------------------------------
// 六维评分函数（纠正场景版本）
// ---------------------------------------------------------------------------

function evaluateCorrectionQuality(response, options = {}) {
	const { expectedKeywords = [] } = options;
	const scores = {};
	const matched = expectedKeywords.filter(kw => response.includes(kw));
	const SENTINEL = [
		'作为一个AI', '作为人工智能',
		'PROMPT_S0_ROUTER', 'buildFormatterSystemPrompt',
		'LangGraph', 'system prompt',
	];
	const sentinelHits = SENTINEL.filter(w => response.includes(w));

	// ACC (30 分): 关键词命中率
	const accRatio = expectedKeywords.length > 0
		? matched.length / expectedKeywords.length : 1;
	scores.ACC = accRatio >= 0.8 ? 30
		: accRatio >= 0.5 ? 20
		: accRatio > 0 ? 10 : 0;

	// REL (20 分): 前 800 字符关键词召回
	const head = response.slice(0, 800);
	const relRatio = expectedKeywords.filter(kw => head.includes(kw)).length
		/ Math.max(expectedKeywords.length, 1);
	scores.REL = relRatio >= 0.8 ? 20
		: relRatio >= 0.5 ? 15
		: relRatio > 0 ? 10 : 0;

	// COM (15 分): 纠正后回复应该更充实
	const hasStructure = /#{1,3}\s|\n[-*]\s|\n\d+\.\s/.test(response);
	if (response.length >= 300 && hasStructure) scores.COM = 15;
	else if (response.length >= 200) scores.COM = 10;
	else if (response.length >= 30) scores.COM = 5;
	else scores.COM = 0;

	// REF (15 分): 纠正后应有引用
	const wikiBlockLinks = (response.match(/\[\[[^\]]+#\^[\w-]+[^\]]*\]\]/g) || []);
	const wikiPlainLinks = (response.match(/\[\[[^\]]+\]\]/g) || []);
	if (wikiBlockLinks.length >= 1) scores.REF = 15;
	else if (wikiPlainLinks.length >= 1) scores.REF = 10;
	else scores.REF = 5; // 纠正场景允许无链接但扣分

	// SAF (10 分)
	scores.SAF = sentinelHits.length === 0 ? 10
		: sentinelHits.length <= 1 ? 5 : 0;

	// STY (10 分): 风格
	const hasGuidance = /建议|你可以|进一步|尝试|推荐/.test(response);
	scores.STY = hasStructure && hasGuidance ? 10
		: hasStructure || hasGuidance ? 7 : 5;

	return {
		scores,
		total: Object.values(scores).reduce((a, b) => a + b, 0),
		details: {
			matchedKeywords: matched,
			sentinelHits,
			wikiBlockLinks,
			wikiPlainLinks,
		},
	};
}

// ---------------------------------------------------------------------------
// evalBackdoor 注册
// ---------------------------------------------------------------------------

async function ensureEvalBackdoor() {
	await evaluate(`(() => {
		const plugin = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}];
		if (!plugin.evalBackdoor) {
			const pending = {};
			plugin.evalBackdoor = {
				startQnA(id, question, bookId) {
					const adapter = app.vault.adapter;
					const agent = plugin.frontendAgent;
					(async () => {
						let docMeta = {};
						if (bookId) {
							const metaPath = ${JSON.stringify(`.obsidian/plugins/${PLUGIN_ID}/pageindex/`)} + bookId + '/book-meta.json';
							const exists = await adapter.exists(metaPath);
							if (exists) {
								const raw = await adapter.read(metaPath);
								docMeta = JSON.parse(raw);
							}
						}
						const context = bookId
							? {
								vault: { app, plugin },
								book: { indexId: bookId, pdfName: docMeta.title || '', documentMetadata: docMeta },
								mode: 'normal',
							}
							: {
								vault: { app, plugin },
								book: null,
								mode: 'normal',
							};
						try {
							const result = await agent.runGraphEngine(question, context, {
								onProgress: () => {},
								onContent: () => {},
								onComplete: () => {},
								onError: () => {},
							});
							pending[id] = {
								response: result?.messages?.slice(-1)[0]?.content || '',
								traceData: result?.traceData,
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

// ---------------------------------------------------------------------------
// 发送问题并轮询结果
// ---------------------------------------------------------------------------

async function sendAndWait(question, bookId, timeoutMs = 120_000) {
	const qId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

	await evaluate(`(() => {
		app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].evalBackdoor.startQnA(
			${JSON.stringify(qId)}, ${JSON.stringify(question)}, ${bookId ? JSON.stringify(bookId) : 'null'}
		);
		return true;
	})()`);

	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const r = await evaluate(
				`app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}].evalBackdoor.pollResult(${JSON.stringify(qId)})`
			);
			if (r) return r;
		} catch { /* poll error, retry */ }
		await new Promise(resolve => setTimeout(resolve, 3_000));
	}
	return null;
}

// ---------------------------------------------------------------------------
// 纠正测试用例
// ---------------------------------------------------------------------------

const CORRECTION_CASES = [
	{
		// 第一轮问题（铺垫）
		firstQuestion: '纳瓦尔宝典中关于杠杆的内容是什么？',
		// 第二轮纠正消息
		correctionMessage: '不对，杠杆那个章节你再找找',
		bookId: BOOK_ID,
		riskType: 'correction',
		expectedKeywords: ['杠杆'],
		minLength: 200,
		minScore: 60,
	},
];

// ---------------------------------------------------------------------------
// Spec 定义
// ---------------------------------------------------------------------------

const spec = {
	id: 'agent-correction',
	name: '奚童纠正检测质量评估',
	timeout: 180_000,

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

		// 1. 基线检查
		await step('基线检查', async () => {
			const bl = await checkBaseline({
				bookId: BOOK_ID,
				indexComplete: true,
			});
			if (!bl.ok) throw new Error(`前置不满足: ${bl.missing.join('; ')}`);
			const hasApiKey = await evaluate(`(() => {
				const s = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.settings;
				const providers = s?.providers || {};
				return Object.values(providers).some(p => !!p.apiKey);
			})()`);
			if (!hasApiKey) throw new Error('未配置任何 LLM API Key');
			return `API Key + ${BOOK_ID} 完整索引就绪`;
		});

		// 2. 注册 evalBackdoor
		await step('注册 evalBackdoor', async () => {
			await ensureEvalBackdoor();
			return 'evalBackdoor 就绪';
		});

		// 3. 纠正场景测试
		for (const tc of CORRECTION_CASES) {
			// 3a. 第一轮：发送初始问题
			let firstResponse = '';
			await step(`第一轮: "${tc.firstQuestion}"`, async () => {
				const result = await sendAndWait(tc.firstQuestion, tc.bookId, 120_000);

				if (!result) throw new Error('第一轮超时无响应');
				if (result.error) throw new Error(`第一轮 Agent 错误: ${result.error}`);

				firstResponse = result.response || '';
				if (firstResponse.length < 10) {
					throw new Error(`第一轮回复过短 (${firstResponse.length} 字符)`);
				}

				return `第一轮回复 ${firstResponse.length} 字符`;
			});

			// 3b. 第二轮：发送纠正消息
			await step(`纠正: "${tc.correctionMessage}"`, async () => {
				const result = await sendAndWait(tc.correctionMessage, tc.bookId, 120_000);

				if (!result) throw new Error('第二轮超时无响应');
				if (result.error) throw new Error(`第二轮 Agent 错误: ${result.error}`);

				const response = result.response || '';
				if (response.length < 10) {
					throw new Error(`第二轮回复过短 (${response.length} 字符): ${response.slice(0, 200)}`);
				}

				// 长度检查 — 纠正后的回复应比简短承认更充实
				if (tc.minLength && response.length < tc.minLength) {
					throw new Error(
						`纠正后回复长度 ${response.length} 低于要求 ${tc.minLength}: ${response.slice(0, 200)}`
					);
				}

				const qa = evaluateCorrectionQuality(response, {
					expectedKeywords: tc.expectedKeywords,
				});

				const lines = [
					`得分 ${qa.total}/100`,
					`  ACC=${qa.scores.ACC} REL=${qa.scores.REL} COM=${qa.scores.COM}`,
					`  REF=${qa.scores.REF} SAF=${qa.scores.SAF} STY=${qa.scores.STY}`,
				];
				if (qa.details.matchedKeywords.length > 0) {
					lines.push(`  命中关键词: ${qa.details.matchedKeywords.join(', ')}`);
				}
				if (qa.details.sentinelHits.length > 0) {
					lines.push(`  sentinel 命中: ${qa.details.sentinelHits.join(', ')}`);
				}
				if (qa.details.wikiBlockLinks.length > 0) {
					lines.push(`  wiki block 链接: ${qa.details.wikiBlockLinks.length} 个`);
				}

				if (qa.total < tc.minScore) {
					lines.push(`  回复内容: ${response.slice(0, 300)}`);
					throw new Error(`${lines.join('\n')} — 低于及格线 ${tc.minScore}`);
				}

				return lines.join('\n');
			});
		}

		return { steps };
	},
};

// ---------------------------------------------------------------------------
// 独立运行支持
// ---------------------------------------------------------------------------
const url = import.meta.url;
if (process.argv[1] && url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
	console.log(`\n=== ${spec.name} ===`);
	try {
		const result = await spec.run();
		for (const s of result.steps) {
			const icon = s.status === 'pass' ? '✓' : '✗';
			const detail = s.detail ? '\n    ' + s.detail.replace(/\n/g, '\n    ') : '';
			const error = s.error ? ` — ${s.error}` : '';
			console.log(`  ${icon} ${s.name} (${s.duration}ms)${detail}${error}`);
		}
		console.log();
	} catch (e) {
		console.error(`\n✗ 测试失败: ${e.message}\n`);
		process.exit(1);
	}
}

export default spec;
