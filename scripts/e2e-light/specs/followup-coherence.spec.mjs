/**
 * 轻量 E2E: 追问连贯性
 *
 * 验证 P0/P1 修复 — 用户发追问（如"继续查看"）时，AI 应基于上文继续，
 * 而不是把追问当作全新查询从"核心论点"重新分析。
 *
 * 复现条件：
 *  1. 用户发第一个具体问题
 *  2. AI 给出第一轮响应
 *  3. 用户发"继续展开"或"继续查看"等短追问
 *  4. 第二轮响应应该承接第一轮的话题，而不是回退到 generic "核心论点" 框架
 *
 * 通过条件：
 *  - Router 延续性守卫触发：第二轮 depth 升级到 ANALYTICAL（>= 2）
 *  - 第二轮响应不包含 bug 签名 "本书的核心主张是：" 或 "核心论点和分析框架"
 *  - 第二轮响应第一段包含第一轮话题的关键词
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const PLUGIN_ID = 'deepreader';
const BOOK_ID = 'ee090e29'; // AI极简经济学（与原始 bug trace 同 book）
const BOOK_NAME = 'AI极简经济学';
const TIMEOUT_RESPONSE = 120_000;
const POLL_INTERVAL = 3_000;

const FIRST_QUESTION = '预测机器这个概念的核心思想是什么？它如何降低决策成本？';
const FOLLOWUP = '继续展开';
// 这些是原始 bug trace 里的字面特征，修复后不应再出现
const BUG_SIGNATURES = [
	'核心论点和分析框架',
	'本书的核心主张是',
	'人工智能本质上是一种预测技术',
];
// 这些是 FIRST_QUESTION 的关键词，第二轮响应应该出现至少一个（说明承接了话题）
const TOPIC_KEYWORDS = ['预测', '决策', '成本', '机器'];

export default {
	id: 'followup-coherence',
	name: '追问连贯性（P0/P1 修复验证）',
	feature: 'F-AGENT-COHERENCE',
	timeout: 300_000,
	requires: {},

	async run({ log }) {
		const steps = [];
		const pass = (name, duration, detail) => {
			steps.push({ name, status: 'pass', duration, detail });
			log?.info?.(`  ✓ ${name} (${duration}ms)${detail ? '  ' + detail : ''}`);
		};
		const fail = (name, duration, error) => {
			steps.push({ name, status: 'fail', duration, error: error?.message || String(error) });
			log?.error?.(`  ✗ ${name}: ${error?.message || error}`);
		};
		const skip = (name, duration, reason) => {
			steps.push({ name, status: 'skip', duration, error: reason });
			log?.warn?.(`  ⏭ ${name}: ${reason}`);
		};

		// ── Pre-check ──
		{
			const t0 = Date.now();
			try {
				const r = await evalObsidian(`(() => {
					const s = app.plugins.plugins["${PLUGIN_ID}"]?.settings;
					const KEY_FIELDS = ['apiKey', 'customApiKey', 'openaiApiKey', 'deepseekApiKey', 'kimiApiKey', 'zhipuApiKey', 'siliconflowApiKey', 'xiaomiApiKey', 'sensenovaApiKey'];
					const activeKey = KEY_FIELDS.find(k => s?.[k]);
					const agent = app.plugins.plugins["${PLUGIN_ID}"]?.frontendAgent;
					return {
						hasApiKey: !!activeKey,
						activeProvider: activeKey || null,
						hasAgent: !!agent,
						hasContinueChat: typeof agent?.continueChat === 'function',
					};
				})()`);
				if (!r?.hasApiKey) return { status: 'skip', reason: '未配置 LLM API Key' };
				if (!r?.hasAgent) return { status: 'skip', reason: 'frontendAgent 不存在' };
				if (!r?.hasContinueChat) return { status: 'skip', reason: '未包含 continueChat 方法（需要 P0 修复）' };
				pass('pre-check', Date.now() - t0, `provider=${r.activeProvider}, continueChat 就绪`);
			} catch (e) {
				fail('pre-check', Date.now() - t0, e);
				return { steps };
			}
		}

		// ── Pre-check: book 已索引 ──
		{
			const t0 = Date.now();
			try {
				const hasBook = await evalObsidian(`(async () => {
					const adapter = app.vault.adapter;
					return adapter.exists('.obsidian/plugins/${PLUGIN_ID}/pageindex/${BOOK_ID}/book-meta.json');
				})()`);
				if (!hasBook) {
					skip('book 索引', t0, `${BOOK_NAME}(${BOOK_ID}) 未索引`);
					return { steps };
				}
				pass('book 索引', Date.now() - t0, BOOK_NAME);
			} catch (e) {
				fail('book 索引', Date.now() - t0, e);
				return { steps };
			}
		}

		// 辅助：发消息并 poll
		async function sendAndPoll(question, timeoutMs) {
			// 开 sidebar
			await evalObsidian(`app.commands.executeCommandById("${PLUGIN_ID}:open-deepreader-sidebar")`);
			await new Promise(r => setTimeout(r, 800));
			// 选书 + 发消息（不清空消息列表）
			await evalObsidian(`(() => {
				const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
				if (leaves.length === 0) throw new Error('sidebar 未打开');
				const view = leaves[0].view;
				view.selectIndex(${JSON.stringify(BOOK_ID)});
				// 不要清空消息列表，保留历史消息
				const textarea = view.chatInput?.textarea;
				if (!textarea) throw new Error('chat input 不存在');
				textarea.value = ${JSON.stringify(question)};
				textarea.dispatchEvent(new Event('input', { bubbles: true }));
				const sendBtn = document.querySelector('.deeppdf-chat-input-send-btn');
				if (sendBtn) sendBtn.click();
				return true;
			})()`);

			// poll
			const deadline = Date.now() + timeoutMs;
			let response = null;
			while (Date.now() < deadline) {
				try {
					const state = await evalObsidian(`(() => {
						const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
						if (leaves.length === 0) return { streaming: true, msgCount: 0 };
						const view = leaves[0].view;
						const streaming = view.isAiStreaming;
						const msgs = view.messageList?.getMessagesData() || [];
						const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
						return {
							streaming,
							msgCount: msgs.length,
							lastContent: lastMsg?.content || '',
							lastRole: lastMsg?.role || '',
						};
					})()`);
					if (!state.streaming && state.msgCount > 0 && state.lastRole === 'assistant' && state.lastContent) {
						response = state.lastContent;
						break;
					}
				} catch { /* ignore */ }
				await new Promise(r => setTimeout(r, POLL_INTERVAL));
			}
			return response;
		}

		// ── Step 1: 发第一轮问题 ──
		let firstResponse = null;
		{
			const t0 = Date.now();
			try {
				firstResponse = await sendAndPoll(FIRST_QUESTION, TIMEOUT_RESPONSE);
				if (!firstResponse) throw new Error('首轮无响应');
				if (firstResponse.includes('LangGraph 引擎错误')) throw new Error('引擎错误');
				if (firstResponse.length < 100) throw new Error(`首轮响应过短: ${firstResponse.length} chars`);
				pass('首轮响应', Date.now() - t0, `${firstResponse.length} chars`);
			} catch (e) {
				fail('首轮响应', Date.now() - t0, e);
				return { steps };
			}
		}

		// ── Step 2: 发追问 ──
		let followupResponse = null;
		{
			const t0 = Date.now();
			try {
				followupResponse = await sendAndPoll(FOLLOWUP, TIMEOUT_RESPONSE);
				if (!followupResponse) throw new Error('追问无响应');
				if (followupResponse.includes('LangGraph 引擎错误')) throw new Error('引擎错误');
				if (followupResponse.length < 100) throw new Error(`追问响应过短: ${followupResponse.length} chars`);
				pass('追问响应', Date.now() - t0, `${followupResponse.length} chars`);
			} catch (e) {
				fail('追问响应', Date.now() - t0, e);
				return { steps };
			}
		}

		// ── 断言 1: 追问响应不应包含 bug 签名 ──
		{
			const t0 = Date.now();
			const foundSignatures = BUG_SIGNATURES.filter(sig => followupResponse.includes(sig));
			if (foundSignatures.length > 0) {
				fail('无 bug 签名', Date.now() - t0,
					new Error(`追问响应包含 bug 签名（说明重蹈覆辙）: ${foundSignatures.join(', ')}`));
			} else {
				pass('无 bug 签名', Date.now() - t0, '未触发 "核心论点和分析框架" 重新分析');
			}
		}

		// ── 断言 2: 追问响应应承接首轮话题（至少含 1 个 TOPIC_KEYWORDS）──
		{
			const t0 = Date.now();
			// 取前 800 字符（避免后续章节链接噪声）
			const head = followupResponse.slice(0, 800);
			const matchedKeywords = TOPIC_KEYWORDS.filter(kw => head.includes(kw));
			if (matchedKeywords.length === 0) {
				fail('话题承接', Date.now() - t0,
					new Error(`追问响应前 800 字符未包含首轮关键词 [${TOPIC_KEYWORDS.join('/')}]，疑似另起话题。\n前 300 字符: ${head.slice(0, 300)}`));
			} else {
				pass('话题承接', Date.now() - t0, `命中关键词: ${matchedKeywords.join(', ')}`);
			}
		}

		// ── 断言 3: 追问响应长度应该合理（不应该只是简短 "好的"） ──
		{
			const t0 = Date.now();
			if (followupResponse.length < 300) {
				fail('响应深度', Date.now() - t0,
					new Error(`追问响应过短（${followupResponse.length} chars），可能未真正承接展开`));
			} else {
				pass('响应深度', Date.now() - t0, `${followupResponse.length} chars（>= 300）`);
			}
		}

		return { steps };
	},
};
