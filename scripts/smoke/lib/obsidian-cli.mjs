/**
 * Obsidian CLI 封装
 *
 * 提供对外的简单接口：
 *   - 基础功能
 *     - reloadPlugin(id)         — 重载插件
 *     - getErrors(since)         — 拉取最近 JS 错误
 *     - listCommands()           — 列出所有插件命令
 *     - openCommand(id)          — 执行命令
 *     - queryDom(selector)       — DOM 查询
 *   - DOM 操作（整合自 cdp-client）
 *     - count(selector)          — 统计选择器匹配元素数量
 *     - getText(selector)        — 获取元素文本内容
 *     - exists(selector)         — 检查选择器是否匹配到元素
 *     - waitForSelector(selector, timeout)    — 等待选择器匹配到元素
 *     - waitForSelectorGone(selector, timeout) — 等待选择器不再匹配任何元素
 *     - click(selector)          — 通过 CDP Input.dispatchMouseEvent 点击元素
 *     - type(selector, text)     — 在输入框中输入文字
 *     - domQuery(selector, options) — 通过 dev:dom 查询 DOM
 *     - screenshot(filename)     — 截图
 *
 * 内部封装：
 *   - exec(cmd, args)          — 执行 obsidian CLI 子进程
 *   - evalObsidian(fn, ...args) — 在 Obsidian 上下文执行 JS
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

/** Obsidian CLI 可执行文件名（PATH 中查找） */
const OBSIDIAN_CLI = process.env.OBSIDIAN_CLI || 'obsidian';

/** 插件 ID（dev 部署使用 -dev 后缀，避免与 daily 冲突） */
export const PLUGIN_ID = 'deepreader-dev';

/** 轮询间隔（毫秒） */
const POLL_INTERVAL = 300;

/**
 * 执行 obsidian CLI 子命令
 * @param {string} subcommand  如 "plugin:reload"
 * @param {string[]} args      如 ["id=deepreader"]
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
export async function exec(subcommand, args = [], { timeout: execTimeout = 15_000 } = {}) {
	try {
		const { stdout, stderr } = await execFileAsync(OBSIDIAN_CLI, [subcommand, ...args], {
			timeout: execTimeout,
			maxBuffer: 10 * 1024 * 1024,
		});
		return { stdout, stderr, code: 0 };
	} catch (e) {
		return {
			stdout: e.stdout || '',
			stderr: e.stderr || e.message,
			code: e.code ?? 1,
		};
	}
}

/**
 * 在 Obsidian Electron 环境中执行 JS 并返回结果
 *
 * 原理：调 Chrome DevTools Protocol 的 `Runtime.evaluate`，在 Obsidian
 * 主进程上下文里跑 JS，拿 `app` / `document` 等运行时对象。
 *
 * @param {string} expression - JS 表达式（支持返回 Promise，会自动 await）
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<any>} 表达式的求值结果
 */
export async function evalObsidian(expression, { timeout = 30_000 } = {}) {
	const params = JSON.stringify({
		expression,
		returnByValue: true,
		awaitPromise: true,
	});
	const r = await exec('dev:cdp', [
		'method=Runtime.evaluate',
		`params=${params}`,
	], { timeout });
	if (r.code !== 0) {
		throw new Error(`evalObsidian 失败: ${r.stderr || r.stdout}`);
	}
	let payload;
	try {
		payload = JSON.parse(r.stdout);
	} catch (e) {
		throw new Error(`evalObsidian 返回非 JSON: ${r.stdout.slice(0, 200)}`);
	}
	if (payload.exceptionDetails) {
		throw new Error(`evalObsidian JS 错误: ${payload.exceptionDetails.exception?.description || 'unknown'}`);
	}
	return payload.result?.value;
}

/**
 * 列出所有 deepreader:* 命令
 * @returns {Promise<string[]>}
 */
export async function listCommands() {
	const expr = `app.commands.listCommands().filter(c => c.id.startsWith('${PLUGIN_ID}:')).map(c => c.id)`;
	return evalObsidian(expr);
}

/**
 * 执行 Obsidian 命令
 */
export async function openCommand(commandId) {
	const expr = `app.commands.executeCommandById(${JSON.stringify(commandId)})`;
	return evalObsidian(expr);
}

/**
 * 查询 DOM 选择器匹配数
 * @param {string} selector
 * @returns {Promise<number>}
 */
export async function queryDom(selector) {
	const expr = `document.querySelectorAll(${JSON.stringify(selector)}).length`;
	return evalObsidian(expr);
}

// ========== DOM 操作 API（整合自 cdp-client）==========

/**
 * 统计选择器匹配元素数量
 * @param {string} selector
 * @returns {Promise<number>}
 */
export async function count(selector) {
	return evalObsidian(`document.querySelectorAll(${JSON.stringify(selector)}).length`) || 0;
}

/**
 * 获取元素文本内容
 * @param {string} selector
 * @returns {Promise<string>}
 */
export async function getText(selector) {
	return evalObsidian(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() || ''`);
}

/**
 * 检查选择器是否匹配到元素
 * @param {string} selector
 * @returns {Promise<boolean>}
 */
export async function exists(selector) {
	const n = await count(selector);
	return n > 0;
}

/**
 * 等待选择器匹配到元素
 * @param {string} selector
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<boolean>}
 */
export async function waitForSelector(selector, timeout = 10_000) {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (await exists(selector)) return true;
		await sleep(POLL_INTERVAL);
	}
	throw new Error(`waitForSelector 超时 (${timeout}ms): ${selector}`);
}

/**
 * 等待选择器不再匹配任何元素
 * @param {string} selector
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<boolean>}
 */
export async function waitForSelectorGone(selector, timeout = 10_000) {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (!(await exists(selector))) return true;
		await sleep(POLL_INTERVAL);
	}
	throw new Error(`waitForSelectorGone 超时 (${timeout}ms): ${selector}`);
}

/**
 * 通过 CDP Input.dispatchMouseEvent 点击元素
 * 先获取元素坐标，再发送鼠标事件
 * @param {string} selector
 */
export async function click(selector) {
	// 获取元素边界盒
	const box = await evalObsidian(`
		(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
		})()
	`);
	if (!box) throw new Error(`click: 元素未找到: ${selector}`);

	// 发送鼠标事件
	const params = JSON.stringify({ type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
	await exec('dev:cdp', ['method=Input.dispatchMouseEvent', `params=${params}`]);
	const params2 = JSON.stringify({ type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
	await exec('dev:cdp', ['method=Input.dispatchMouseEvent', `params=${params2}`]);
}

/**
 * 在输入框中输入文字（通过 evaluate 设置 value + 触发 input 事件）
 * @param {string} selector
 * @param {string} text
 */
export async function type(selector, text) {
	await evalObsidian(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (el) {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
			if (setter) { setter.call(el, ${JSON.stringify(text)}); } else { el.value = ${JSON.stringify(text)}; }
			el.dispatchEvent(new Event('input', { bubbles: true }));
		}
	})()`);
}

/**
 * 通过 dev:dom 查询 DOM
 * @param {string} selector
 * @param {Object} options - { text, total, attr, css }
 * @returns {Promise<string>}
 */
export async function domQuery(selector, { text, total, attr, css } = {}) {
	const args = [`selector=${selector}`];
	if (text) args.push('text');
	if (total) args.push('total');
	if (attr) args.push(`attr=${attr}`);
	if (css) args.push(`css=${css}`);
	const r = await exec('dev:dom', args);
	if (r.code !== 0) throw new Error(`dev:dom 失败: ${r.stderr || r.stdout}`);
	return r.stdout.trim();
}

/**
 * 截图
 * @param {string} filename - 可选，保存路径
 * @returns {Promise<string>}
 */
export async function screenshot(filename) {
	const r = await exec('dev:screenshot', filename ? [`path=${filename}`] : []);
	if (r.code !== 0) throw new Error(`screenshot 失败: ${r.stderr || r.stdout}`);
	return r.stdout.trim();
}

/**
 * 等待指定毫秒
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
	return new Promise(r => setTimeout(r, ms));
}

// ========== 统一客户端 API ==========

/**
 * 创建 UX 测试客户端
 * 
 * 提供与 cdp-client.mjs 相同的接口，但基于扩展后的 obsidian-cli.mjs
 * 不需要连接/断开——每次调用都是独立的 CLI 子进程。
 * 
 * @returns {Object} 客户端实例
 */
export function createClient() {
	return {
		/**
		 * 执行 JS 并返回结果
		 */
		async evaluate(expr, opts) {
			return evalObsidian(expr, opts);
		},

		/**
		 * 执行 JS 并返回 JSON 解析后的值（与 evaluate 相同，保持兼容性）
		 */
		async evaluateJSON(expr, opts) {
			return evalObsidian(expr, opts);
		},

		/**
		 * 统计选择器匹配元素数量
		 */
		async count(selector) {
			return count(selector);
		},

		/**
		 * 获取元素文本内容
		 */
		async getText(selector) {
			return getText(selector);
		},

		/**
		 * 检查选择器是否匹配到元素
		 */
		async exists(selector) {
			return exists(selector);
		},

		/**
		 * 等待选择器匹配到元素
		 */
		async waitForSelector(selector, timeout = 10_000) {
			return waitForSelector(selector, timeout);
		},

		/**
		 * 等待选择器不再匹配任何元素
		 */
		async waitForSelectorGone(selector, timeout = 10_000) {
			return waitForSelectorGone(selector, timeout);
		},

		/**
		 * 通过 CDP Input.dispatchMouseEvent 点击元素
		 */
		async click(selector) {
			return click(selector);
		},

		/**
		 * 在输入框中输入文字
		 */
		async type(selector, text) {
			return type(selector, text);
		},

		/**
		 * 执行 Obsidian 命令
		 */
		async command(commandId) {
			return openCommand(commandId);
		},

		/**
		 * 通过 dev:dom 查询 DOM
		 */
		async domQuery(selector, options) {
			return domQuery(selector, options);
		},

		/**
		 * 截图
		 */
		async screenshot(filename) {
			return screenshot(filename);
		},
	};
}
