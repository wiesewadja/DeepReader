/**
 * CDP Client — 基于 Obsidian CLI 的 UX 测试客户端
 *
 * 通过 `obsidian` CLI 的 dev:cdp / eval / dev:dom / command 子命令
 * 操作已运行的 Obsidian 实例，无需额外端口或依赖。
 *
 * 复用 scripts/smoke/lib/obsidian-cli.mjs 的 exec/evalObsidian。
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const OBSIDIAN_CLI = process.env.OBSIDIAN_CLI || 'obsidian';

const POLL_INTERVAL = 300;

/**
 * 执行 obsidian CLI 子命令
 */
async function execObsidian(subcommand, args = [], { timeout = 15_000 } = {}) {
	try {
		const { stdout, stderr } = await execFileAsync(OBSIDIAN_CLI, [subcommand, ...args], {
			timeout,
			maxBuffer: 10 * 1024 * 1024,
		});
		return { stdout, stderr, code: 0 };
	} catch (e) {
		return { stdout: e.stdout || '', stderr: e.stderr || e.message, code: e.code ?? 1 };
	}
}

/**
 * 在 Obsidian 中执行 JS 表达式
 */
async function evaluate(expression, { timeout = 30_000 } = {}) {
	const r = await execObsidian('eval', [`code=${expression}`], { timeout });
	if (r.code !== 0) throw new Error(`evaluate 失败: ${r.stderr || r.stdout}`);
	// eval 命令直接返回结果文本
	return r.stdout.trim();
}

/**
 * 通过 CDP Runtime.evaluate 执行 JS（返回 JSON 解析后的值）
 */
async function evaluateJSON(expression, { timeout = 30_000 } = {}) {
	const params = JSON.stringify({ expression, returnByValue: true, awaitPromise: true });
	const r = await execObsidian('dev:cdp', ['method=Runtime.evaluate', `params=${params}`], { timeout });
	if (r.code !== 0) throw new Error(`evaluateJSON 失败: ${r.stderr || r.stdout}`);
	const payload = JSON.parse(r.stdout);
	if (payload.exceptionDetails) {
		throw new Error(`JS 错误: ${payload.exceptionDetails.exception?.description || 'unknown'}`);
	}
	return payload.result?.value;
}

/**
 * 创建 UX 测试客户端
 *
 * 不需要连接/断开——每次调用都是独立的 CLI 子进程。
 */
export function createClient() {
	return {
		/**
		 * 执行 JS 并返回原始文本
		 */
		async evaluate(expr, opts) {
			return evaluate(expr, opts);
		},

		/**
		 * 执行 JS 并返回 JSON 解析后的值
		 */
		async evaluateJSON(expr, opts) {
			return evaluateJSON(expr, opts);
		},

		/**
		 * 统计选择器匹配元素数量
		 */
		async count(selector) {
			return evaluateJSON(`document.querySelectorAll(${JSON.stringify(selector)}).length`) || 0;
		},

		/**
		 * 获取元素文本内容
		 */
		async getText(selector) {
			return evaluateJSON(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() || ''`);
		},

		/**
		 * 检查选择器是否匹配到元素
		 */
		async exists(selector) {
			const n = await this.count(selector);
			return n > 0;
		},

		/**
		 * 等待选择器匹配到元素
		 */
		async waitForSelector(selector, timeout = 10_000) {
			const start = Date.now();
			while (Date.now() - start < timeout) {
				if (await this.exists(selector)) return true;
				await sleep(POLL_INTERVAL);
			}
			throw new Error(`waitForSelector 超时 (${timeout}ms): ${selector}`);
		},

		/**
		 * 等待选择器不再匹配任何元素
		 */
		async waitForSelectorGone(selector, timeout = 10_000) {
			const start = Date.now();
			while (Date.now() - start < timeout) {
				if (!(await this.exists(selector))) return true;
				await sleep(POLL_INTERVAL);
			}
			throw new Error(`waitForSelectorGone 超时 (${timeout}ms): ${selector}`);
		},

		/**
		 * 通过 CDP Input.dispatchMouseEvent 点击元素
		 * 先获取元素坐标，再发送鼠标事件
		 */
		async click(selector) {
			// 获取元素边界盒
			const box = await evaluateJSON(`
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
			await execObsidian('dev:cdp', ['method=Input.dispatchMouseEvent', `params=${params}`]);
			const params2 = JSON.stringify({ type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
			await execObsidian('dev:cdp', ['method=Input.dispatchMouseEvent', `params=${params2}`]);
		},

		/**
		 * 在输入框中输入文字（通过 evaluate 设置 value + 触发 input 事件）
		 */
		async type(selector, text) {
			await evaluateJSON(`(() => {
				const el = document.querySelector(${JSON.stringify(selector)});
				if (el) {
					const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
					if (setter) { setter.call(el, ${JSON.stringify(text)}); } else { el.value = ${JSON.stringify(text)}; }
					el.dispatchEvent(new Event('input', { bubbles: true }));
				}
			})()`);
		},

		/**
		 * 执行 Obsidian 命令
		 */
		async command(commandId) {
			const r = await execObsidian('command', [`id=${commandId}`]);
			if (r.code !== 0) throw new Error(`command 失败: ${r.stderr || r.stdout}`);
		},

		/**
		 * 通过 dev:dom 查询 DOM
		 */
		async domQuery(selector, { text, total, attr, css } = {}) {
			const args = [`selector=${selector}`];
			if (text) args.push('text');
			if (total) args.push('total');
			if (attr) args.push(`attr=${attr}`);
			if (css) args.push(`css=${css}`);
			const r = await execObsidian('dev:dom', args);
			if (r.code !== 0) throw new Error(`dev:dom 失败: ${r.stderr || r.stdout}`);
			return r.stdout.trim();
		},

		/**
		 * 截图
		 */
		async screenshot(filename) {
			const r = await execObsidian('dev:screenshot', filename ? [`path=${filename}`] : []);
			if (r.code !== 0) throw new Error(`screenshot 失败: ${r.stderr || r.stdout}`);
			return r.stdout.trim();
		},
	};
}

function sleep(ms) {
	return new Promise(r => setTimeout(r, ms));
}
