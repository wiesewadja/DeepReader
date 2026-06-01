/**
 * Obsidian CLI 封装
 *
 * 提供对外的简单接口：
 *   - reloadPlugin(id)         — 重载插件
 *   - getErrors(since)         — 拉取最近 JS 错误
 *   - listCommands()           — 列出所有插件命令（通过 executeObsidian）
 *   - openCommand(id)          — 执行命令
 *   - queryDom(selector)       — DOM 查询
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

/** 插件 ID（来自 manifest.json） */
export const PLUGIN_ID = 'deepreader';

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
