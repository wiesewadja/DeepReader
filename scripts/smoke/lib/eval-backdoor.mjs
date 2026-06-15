/**
 * Eval Backdoor 注册逻辑（共用）
 *
 * 背景：3 处测试文件（agent-live-test.mjs / eval-agent.spec.mjs /
 * eval-agent.e2e.ts）原本各自重复实现 evalBackdoor 注册逻辑（~30-50 行）。
 * 本模块抽出 .mjs 版（基于 evalObsidian 字符串注入）的公共实现。
 *
 * WDIO 版（eval-agent.e2e.ts）使用 browser.executeObsidian 函数序列化，
 * 无法直接复用字符串注入；保持独立实现，但需遵循本模块导出的接口契约。
 *
 * 接口契约：
 *   plugin.evalBackdoor.startQnA(id, question, bookId, history?) → void
 *     - fire-and-forget，立即返回
 *     - history 参数可选（{role, content}[]），传入时注入到 _chatController._agentChatHistory
 *   plugin.evalBackdoor.pollResult(id) → { response, traceData } | { error } | null
 *     - 同步返回；拿到结果后自动清除
 */

import { evalObsidian } from './obsidian-cli.mjs';

/**
 * 检查插件加载状态（前端 agent 是否就绪）
 * @param {string} [pluginId='deepreader-dev']
 * @returns {Promise<{loaded: boolean, hasAgent: boolean}>}
 */
export async function checkPluginLoaded(pluginId = 'deepreader-dev') {
	return evalObsidian(`(() => {
		const p = app.plugins.plugins[${JSON.stringify(pluginId)}];
		return { loaded: !!p, hasAgent: !!p?.frontendAgent };
	})()`);
}

/**
 * 注册 evalBackdoor（已存在则跳过）
 *
 * 注入的 startQnA/pollResult 实现见模块顶部"接口契约"。
 *
 * @param {string} [pluginId='deepreader-dev']
 * @returns {Promise<boolean>} true 表示已就绪（新注册或已存在）
 */
export async function registerEvalBackdoor(pluginId = 'deepreader-dev') {
	// 注意：本函数返回的是字符串模板，会在 Obsidian 进程内执行。
	// 内部不能用 closure 变量，所有依赖（pluginId）通过 ${} 注入。
	const script = `(() => {
		const plugin = app.plugins.plugins[${JSON.stringify(pluginId)}];
		if (!plugin) return false;
		if (plugin.evalBackdoor) return true;
		const pending = {};
		plugin.evalBackdoor = {
			startQnA(id, question, bookId, history) {
				const adapter = app.vault.adapter;
				const agent = plugin.frontendAgent;
				if (!agent) {
					pending[id] = { error: 'frontendAgent 未初始化' };
					return;
				}
				(async () => {
					const metaPath = '.obsidian/plugins/${pluginId}/pageindex/' + bookId + '/book-meta.json';
					let docMeta = {};
					try {
						const exists = await adapter.exists(metaPath);
						if (exists) {
							const raw = await adapter.read(metaPath);
							docMeta = JSON.parse(raw);
						}
					} catch (e) { /* meta 缺失用空对象 */ }
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
					if (history && history.length > 0) {
						const sidebar = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
						if (sidebar.length > 0 && sidebar[0].view?._chatController) {
							sidebar[0].view._chatController._agentChatHistory = history.map(m => ({
								role: m.role,
								content: m.content,
							}));
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
		return true;
	})()`;
	const ok = await evalObsidian(script);
	if (!ok) throw new Error(`注册 evalBackdoor 失败：插件 ${pluginId} 未加载`);
	return true;
}

/**
 * 完整的 backdoor 就绪检查（插件加载 + 注册）
 *
 * 等价于原 agent-live-test.mjs 的 ensureEvalBackdoor 函数。
 *
 * @param {string} [pluginId='deepreader-dev']
 */
export async function ensureEvalBackdoor(pluginId = 'deepreader-dev') {
	const check = await checkPluginLoaded(pluginId);
	if (!check?.loaded) {
		throw new Error(`插件 ${pluginId} 未加载。请确认 Obsidian 已启动并加载了插件。`);
	}
	if (!check?.hasAgent) {
		throw new Error('frontendAgent 不存在。插件可能未完全初始化。');
	}
	return registerEvalBackdoor(pluginId);
}

/**
 * 启动一次 Q&A（fire-and-forget）
 * @param {string} caseId
 * @param {string} question
 * @param {string} bookId
 * @param {Array<{role: string, content: string}>} [history]
 * @param {string} [pluginId='deepreader-dev']
 */
export async function startQnA(caseId, question, bookId, history, pluginId = 'deepreader-dev') {
	await evalObsidian(`(() => {
		app.plugins.plugins[${JSON.stringify(pluginId)}].evalBackdoor.startQnA(
			${JSON.stringify(caseId)},
			${JSON.stringify(question)},
			${JSON.stringify(bookId || '')},
			${JSON.stringify(history || null)}
		);
		return true;
	})()`);
}

/**
 * 轮询 Q&A 结果（一次性，拿到即清除）
 * @param {string} caseId
 * @param {string} [pluginId='deepreader-dev']
 * @returns {Promise<{response: string, traceData: any} | {error: string} | null>}
 */
export async function pollResult(caseId, pluginId = 'deepreader-dev') {
	return evalObsidian(
		`app.plugins.plugins[${JSON.stringify(pluginId)}].evalBackdoor.pollResult(${JSON.stringify(caseId)})`
	);
}

/**
 * 启动 + 轮询直到拿到结果或超时
 *
 * 等价于原 agent-live-test.mjs 的 runSingleQa 函数。
 *
 * @param {string} caseId
 * @param {string} question
 * @param {string} bookId
 * @param {object} [opts]
 * @param {number} [opts.timeout=180000]
 * @param {number} [opts.pollInterval=3000]
 * @param {Array<{role: string, content: string}>} [opts.history]
 * @param {string} [opts.pluginId='deepreader-dev']
 * @returns {Promise<{response: string, traceData: any} | {error: string} | null>}
 */
export async function runQa(caseId, question, bookId, opts = {}) {
	const {
		timeout = 180_000,
		pollInterval = 3_000,
		history,
		pluginId = 'deepreader-dev',
	} = opts;
	await startQnA(caseId, question, bookId, history, pluginId);
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		try {
			const r = await pollResult(caseId, pluginId);
			if (r) return r;
		} catch { /* poll 错误忽略，下次重试 */ }
		await new Promise(resolve => setTimeout(resolve, pollInterval));
	}
	return null;
}
