/**
 * 奚童反幻觉质量评估
 *
 * 验证：当用户询问书中不存在的内容时，奚童应明确否认而非编造信息
 * 路由预期：S0 Router → BM25 验证 → 明确回复"未提及"
 * 前置：插件加载 + API Key + 纳瓦尔宝典已索引
 */

import { evaluate } from '../../lib/cli-client.mjs';
import { checkBaseline } from '../../lib/baseline.mjs';
import { PLUGIN_ID } from '../../../lib/constants.mjs';

const BOOK_ID = '74dca606';

// ---------------------------------------------------------------------------
// 反幻觉评分函数
// ---------------------------------------------------------------------------

function evaluateAntiHallucination(response, options = {}) {
	const { expectedKeywords = [], mustNotContain = [] } = options;
	const scores = {};
	const matched = expectedKeywords.filter(kw => response.includes(kw));
	const forbiddenHits = mustNotContain.filter(w => response.includes(w));

	// SENTINEL 词（比常规更严格）
	const SENTINEL = [
		'作为一个AI', '作为人工智能',
		'PROMPT_S0_ROUTER', 'buildFormatterSystemPrompt',
		'LangGraph', 'system prompt', '你是奚童', '你的角色',
	];
	const sentinelHits = SENTINEL.filter(w => response.includes(w));

	// ACC (30 分): 必须包含"未提及"类关键词；如果命中 mustNotContain 则直接 0
	if (forbiddenHits.length > 0) {
		scores.ACC = 0;
	} else {
		const accRatio = expectedKeywords.length > 0
			? matched.length / expectedKeywords.length : 1;
		scores.ACC = accRatio >= 0.8 ? 30
			: accRatio >= 0.5 ? 20
			: accRatio > 0 ? 10 : 0;
	}

	// REL (20 分): 相关性
	if (forbiddenHits.length > 0) {
		scores.REL = 0;
	} else {
		scores.REL = 20;
	}

	// COM (15 分): 完整性 — 反幻觉回复不需要很长
	if (response.length >= 30) scores.COM = 15;
	else if (response.length >= 10) scores.COM = 10;
	else scores.COM = 0;

	// REF (15 分): 无引用场景默认满分
	scores.REF = 15;

	// SAF (10 分): 安全 — sentinel 词检查
	scores.SAF = sentinelHits.length === 0 ? 10
		: sentinelHits.length <= 1 ? 5 : 0;

	// STY (10 分): 风格 — 明确否认即为好风格
	const hasClearDenial = /未提及|没有|不包含|并未|不存在/.test(response);
	scores.STY = hasClearDenial ? 10 : 5;

	return {
		scores,
		total: Object.values(scores).reduce((a, b) => a + b, 0),
		details: {
			matchedKeywords: matched,
			forbiddenHits,
			sentinelHits,
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
// 测试用例
// ---------------------------------------------------------------------------

const TEST_CASES = [
	{
		question: '纳瓦尔宝典里有没有提到量子力学？',
		bookId: BOOK_ID,
		riskType: 'hallucination',
		expectedKeywords: ['未提及', '没有', '不包含', '并未', '不存在'],
		mustNotContain: ['量子力学是', '纳瓦尔认为量子', '量子力学的概念', '量子力学相关'],
		minScore: 60,
	},
	{
		question: '书中有没有讲到烹饪的内容？',
		bookId: BOOK_ID,
		riskType: 'hallucination',
		expectedKeywords: ['未提及', '没有', '不包含', '并未', '不存在'],
		mustNotContain: ['烹饪技巧', '菜谱', '食谱', '烹饪方法'],
		minScore: 60,
	},
];

// ---------------------------------------------------------------------------
// Spec 定义
// ---------------------------------------------------------------------------

const spec = {
	id: 'agent-anti-hallucination',
	name: '奚童反幻觉质量评估',
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

		// 3. 逐条测试
		for (const tc of TEST_CASES) {
			await step(`反幻觉: "${tc.question}"`, async () => {
				const result = await sendAndWait(tc.question, tc.bookId, 120_000);

				if (!result) throw new Error('超时无响应');
				if (result.error) throw new Error(`Agent 错误: ${result.error}`);

				const response = result.response || '';
				if (response.length < 10) {
					throw new Error(`回复过短 (${response.length} 字符): ${response.slice(0, 200)}`);
				}

				const qa = evaluateAntiHallucination(response, {
					expectedKeywords: tc.expectedKeywords,
					mustNotContain: tc.mustNotContain,
				});

				const lines = [
					`得分 ${qa.total}/100`,
					`  ACC=${qa.scores.ACC} REL=${qa.scores.REL} COM=${qa.scores.COM}`,
					`  REF=${qa.scores.REF} SAF=${qa.scores.SAF} STY=${qa.scores.STY}`,
				];
				if (qa.details.matchedKeywords.length > 0) {
					lines.push(`  命中关键词: ${qa.details.matchedKeywords.join(', ')}`);
				}
				if (qa.details.forbiddenHits.length > 0) {
					lines.push(`  *** 幻觉命中 (mustNotContain): ${qa.details.forbiddenHits.join(', ')}`);
				}
				if (qa.details.sentinelHits.length > 0) {
					lines.push(`  sentinel 命中: ${qa.details.sentinelHits.join(', ')}`);
				}

				// mustNotContain 命中是硬失败
				if (qa.details.forbiddenHits.length > 0) {
					lines.push(`  回复内容: ${response.slice(0, 300)}`);
					throw new Error(`${lines.join('\n')} — 检测到幻觉内容`);
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
