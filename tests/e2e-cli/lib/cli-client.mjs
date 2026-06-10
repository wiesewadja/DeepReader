/**
 * CLI 测试客户端 — 基于 obsidian CLI 的 evalObsidian 模式
 *
 * 复用 smoke 的 exec/evalObsidian，提供业务测试级别的封装。
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { PLUGIN_ID } from '../../lib/constants.mjs';

const execFileAsync = promisify(execFile);
const OBSIDIAN_CLI = process.env.OBSIDIAN_CLI || 'obsidian';

/**
 * 执行 obsidian CLI 子命令
 */
export async function exec(subcommand, args = [], { timeout = 15_000 } = {}) {
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
 * 在 Obsidian 上下文执行 JS，返回 JSON 解析后的值
 */
export async function evaluate(expression, { timeout = 30_000 } = {}) {
	const params = JSON.stringify({ expression, returnByValue: true, awaitPromise: true });
	const r = await exec('dev:cdp', ['method=Runtime.evaluate', `params=${params}`], { timeout });
	if (r.code !== 0) throw new Error(`evaluate 失败: ${r.stderr || r.stdout}`);
	const payload = JSON.parse(r.stdout);
	if (payload.exceptionDetails) {
		throw new Error(`JS 错误: ${payload.exceptionDetails.exception?.description || 'unknown'}`);
	}
	return payload.result?.value;
}

/**
 * 获取插件对象上的属性
 */
export async function getPluginProp(path) {
	return evaluate(`app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.${path}`);
}

/**
 * 获取插件设置
 */
export async function getSettings() {
	return evaluate(`app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.settings`);
}

/**
 * 获取插件 API
 */
export async function getApi(method, ...args) {
	return evaluate(`
		(async () => {
			const api = app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}]?.api;
			if (!api?.${method}) return { error: 'API method not found: ${method}' };
			try {
				const result = await api.${method}(${args.map(a => JSON.stringify(a)).join(', ')});
				return result;
			} catch (e) {
				return { error: e.message };
			}
		})()
	`);
}

/**
 * 执行 Obsidian 命令
 */
export async function command(id) {
	const r = await exec('command', [`id=${id}`]);
	if (r.code !== 0) throw new Error(`command 失败: ${r.stderr || r.stdout}`);
	return r.stdout.trim();
}

/**
 * 获取 vault 文件是否存在
 */
export async function fileExists(path) {
	return evaluate(`(async () => app.vault.adapter.exists(${JSON.stringify(path)}))()`);
}

/**
 * 读取 vault 文件内容
 */
export async function readFile(path) {
	return evaluate(`(async () => app.vault.adapter.read(${JSON.stringify(path)}))()`);
}

/**
 * 列出 vault 目录
 */
export async function listDir(path) {
	return evaluate(`(async () => app.vault.adapter.list(${JSON.stringify(path)}))()`);
}
