/**
 * 奚童闲聊质量评估 — depth=0
 *
 * 验证：无书籍上下文时，奚童能正确闲聊、自我介绍、礼貌回应
 * 路由预期：S0 Router → S4 Formatter（无搜索工具调用）
 * 前置：插件加载 + API Key 配置
 */

import { evaluate } from '../../lib/cli-client.mjs';
import { checkBaseline } from '../../lib/baseline.mjs';
import { PLUGIN_ID } from '../../../lib/constants.mjs';

// ---------------------------------------------------------------------------
// 六维评分函数
// ---------------------------------------------------------------------------

function evaluateQaQuality(response, options = {}) {
	const { depth = 0, expectedKeywords = [] } = options;
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

	// COM (15 分): 完整性
	const hasStructure = /#{1,3}\s|\n[-*]\s|\n\d+\.\s/.test(response);
	const minLen = depth >= 2 ? 500 : depth >= 1 ? 200 : 30;
	if (response.length >= minLen && hasStructure) scores.COM = 15;
	else if (response.length >= minLen * 0.6) scores.COM = 10;
	else if (response.length >= 30) scores.COM = 5;
	else scores.COM = 0;

	// REF (15 分): 引用 — depth<=1 默认满分
	scores.REF = 15;

	// SAF (10 分): 安全
	scores.SAF = sentinelHits.length === 0 ? 10
		: sentinelHits.length <= 1 ? 5 : 0;

	// STY (10 分): 风格
	const hasGuidance = /建议|你可以|进一步|尝试|推荐/.test(response);
	scores.STY = hasStructure && hasGuidance ? 10
		: hasStructure || hasGuidance ? 7 : 5;

	return {
		scores,
		total: Object.values(scores).reduce((a, b) => a + b, 0),
		details: { matchedKeywords: matched, sentinelHits },
	};
}

// ---------------------------------------------------------------------------
// evalBackdoor 注册（注入到插件实例）
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

async function sendAndWait(question, bookId, timeoutMs = 60_000) {
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
		question: '你好，你是谁？',
		bookId: null,
		expectedKeywords: ['奚童', '伴读'],
		minScore: 60,
	},
	{
		question: '今天能帮我做什么？',
		bookId: null,
		expectedKeywords: ['阅读', '书籍', '问答'],
		minScore: 60,
	},
	{
		question: '谢谢你的帮助',
		bookId: null,
		expectedKeywords: ['欢迎', '随时'],
		minScore: 60,
	},
];

// ---------------------------------------------------------------------------
// Spec 定义
// ---------------------------------------------------------------------------

const spec = {
	id: 'agent-casual-chat',
	name: '奚童闲聊质量评估',
	timeout: 120_000,

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
			const bl = await checkBaseline({});
			if (!bl.ok) throw new Error(`前置不满足: ${bl.missing.join('; ')}`);
			const hasApiKey = await evaluate(`(() => {
				const s = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.settings;
				const providers = s?.providers || {};
				return Object.values(providers).some(p => !!p.apiKey);
			})()`);
			if (!hasApiKey) throw new Error('未配置任何 LLM API Key');
			return 'API Key 已配置';
		});

		// 2. 注册 evalBackdoor
		await step('注册 evalBackdoor', async () => {
			await ensureEvalBackdoor();
			return 'evalBackdoor 就绪';
		});

		// 3. 逐条测试
		for (const tc of TEST_CASES) {
			await step(`Q: "${tc.question}"`, async () => {
				const result = await sendAndWait(tc.question, tc.bookId, 60_000);

				if (!result) throw new Error('超时无响应');
				if (result.error) throw new Error(`Agent 错误: ${result.error}`);

				const response = result.response || '';
				if (response.length < 10) {
					throw new Error(`回复过短 (${response.length} 字符): ${response.slice(0, 200)}`);
				}

				const qa = evaluateQaQuality(response, {
					depth: 0,
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

				if (qa.total < tc.minScore) {
					lines.push(`  回复内容: ${response.slice(0, 200)}`);
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
