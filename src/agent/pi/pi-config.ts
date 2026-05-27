/**
 * PI Agent 配置管理
 *
 * 构建启动参数、解析 vault 路径、生成系统提示词。
 */

import { type App, normalizePath } from 'obsidian';
import type { PiConfig } from './types.js';

const PI_SYSTEM_PROMPT = `你是奚童的技能执行引擎，隶属于 DeepReader 深度阅读插件。

你的职责：
- 根据用户的阅读请求，执行对应的 skill（知识卡片、思维导图、阅读笔记等）
- 结果写入指定路径的文件

你的约束：
- 只处理与阅读相关的任务
- 所有输出写入文件，不直接回复用户
- 使用 vault 中的 skill 定义来指导执行
- 使用中文输出`;

/**
 * 解析 vault 内的 PI 相关路径
 *
 * absolute: 绝对文件系统路径（给 PI CLI / child_process 用）
 * vaultRelative: vault-relative 路径（给 Obsidian Vault API 用）
 */
export function resolvePiPaths(app: App): {
	workingDir: string;
	skillsDir: string;
	sessionDir: string;
	exportsDir: string;
	exportsDirRelative: string;
} {
	const vaultPath = (app.vault.adapter as unknown as { basePath: string }).basePath;
	const deepReaderDir = normalizePath(`${vaultPath}/DeepReader`);
	const exportsRelative = normalizePath('DeepReader/exports');

	return {
		workingDir: vaultPath,
		skillsDir: normalizePath(`${deepReaderDir}/skills`),
		sessionDir: normalizePath(`${deepReaderDir}/pi/sessions`),
		exportsDir: normalizePath(`${deepReaderDir}/exports`),
		exportsDirRelative: exportsRelative,
	};
}

/**
 * 构建 PI RPC 启动参数
 */
export function buildSpawnArgs(config: PiConfig): string[] {
	return [
		'--mode', 'rpc',
		'--no-session',
		'--session-dir', config.sessionDir,
		'--no-skills',
		'--skill', config.skillsDir,
		'--no-context-files',
		'--tools', 'read,write,edit,grep,find,ls',
		'--model', config.model,
		'--append-system-prompt', PI_SYSTEM_PROMPT,
	];
}

/**
 * 获取 PI 系统提示词（供外部使用）
 */
export function getPiSystemPrompt(): string {
	return PI_SYSTEM_PROMPT;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
let piCliCache: { result: { available: boolean; version?: string; error?: string }; timestamp: number } | null = null;

/**
 * 检测 PI CLI 是否可用（带缓存，5 分钟 TTL）
 */
export async function detectPiCli(): Promise<{ available: boolean; version?: string; error?: string }> {
	const now = Date.now();
	if (piCliCache && now - piCliCache.timestamp < CACHE_TTL) {
		return piCliCache.result;
	}

	const { execSync } = await import('child_process');
	try {
		const output = execSync('pi --version', { timeout: 5000, encoding: 'utf8' }).trim();
		const result = { available: true, version: output };
		piCliCache = { result, timestamp: now };
		return result;
	} catch (e) {
		const result = { available: false, error: (e as Error).message };
		piCliCache = { result, timestamp: now };
		return result;
	}
}

/**
 * 清除 PI CLI 检测缓存（安装/更新后调用）
 */
export function invalidatePiCliCache(): void {
	piCliCache = null;
}
