/**
 * DeepReader 性能基准测试脚本
 * 通过 CDP 评估：
 * 1. 闲聊前置短路（CASUAL，0 规划 RTT 开销）
 * 2. 一体化路由规划（单 RTT 规划）
 * 3. 检索首轮（磁盘读取） vs 检索次轮（LRU 内存 Promise 缓存命中）
 */

import { evalObsidian } from '../smoke/lib/obsidian-cli.mjs';

async function delay(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function runBenchmark() {
	console.log('🚀 开始 DeepReader AI 回复性能基准测试 (CDP-based)...');

	// 1. 前置检查
	const precheck = await evalObsidian(`(() => {
		const s = app.plugins.plugins["deepreader-dev"]?.settings;
		const agent = app.plugins.plugins["deepreader-dev"]?.frontendAgent;
		return { hasApiKey: !!(s?.deepseekApiKey || s?.openaiApiKey || s?.customApiKey || s?.providers), hasAgent: !!agent };
	})()`);

	if (!precheck.hasAgent) {
		console.error('❌ 错误: 未能在 Obsidian 中检测到 frontendAgent，请确保插件已加载。');
		process.exit(1);
	}

	async function measure(question, label, bookId = null) {
		// 每次测试前加入 1.5s 冷却，确保上一次测试的状态和UI已完全就绪
		await delay(1500);

		console.log(`\n----------------------------------------`);
		console.log(`[测试场景] ${label}`);
		console.log(`[提问内容] "${question}"`);

		// 清空并发送
		await evalObsidian(`(async () => {
			const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
			if (leaves.length === 0) {
				const leaf = app.workspace.getRightLeaf(false);
				leaf.setViewState({ type: 'deeppdf-sidebar-view', active: true });
				await new Promise(r => setTimeout(r, 600));
			}
			const view = app.workspace.getLeavesOfType('deeppdf-sidebar-view')[0]?.view;
			if (!view) throw new Error('无法创建或获取 sidebar 视图');
			
			if (typeof view.selectIndex === 'function' && ${JSON.stringify(bookId)}) {
				view.selectIndex(${JSON.stringify(bookId)});
				await new Promise(r => setTimeout(r, 500));
			}
			
			if (typeof view.messageList?.clearMessages === 'function') {
				view.messageList.clearMessages();
				await new Promise(r => setTimeout(r, 400));
			}
			
			const textarea = view.chatInput?.textarea;
			if (!textarea) throw new Error('输入框未找到');
			
			// 确保输入框可用
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
			if (setter) {
				setter.call(textarea, ${JSON.stringify(question)});
			} else {
				textarea.value = ${JSON.stringify(question)};
			}
			textarea.dispatchEvent(new Event('input', { bubbles: true }));
			await new Promise(r => setTimeout(r, 300));
			
			const sendBtn = document.querySelector('.deeppdf-chat-input-send-btn');
			if (sendBtn) {
				sendBtn.click();
			}
			return true;
		})()`);

		const startTime = Date.now();
		let ttft = null;
		let totalTime = null;
		let responseText = '';
		
		// 轮询：以 200ms 间隔监控响应状态，并打印 polling 状态
		const maxDuration = 45_000;
		let lastLoggedLen = -1;
		while (Date.now() - startTime < maxDuration) {
			const state = await evalObsidian(`(() => {
				const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
				if (leaves.length === 0) return null;
				const view = leaves[0].view;
				const streaming = view.agentChatCtrl?.aiStreaming ?? view.isAiStreaming ?? false;
				const msgs = view.messageList?.getMessagesData() || [];
				const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
				return {
					streaming,
					msgCount: msgs.length,
					lastContent: lastMsg?.content || '',
					lastRole: lastMsg?.role || '',
				};
			})()`);

			if (state) {
				if (state.lastContent.length !== lastLoggedLen) {
					console.log(`  [Poll State] msgCount=${state.msgCount}, role=${state.lastRole}, streaming=${state.streaming}, contentLen=${state.lastContent.length}`);
					lastLoggedLen = state.lastContent.length;
				}

				if (state.msgCount > 0 && state.lastRole === 'assistant') {
					const contentLen = state.lastContent.trim().length;
					// 记录首字时间
					if (contentLen > 0 && ttft === null) {
						ttft = Date.now() - startTime;
						console.log(`⏱️  [首字到达] 耗时: ${ttft}ms`);
					}

					// 记录流式结束时间
					if (!state.streaming && contentLen > 0) {
						totalTime = Date.now() - startTime;
						responseText = state.lastContent;
						break;
					}
				}
			}
			await delay(200);
		}

		if (totalTime === null) {
			console.log(`❌ 测试超时或无响应`);
			return null;
		}

		console.log(`🏁 [生成完毕] 总耗时: ${totalTime}ms`);
		console.log(`📝 [回复字数] ${responseText.length} 字`);
		console.log(`📈 [生成速度] ${((responseText.length / (totalTime / 1000))).toFixed(2)} 字/秒`);
		return { ttft, totalTime, length: responseText.length };
	}

	// 运行测试场景
	
	// 场景 1: 闲聊短路（触发前置正则规则直接短路直接返回，0 规划 LLM 网络 RTT 开销）
	const res1 = await measure('你好', '场景 1 - 闲聊前置短路 (CASUAL)');

	// 场景 1.5: 普通闲聊（未触发短路，但走 S1 一体化单轮规划返回 CASUAL）
	const res1_5 = await measure('你好，今天天气怎么样？', '场景 1.5 - 普通闲聊单轮规划 (CASUAL)');
	
	// 场景 2: 一体化规划大生成任务（经历 1 轮一体化 S1 决策规划模型 + 大段流式生成）
	const res2 = await measure('你可以为我写一首赞美读书的诗歌吗？', '场景 2 - 一体化路由规划 (CASUAL)');

	// 场景 3: 涉及分析阅读的检索（进入 preSearch + 缓存命中，测试 LRU 缓存与双门槛）
	// 这里我们需要选择一本书，如果有《纳瓦尔宝典》或《金钱心理学》
	const hasNaval = await evalObsidian(`(() => {
		const adapter = app.vault.adapter;
		return adapter.exists('.obsidian/plugins/deepreader-dev/pageindex/74dca606/book-meta.json');
	})()`);

	let res3_1 = null;
	let res3_2 = null;

	if (hasNaval) {
		// 第一次执行检索（可能会从磁盘读一次缓存到 LRU Promise，或者是温热状态）
		res3_1 = await measure('纳瓦尔说关于运气有哪几种类型？', '场景 3.1 - 分析检索首轮 (ANALYTICAL - 预热 LRU)', '74dca606');
		
		// 第二次执行检索（完全走 LRU 缓存的内存向量 Promise，0 读盘耗时，预检索早停）
		res3_2 = await measure('纳瓦尔说的第一种运气是什么？', '场景 3.2 - 分析检索次轮 (ANALYTICAL - 缓存命中)', '74dca606');
	} else {
		console.log('\n⚠️ 提示: 纳瓦尔宝典未索引，跳过场景 3 (检索性能测试)。');
	}

	console.log(`\n========================================`);
	console.log(`📊 性能优化评测报告`);
	console.log(`----------------------------------------`);
	if (res1) console.log(`- 场景 1 闲聊短路:    TTFT = ${res1.ttft}ms, 总耗时 = ${res1.totalTime}ms`);
	if (res1_5) console.log(`- 场景 1.5 普通闲聊:  TTFT = ${res1_5.ttft}ms, 总耗时 = ${res1_5.totalTime}ms`);
	if (res2) console.log(`- 场景 2 一体化规划:  TTFT = ${res2.ttft}ms, 总耗时 = ${res2.totalTime}ms`);
	if (hasNaval && res3_1 && res3_2) {
		console.log(`- 场景 3.1 检索首轮:  TTFT = ${res3_1.ttft}ms, 总耗时 = ${res3_1.totalTime}ms`);
		console.log(`- 场景 3.2 检索次轮:  TTFT = ${res3_2.ttft}ms, 总耗时 = ${res3_2.totalTime}ms (LRU Promise 缓存命中)`);
	}
	console.log(`========================================\n`);
}

runBenchmark().catch(console.error);
