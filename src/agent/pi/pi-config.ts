/**
 * PI Agent 配置管理
 *
 * 构建启动参数、解析 vault 路径、生成系统提示词。
 */

import { type App } from 'obsidian';
import type { PiConfig } from './types.js';
import { spawn } from 'child_process';
import { homedir } from 'os';
import { join, delimiter } from 'path';
import { existsSync } from 'fs';
import { getVaultPath } from '../../utils/mobile-fs.js';

/** 当前平台 */
const platform = process.platform;

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
	const vaultPath = getVaultPath(app);
	const deepReaderDir = `${vaultPath}/DeepReader`;
	// 路径从 .pi/skills 迁移到 DeepReader/skills（2026-06），属于 breaking change：
	// 旧 sessions 数据不再复用，新路径由插件首次启动时自动创建，无需迁移。

	return {
		workingDir: vaultPath,
		skillsDir: `${deepReaderDir}/skills`,
		sessionDir: `${deepReaderDir}/pi/sessions`,
		exportsDir: `${deepReaderDir}/exports`,
		exportsDirRelative: 'DeepReader/exports',
	};
}

/**
 * 构建 PI RPC 启动参数
 */
export function buildSpawnArgs(config: PiConfig): string[] {
	const args = [
		'--mode', 'rpc',
		'--session-dir', config.sessionDir,
		'--no-skills',
		'--no-context-files',
		'--tools', 'read,write,edit,grep,find,ls,bash',
		'--provider', config.provider,
		'--model', config.model,
		'--api-key', config.apiKey,
		'--append-system-prompt', PI_SYSTEM_PROMPT,
	];

	// skillPath 优先（单 skill 路径），否则用 skillsDir（所有 skills）
	const skillPath = config.skillPath ?? config.skillsDir;
	if (skillPath) {
		args.push('--skill', skillPath);
	}

	return args;
}

/**
 * 获取 PI 系统提示词（供外部使用）
 */
export function getPiSystemPrompt(): string {
	return PI_SYSTEM_PROMPT;
}

/**
 * 构建 spawn 需要的 env，补充 macOS GUI 应用缺失的 PATH
 *
 * Obsidian 从 Dock/Spotlight 启动时 PATH 不含 Homebrew/node 路径，
 * 而 pi 是 Node.js 脚本（#!/usr/bin/env node），需要 node 在 PATH 中。
 */
export function buildSpawnEnv(): NodeJS.ProcessEnv {
	const home = homedir();
	const extraPaths: string[] = [];

	if (platform === 'darwin') {
		extraPaths.push('/opt/homebrew/bin', '/usr/local/bin', join(home, '.npm-global/bin'));
	} else if (platform === 'linux') {
		extraPaths.push('/usr/local/bin', '/usr/bin', join(home, '.npm-global/bin'), join(home, '.local/bin'));
	} else if (platform === 'win32') {
		const appdata = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
		const localappdata = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
		extraPaths.push(join(appdata, 'npm'), join(localappdata, 'pnpm'));
	}

	const existingPath = (process.env.PATH ?? '').split(delimiter);
	const merged = [...new Set([...extraPaths, ...existingPath])];
	return { ...process.env, PATH: merged.join(delimiter) };
}

const CACHE_TTL = 5 * 60 * 1000; // 5 分钟
let piCliCache: { result: { available: boolean; version?: string; path?: string; error?: string }; timestamp: number } | null = null;

/** semver 格式正则（如 0.75.5） */
const SEMVER_RE = /^\d+\.\d+\.\d+/;

/**
 * 候选 PI 可执行文件路径（跨平台）
 *
 * macOS GUI 应用（Obsidian）的 PATH 通常不含 Homebrew/npm 全局目录，
 * 所以需要手动尝试常见安装位置。
 */
function getCandidatePaths(customPath?: string): string[] {
	const home = homedir();
	const candidates: string[] = [];

	// 优先使用用户手动指定的路径
	if (customPath) {
		candidates.push(customPath);
	}

	// macOS
	if (platform === 'darwin') {
		candidates.push(
			'/opt/homebrew/bin/pi',           // Apple Silicon Homebrew
			'/usr/local/bin/pi',              // Intel Homebrew
			join(home, '.npm-global/bin/pi'), // 用户自定义 npm prefix
			join(home, '.local/bin/pi'),      // 手动安装
		);
	}

	// Linux
	if (platform === 'linux') {
		candidates.push(
			'/usr/local/bin/pi',                  // 系统级安装
			'/usr/bin/pi',                        // apt/yum/pacman 安装
			'/snap/bin/pi',                       // snap 包
			join(home, '.npm-global/bin/pi'),     // npm global
			join(home, '.local/bin/pi'),          // 用户本地安装
			join(home, '.local/share/pnpm/pi'),    // pnpm
			'/opt/pi/bin/pi',                     // 自定义安装到 /opt
		);
	}

	// Windows
	if (platform === 'win32') {
		const appdata = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
		const localappdata = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
		candidates.push(
			join(appdata, 'npm', 'pi.cmd'),                  // npm global
			join(localappdata, 'pnpm', 'pi.cmd'),             // pnpm
			join(localappdata, 'Programs', 'pi', 'pi.cmd'),   // 独立安装
			'C:\\Program Files\\nodejs\\pi.cmd',              // Node.js 安装目录
			join(localappdata, 'pi', 'pi.cmd'),               // Windows Store 版或其他安装
		);
	}

	// 最后尝试 PATH（兜底）
	candidates.push('pi');

	return candidates;
}

/**
 * 用 spawn 直接执行 pi --version（不走 shell），收集 stdout + stderr
 */
async function tryDetect(cliPath: string, env: NodeJS.ProcessEnv): Promise<{ available: true; version: string; path: string } | null> {
	return new Promise((resolve) => {
		try {
			const child = spawn(cliPath, ['--version'], { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], env });
			let out = '';

			child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
			child.stderr.on('data', (d: Buffer) => { out += d.toString(); });

			child.on('error', (e) => {
				resolve(null);
			});

			child.on('close', (code) => {
				const output = out.trim();
				if (code === 0 && SEMVER_RE.test(output)) {
					resolve({ available: true, version: output, path: cliPath });
				} else {
					resolve(null);
				}
			});
		} catch (e) {
			resolve(null);
		}
	});
}

/**
 * 检测 PI CLI 是否可用（带缓存，5 分钟 TTL）
 *
 * 优先使用用户自定义路径，再尝试常见安装位置。
 * 返回检测到的路径供 spawn 使用。
 */
export async function detectPiCli(customPath?: string): Promise<{ available: boolean; version?: string; path?: string; error?: string }> {
	const now = Date.now();
	if (piCliCache && now - piCliCache.timestamp < CACHE_TTL) {
		return piCliCache.result;
	}

	const env = buildSpawnEnv();
	const candidates = getCandidatePaths(customPath);
	for (const candidate of candidates) {
		const result = await tryDetect(candidate, env);
		if (result) {
			piCliCache = { result, timestamp: now };
			return result;
		}
	}

	const result = { available: false, error: 'PI CLI not found in common paths' };
	piCliCache = { result, timestamp: now };
	return result;
}

/**
 * 清除 PI CLI 检测缓存（安装/更新后调用）
 */
export function invalidatePiCliCache(): void {
	piCliCache = null;
}
