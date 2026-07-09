/**
 * 轻量 E2E: LangGraph Agent 三层对话
 *
 * 对比: tests/e2e/specs/langgraph-agent.e2e.ts (623 行 WDIO)
 * 通过 sidebar chat API 发送消息，验证 depth=0/1/2 路由
 * 需要 LLM API Key + 已索引的书籍
 *
 * 集成 LangSmith trace：测试失败时自动显示 trace 信息
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';
import { startTraceCollection } from '../trace-helper.mjs';

const BOOKS = {
	aiEcon: { bookId: 'ee090e29', name: 'AI极简经济学' },
	crazy: { bookId: 'd2b30962', name: '疯传' },
};

const TIMEOUT_RESPONSE = 120_000;
const POLL_INTERVAL = 3_000;

export default {
	id: 'langgraph-agent',
	name: 'LangGraph Agent 三层对话',
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

		// 检查前置条件：LLM API Key + 已索引书籍
		const precheck = await evalObsidian(`(() => {
			const s = app.plugins.plugins["deepreader-dev"]?.settings;
			const providers = s?.providers || {};
			const hasApiKey = !!(s?.deepseekApiKey || s?.customApiKey || s?.openaiApiKey || Object.values(providers).some(p => !!p.apiKey));
			const agent = app.plugins.plugins["deepreader-dev"]?.frontendAgent;
			return { hasApiKey, hasAgent: !!agent };
		})()`);

		if (!precheck?.hasApiKey) {
			return { status: 'skip', reason: '未配置 LLM API Key' };
		}
		if (!precheck?.hasAgent) {
			return { status: 'skip', reason: 'frontendAgent 不存在' };
		}

		// 辅助：发送聊天消息并等待响应
		async function sendAndPoll(question, bookId, timeoutMs) {
			// 打开 sidebar + 选书 + 清空历史 + 发消息
			await evalObsidian(`(() => {
				app.commands.executeCommandById("deepreader-dev:open-deepreader-sidebar");
				return true;
			})()`);
			await new Promise(r => setTimeout(r, 1000));

			await evalObsidian(`(() => {
				const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
				if (leaves.length === 0) throw new Error('sidebar 未打开');
				const view = leaves[0].view;
				${bookId ? `if (typeof view.selectIndex === 'function') view.selectIndex(${JSON.stringify(bookId)});` : ''}
				// 不要清空消息列表，保留历史消息
				// 设置输入并发送
				const textarea = view.chatInput?.textarea;
				if (!textarea) throw new Error('chat input 不存在');
				textarea.value = ${JSON.stringify(question)};
				textarea.dispatchEvent(new Event('input', { bubbles: true }));
				// 点击发送
				const sendBtn = document.querySelector('.deeppdf-chat-input-send-btn');
				if (sendBtn) sendBtn.click();
				return true;
			})()`);

			// 轮询等待响应
			const deadline = Date.now() + timeoutMs;
			let response = null;
			while (Date.now() < deadline) {
				try {
					const state = await evalObsidian(`(() => {
						const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
						if (leaves.length === 0) return { streaming: false, msgCount: 0 };
						const view = leaves[0].view;
						const streaming = view.agentChatCtrl?.aiStreaming ?? view.isAiStreaming ?? false;
						const msgs = view.messageList?.getMessagesData() || [];
						const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
						return {
							streaming,
							msgCount: msgs.length,
							lastContent: lastMsg?.content?.slice(0, 100) || '',
							lastRole: lastMsg?.role || '',
						};
					})()`);
					if (!state.streaming && state.msgCount > 0 && state.lastRole === 'assistant' && state.lastContent.trim().length > 0) {
						response = state.lastContent;
						break;
					}
				} catch { /* ignore poll errors */ }
				await new Promise(r => setTimeout(r, POLL_INTERVAL));
			}
			return response;
		}

		// ===== depth=0: 闲聊 =====
		{
			const t0 = Date.now();
			const traceCollector = await startTraceCollection();
			try {
				const response = await sendAndPoll('你好，今天天气怎么样？', null, 30_000);
				if (!response) throw new Error('无响应');
				if (response.includes('LangGraph 引擎错误')) throw new Error('引擎错误');
				if (response.includes('API Key 未配置')) throw new Error('API Key 未配置');

				// 获取 trace 信息
				const traceSummary = await traceCollector.getTraceSummary();
				pass('depth=0 闲聊', Date.now() - t0, 
					traceSummary ? `${response.slice(0, 50)} | ${traceSummary}` : response.slice(0, 50));
			} catch (e) {
				// 测试失败时获取 trace 详情
				const traceDetails = await traceCollector.getTraceDetails();
				if (traceDetails?.length > 0) {
					const trace = traceDetails[0];
					e.context = `LangSmith trace: tokens=${trace.totalTokens}, 耗时=${(trace.executionTimeMs / 1000).toFixed(1)}s, status=${trace.status}`;
				}
				fail('depth=0 闲聊', Date.now() - t0, e);
			}
		}

		// ===== depth=1: 书籍概览 =====
		{
			const t0 = Date.now();
			const hasBook = await evalObsidian(`(() => {
				const adapter = app.vault.adapter;
				return adapter.exists('.obsidian/plugins/deepreader-dev/pageindex/${BOOKS.aiEcon.bookId}/book-meta.json');
			})()`);
			if (!hasBook) {
				steps.push({ name: 'depth=1 检视阅读', status: 'skip', duration: 0,
					error: `${BOOKS.aiEcon.name} 未索引` });
			} else {
				const traceCollector = await startTraceCollection();
				try {
					const response = await sendAndPoll(
						'《AI极简经济学》这本书主要讲了什么？', BOOKS.aiEcon.bookId, 60_000);
					if (!response) throw new Error('无响应');
					if (response.length < 50) throw new Error(`响应过短: ${response.length} chars`);
					if (response.includes('LangGraph 引擎错误')) throw new Error('引擎错误');

					const traceSummary = await traceCollector.getTraceSummary();
					pass('depth=1 检视阅读', Date.now() - t0, 
						traceSummary ? `${response.length} chars | ${traceSummary}` : `${response.length} chars`);
				} catch (e) {
					const traceDetails = await traceCollector.getTraceDetails();
					if (traceDetails?.length > 0) {
						const trace = traceDetails[0];
						e.context = `LangSmith trace: tokens=${trace.totalTokens}, 耗时=${(trace.executionTimeMs / 1000).toFixed(1)}s, status=${trace.status}`;
					}
					fail('depth=1 检视阅读', Date.now() - t0, e);
				}
			}
		}

		// ===== depth=2: 分析阅读 =====
		{
			const t0 = Date.now();
			const hasBook = await evalObsidian(`(() => {
				const adapter = app.vault.adapter;
				return adapter.exists('.obsidian/plugins/deepreader-dev/pageindex/${BOOKS.aiEcon.bookId}/book-meta.json');
			})()`);
			if (!hasBook) {
				steps.push({ name: 'depth=2 分析阅读', status: 'skip', duration: 0,
					error: `${BOOKS.aiEcon.name} 未索引` });
			} else {
				const traceCollector = await startTraceCollection();
				try {
					const response = await sendAndPoll(
						'《AI极简经济学》中关于人工智能对劳动力市场影响的讨论在哪个章节？',
						BOOKS.aiEcon.bookId, TIMEOUT_RESPONSE);
					if (!response) throw new Error('无响应');
					if (response.length < 100) throw new Error(`响应过短: ${response.length} chars`);
					if (response.includes('LangGraph 引擎错误')) throw new Error('引擎错误');

					const traceSummary = await traceCollector.getTraceSummary();
					pass('depth=2 分析阅读', Date.now() - t0, 
						traceSummary ? `${response.length} chars | ${traceSummary}` : `${response.length} chars`);
				} catch (e) {
					const traceDetails = await traceCollector.getTraceDetails();
					if (traceDetails?.length > 0) {
						const trace = traceDetails[0];
						e.context = `LangSmith trace: tokens=${trace.totalTokens}, 耗时=${(trace.executionTimeMs / 1000).toFixed(1)}s, status=${trace.status}`;
					}
					fail('depth=2 分析阅读', Date.now() - t0, e);
				}
			}
		}

		// ===== depth=1 第二本书: 疯传 =====
		{
			const t0 = Date.now();
			const hasBook = await evalObsidian(`(() => {
				const adapter = app.vault.adapter;
				return adapter.exists('.obsidian/plugins/deepreader-dev/pageindex/${BOOKS.crazy.bookId}/book-meta.json');
			})()`);
			if (!hasBook) {
				steps.push({ name: 'depth=1 疯传概览', status: 'skip', duration: 0,
					error: `${BOOKS.crazy.name} 未索引` });
			} else {
				const traceCollector = await startTraceCollection();
				try {
					const response = await sendAndPoll(
						'《疯传》这本书主要讲了什么内容？', BOOKS.crazy.bookId, 60_000);
					if (!response) throw new Error('无响应');
					if (response.length < 50) throw new Error(`响应过短: ${response.length} chars`);
					if (response.includes('LangGraph 引擎错误')) throw new Error('引擎错误');

					const traceSummary = await traceCollector.getTraceSummary();
					pass('depth=1 疯传概览', Date.now() - t0, 
						traceSummary ? `${response.length} chars | ${traceSummary}` : `${response.length} chars`);
				} catch (e) {
					const traceDetails = await traceCollector.getTraceDetails();
					if (traceDetails?.length > 0) {
						const trace = traceDetails[0];
						e.context = `LangSmith trace: tokens=${trace.totalTokens}, 耗时=${(trace.executionTimeMs / 1000).toFixed(1)}s, status=${trace.status}`;
					}
					fail('depth=1 疯传概览', Date.now() - t0, e);
				}
			}
		}

		// ===== 多轮对话 =====
		{
			const t0 = Date.now();
			const hasBook = await evalObsidian(`(() => {
				const adapter = app.vault.adapter;
				return adapter.exists('.obsidian/plugins/deepreader-dev/pageindex/${BOOKS.aiEcon.bookId}/book-meta.json');
			})()`);
			if (!hasBook) {
				steps.push({ name: '多轮对话', status: 'skip', duration: 0,
					error: `${BOOKS.aiEcon.name} 未索引` });
			} else {
				try {
					// 第一轮
					const response1 = await sendAndPoll(
						'《AI极简经济学》的核心观点是什么？', BOOKS.aiEcon.bookId, 60_000);
					if (!response1) throw new Error('第一轮无响应');
					pass('多轮对话-第一轮', Date.now() - t0, response1.slice(0, 50));

					// 第二轮（追问）
					const t1 = Date.now();
					const response2 = await sendAndPoll(
						'能详细解释一下吗？', null, 60_000);
					if (!response2) throw new Error('第二轮无响应');
					if (response2.length < 50) throw new Error(`第二轮响应过短: ${response2.length} chars`);
					pass('多轮对话-第二轮', Date.now() - t1, response2.slice(0, 50));
				} catch (e) {
					fail('多轮对话', Date.now() - t0, e);
				}
			}
		}

				return { steps };
	},
};
