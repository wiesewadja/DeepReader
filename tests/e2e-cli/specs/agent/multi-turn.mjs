/**
 * 奚童多轮上下文质量评估
 *
 * 验证：多轮对话中奚童能继承前文讨论的话题关键词，不丢失上下文
 * 场景 1: "杠杆的具体建议" → "继续展开讲讲" → 第二轮仍含杠杆关键词
 * 场景 2: "如何定义专长" → "还有呢？" → 第二轮仍含专长关键词
 * 前置：插件加载 + API Key + 纳瓦尔宝典已索引
 */

import { evaluate } from '../../lib/cli-client.mjs';
import { checkBaseline } from '../../lib/baseline.mjs';
import { PLUGIN_ID } from '../../../lib/constants.mjs';

const BOOK_ID = '74dca606';

// ---------------------------------------------------------------------------
// 六维评分函数（多轮版本 — 重点在 REL 上下文继承）
// ---------------------------------------------------------------------------

function evaluateMultiTurnQuality(response, options = {}) {
	const { expectedKeywords = [], contextKeywords = [] } = options;
	const scores = {};
	const matched = expectedKeywords.filter(kw => response.includes(kw));
	const contextMatched = contextKeywords.filter(kw => response.includes(kw));
	const SENTINEL = [
		'作为一个AI', '作为人工智能',
		'PROMPT_S0_ROUTER', 'buildFormatterSystemPrompt',
		'LangGraph', 'system prompt',
	];
	const sentinelHits = SENTINEL.filter(w => response.includes(w));

	// ACC (30 分): 预期关键词命中
	const accRatio = expectedKeywords.length > 0
		? matched.length / expectedKeywords.length : 1;
	scores.ACC = accRatio >= 0.8 ? 30
		: accRatio >= 0.5 ? 20
		: accRatio > 0 ? 10 : 0;

	// REL (20 分): 上下文继承 — 第二轮必须包含前文讨论的关键词
	if (contextKeywords.length > 0) {
		const relRatio = contextMatched.length / contextKeywords.length;
		scores.REL = relRatio >= 0.8 ? 20
			: relRatio >= 0.5 ? 15
			: relRatio > 0 ? 10 : 0;
	} else {
		scores.REL = 20;
	}

	// COM (15 分)
	const hasStructure = /#{1,3}\s|\n[-*]\s|\n\d+\.\s/.test(response);
	if (response.length >= 300 && hasStructure) scores.COM = 15;
	else if (response.length >= 200) scores.COM = 10;
	else if (response.length >= 30) scores.COM = 5;
	else scores.COM = 0;

	// REF (15 分): 多轮对话可能有 wiki 链接
	const wikiBlockLinks = (response.match(/\[\[[^\]]+#\^[\w-]+[^\]]*\]\]/g) || []);
	const wikiPlainLinks = (response.match(/\[\[[^\]]+\]\]/g) || []);
	if (wikiBlockLinks.length >= 1) scores.REF = 15;
	else if (wikiPlainLinks.length >= 1) scores.REF = 10;
	else scores.REF = 5;

	// SAF (10 分)
	scores.SAF = sentinelHits.length === 0 ? 10
		: sentinelHits.length <= 1 ? 5 : 0;

	// STY (10 分)
	const hasGuidance = /建议|你可以|进一步|尝试|推荐/.test(response);
	scores.STY = hasStructure && hasGuidance ? 10
		: hasStructure || hasGuidance ? 7 : 5;

	return {
		scores,
		total: Object.values(scores).reduce((a, b) => a + b, 0),
		details: {
			matchedKeywords: matched,
			contextMatched,
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
// 多轮测试场景
// ---------------------------------------------------------------------------

const MULTI_TURN_CASES = [
	{
		name: '杠杆 → 继续展开',
		firstQuestion: '纳瓦尔宝典中关于杠杆的具体建议有哪些？',
		followUp: '继续展开讲讲',
		bookId: BOOK_ID,
		contextKeywords: ['杠杆', '股权'],
		expectedKeywords: ['杠杆', '资本', '劳动力', '代码', '媒体'],
		minScore: 60,
	},
	{
		name: '专长 → 还有呢',
		firstQuestion: '纳瓦尔如何定义专长？',
		followUp: '还有呢？',
		bookId: BOOK_ID,
		contextKeywords: ['专长'],
		expectedKeywords: ['专长', '知识', '独特', '技能'],
		minScore: 60,
	},
];

// ---------------------------------------------------------------------------
// Spec 定义
// ---------------------------------------------------------------------------

const spec = {
	id: 'agent-multi-turn',
	name: '奚童多轮上下文质量评估',
	timeout: 300_000,

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

		// 3. 多轮测试场景
		for (const tc of MULTI_TURN_CASES) {
			// 3a. 第一轮
			let firstResponse = '';
			await step(`[${tc.name}] 第一轮: "${tc.firstQuestion}"`, async () => {
				const result = await sendAndWait(tc.firstQuestion, tc.bookId, 120_000);

				if (!result) throw new Error('第一轮超时无响应');
				if (result.error) throw new Error(`第一轮 Agent 错误: ${result.error}`);

				firstResponse = result.response || '';
				if (firstResponse.length < 10) {
					throw new Error(`第一轮回复过短 (${firstResponse.length} 字符)`);
				}

				return `第一轮回复 ${firstResponse.length} 字符`;
			});

			// 3b. 第二轮 — 验证上下文继承
			await step(`[${tc.name}] 跟进: "${tc.followUp}"`, async () => {
				const result = await sendAndWait(tc.followUp, tc.bookId, 120_000);

				if (!result) throw new Error('第二轮超时无响应');
				if (result.error) throw new Error(`第二轮 Agent 错误: ${result.error}`);

				const response = result.response || '';
				if (response.length < 10) {
					throw new Error(`第二轮回复过短 (${response.length} 字符): ${response.slice(0, 200)}`);
				}

				const qa = evaluateMultiTurnQuality(response, {
					expectedKeywords: tc.expectedKeywords,
					contextKeywords: tc.contextKeywords,
				});

				const lines = [
					`得分 ${qa.total}/100`,
					`  ACC=${qa.scores.ACC} REL=${qa.scores.REL} COM=${qa.scores.COM}`,
					`  REF=${qa.scores.REF} SAF=${qa.scores.SAF} STY=${qa.scores.STY}`,
				];
				if (qa.details.matchedKeywords.length > 0) {
					lines.push(`  命中关键词: ${qa.details.matchedKeywords.join(', ')}`);
				}
				if (qa.details.contextMatched.length > 0) {
					lines.push(`  上下文继承: ${qa.details.contextMatched.join(', ')}`);
				}
				if (qa.details.contextMatched.length === 0 && tc.contextKeywords.length > 0) {
					lines.push(`  *** 上下文丢失: 期望 [${tc.contextKeywords.join(', ')}] 但未命中`);
				}
				if (qa.details.sentinelHits.length > 0) {
					lines.push(`  sentinel 命中: ${qa.details.sentinelHits.join(', ')}`);
				}
				if (qa.details.wikiBlockLinks.length > 0) {
					lines.push(`  wiki block 链接: ${qa.details.wikiBlockLinks.length} 个`);
				}

				// 上下文丢失 — REL=0 时视为严重问题
				if (qa.scores.REL === 0 && tc.contextKeywords.length > 0) {
					lines.push(`  回复内容: ${response.slice(0, 300)}`);
					throw new Error(`${lines.join('\n')} — 上下文丢失 (REL=0)`);
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
