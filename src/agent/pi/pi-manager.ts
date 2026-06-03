/**
 * PI Agent 进程管理器
 *
 * 懒启动、长驻、new_session 隔离、崩溃重启、超时 abort、并发拒绝。
 */

import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { readdir, stat, readFile } from 'fs/promises';
import { dirname, join, basename } from 'path';
import { PiRpcClient } from './pi-client.js';
import { buildSpawnArgs, buildSpawnEnv, resolvePiPaths, detectPiCli } from './pi-config.js';
import { PiProcessState, type PiConfig, type PiSkillContext, type PiExecutionResult, type PiExtensionUiRequestEvent, type PiExtensionUiResponse } from './types.js';
import { agentLog as log, error as logError } from '../../utils/logger.js';
import { ConfirmModal } from '../../components/confirm-modal.js';
import { Notice } from 'obsidian';
import type { App } from 'obsidian';

export class PiProcessManager {
	private rpcClient = new PiRpcClient();
	private process: ChildProcess | null = null;
	private state: PiProcessState = PiProcessState.STOPPED;
	private config: PiConfig | null = null;
	private busy = false;
	private _bridgeSetup = false;
	private currentBookId: string | null = null;
	private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private _heartbeatFailCount = 0;

	constructor(private app: App) {}

	/**
	 * 获取当前进程状态
	 */
	getState(): PiProcessState {
		return this.state;
	}

	/**
	 * 是否就绪（可接受 skill 请求）
	 */
	isReady(): boolean {
		return this.state === PiProcessState.READY;
	}

	/**
	 * 是否正在执行
	 */
	isBusy(): boolean {
		return this.busy;
	}

	/**
	 * 确保 PI 进程已启动（懒启动）
	 */
	async ensureStarted(config: PiConfig): Promise<void> {
		if (this.process) {
			return;
		}
		await this.start(config);
	}

	/**
	 * 启动 PI RPC 进程
	 */
	async start(config: PiConfig): Promise<void> {
		if (this.process) {
			return;
		}

		this.config = config;
		this.state = PiProcessState.STARTING;
		log('[PiManager] Starting PI RPC process...');

		// 确保 session 和 exports 目录存在
		try {
			mkdirSync(dirname(config.sessionDir), { recursive: true });
		} catch {
			// 目录可能已存在
		}
		try {
			mkdirSync(config.exportsDir, { recursive: true });
		} catch {
			// 目录可能已存在
		}

		// 检测 PI 可执行文件路径（Obsidian GUI 进程 PATH 不完整）
		const piStatus = await detectPiCli(config.customPiPath);
		log(`[PiManager] PI CLI: available=${piStatus.available}, path=${piStatus.path}, version=${piStatus.version}`);
		if (!piStatus.available) {
			this.state = PiProcessState.ERROR;
			this.currentBookId = null;
			throw new Error('PI CLI not found. Please install PI and retry.');
		}
		const piBin = piStatus.path ?? 'pi';

		const args = buildSpawnArgs(config);
		// 根据 provider 设置对应的环境变量
		const providerEnvKeyMap: Record<string, string> = {
			anthropic: 'ANTHROPIC_API_KEY',
			deepseek: 'DEEPSEEK_API_KEY',
			openai: 'OPENAI_API_KEY',
			xiaomi: 'OPENAI_API_KEY',
		};
		const envKey = providerEnvKeyMap[config.provider] || 'ANTHROPIC_API_KEY';
		const spawnEnv = { ...buildSpawnEnv(), [envKey]: config.apiKey };
		log(`[PiManager] Spawning: ${piBin} ${args.join(' ')}`);

		this.process = spawn(piBin, args, {
			cwd: config.workingDir,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: spawnEnv,
		});

		// 捕获 PI 进程 stderr（错误日志）
		this.process.stderr?.on('data', (data: Buffer) => {
			const msg = data.toString().trim();
			if (msg) logError(`[PiManager] PI stderr: ${msg}`);
		});

		this.process.on('error', (err) => {
			logError(`[PiManager] Process error: ${(err instanceof Error ? err.message : String(err))}`);
			this.state = PiProcessState.ERROR;
			this.currentBookId = null;
			this.process = null;
		});

		this.process.on('close', (code) => {
			log(`[PiManager] Process exited with code ${code}`);
			this._stopHeartbeat();
			if (this.state !== PiProcessState.STOPPED) {
				// 异常退出，标记为错误状态（下次调用会重启）
				this.state = PiProcessState.ERROR;
			}
			this.process = null;
			this.currentBookId = null;
			this.rpcClient.detach();
		});

		this.rpcClient.attach(this.process);

		// 等待进程 stdin 可写，确认进程真正就绪
		await new Promise<void>((resolve, reject) => {
			const stdin = this.process!.stdin;
			if (!stdin) {
				reject(new Error('PI 进程 stdin 不可用'));
				return;
			}
			if (stdin.writable) {
				this.state = PiProcessState.READY;
				log('[PiManager] PI RPC process started');
				resolve();
				return;
			}
			const onReady = () => {
				this.state = PiProcessState.READY;
				log('[PiManager] PI RPC process started');
				cleanup();
				resolve();
			};
			const onError = (err: Error) => {
				cleanup();
				reject(err);
			};
			const cleanup = () => {
				stdin.off('ready', onReady);
				stdin.off('error', onError);
			};
			stdin.once('ready', onReady);
			stdin.once('error', onError);
		});

		// 启用瞬态错误自动重试（旧版 PI 可能不支持，不阻止启动）
		try { await this.rpcClient.setAutoRetry(true); } catch { log('[PiManager] setAutoRetry not supported'); }

		// 启用自动上下文压缩（旧版 PI 可能不支持，不阻止启动）
		try { await this.rpcClient.setAutoCompaction(true); } catch { log('[PiManager] setAutoCompaction not supported'); }

		// 启动心跳检测（每 30s 检测一次，连续 3 次失败视为进程假死）
		this._startHeartbeat();
	}

	/**
	 * 启动心跳检测：定期 ping PI 进程，若连续失败则杀死重启
	 */
	private _startHeartbeat(): void {
		this._stopHeartbeat();
		this._heartbeatFailCount = 0;
		this._heartbeatTimer = setInterval(async () => {
			if (this.state !== PiProcessState.READY) return;
			try {
				await this.rpcClient.getState(5000);
				this._heartbeatFailCount = 0;
			} catch {
				this._heartbeatFailCount++;
				logError(`[PiManager] Heartbeat failed (${this._heartbeatFailCount}/3): PI may be hung`);
				if (this._heartbeatFailCount >= 3) {
					logError('[PiManager] PI process unresponsive, killing and restarting');
					this.killProcess();
					// 标记需要重启，下次 executeSkill 会重新启动
					this.state = PiProcessState.STOPPED;
				}
			}
		}, 30_000);
	}

	/**
	 * 停止心跳检测
	 */
	private _stopHeartbeat(): void {
		if (this._heartbeatTimer) {
			clearInterval(this._heartbeatTimer);
			this._heartbeatTimer = null;
		}
	}

	/**
	 * 强制清理进程资源
	 */
	private killProcess(): void {
		this._stopHeartbeat();
		if (this.process) {
			this.process.kill();
			this.process = null;
			this.rpcClient.detach();
			this.state = PiProcessState.ERROR;
			this.currentBookId = null;
		}
	}

	/**
	 * 判断错误是否为瞬时可重试类型
	 * - 超时/网络错误 → transient（可 fallback 重试）
	 * - 配置/安装/权限错误 → non-transient（应终止，不 fallback）
	 */
	private isTransientError(message: string): boolean {
		const m = message.toLowerCase();
		return (
			m.includes('timed out') ||
			m.includes('timeout') ||
					m.includes('stdout closed unexpectedly') ||
			m.includes('econnreset') ||
			m.includes('enetunreach') ||
			m.includes('eai_') // DNS lookup failed
		);
	}

	/**
	 * 停止 PI 进程
	 */
	async stop(): Promise<void> {
		this.state = PiProcessState.STOPPED;

		if (this.busy) {
			try {
				await this.rpcClient.abort(3000);
			} catch {
				// 忽略 abort 失败
			}
		}

		if (this.process) {
			this.process.kill();
			this.process = null;
			this.currentBookId = null;
		}

		this.rpcClient.detach();
		log('[PiManager] PI process stopped');
	}

	/**
	 * 重启 PI 进程
	 */
	async restart(): Promise<void> {
		log('[PiManager] Restarting PI process...');
		await this.stop();
		if (this.config) {
			await this.start(this.config);
		}
	}

	/**
	 * 执行一个 skill 任务
	 *
	 * 完整流程：ensureStarted → newSession → prompt → waitForAgentEnd
	 * 整体超时 90s（含进程启动），skill 执行超时 60s。
	 */
	async executeSkill(
		context: PiSkillContext,
		config: PiConfig,
		onProgress?: (msg: string) => void,
		onStreamDelta?: (text: string) => void,
	): Promise<PiExecutionResult> {
		// 并发拒绝
		if (this.busy) {
			return {
				outputPath: context.outputPath,
				success: false,
				error: '奚童正在执行其他任务，请稍后再试',
				transient: false,
			};
		}

		this.busy = true;
		this.state = PiProcessState.BUSY;

		// 整体超时保护（含进程启动 + skill 执行）
		const overallTimeout = 300_000;
		const overallTimer = setTimeout(() => {
			log('[PiManager] Overall timeout reached, killing process');
			this.killProcess();
		}, overallTimeout);

		// 订阅 tool_execution 事件提供进度反馈
		const progressHandler = (event: import('./types.js').PiEvent) => {
			if (event.type === 'tool_execution_start') {
				const e = event as import('./types.js').PiToolExecutionStartEvent;
				onProgress?.(`PI 正在执行: ${e.toolName}`);
			} else if (event.type === 'auto_retry_start') {
				const e = event as import('./types.js').PiAutoRetryStartEvent;
				onProgress?.(`遇到临时错误，自动重试 (${e.attempt}/${e.maxAttempts})...`);
			} else if (event.type === 'auto_retry_end') {
				const e = event as import('./types.js').PiAutoRetryEndEvent;
				if (e.success) {
					onProgress?.('自动重试成功，继续执行...');
				}
			}
		};
		this.rpcClient.on(progressHandler);

		try {
			// 确保进程就绪
			await this.ensureStarted(config);

			if (!this.process) {
				return {
					outputPath: context.outputPath,
					success: false,
					error: 'PI 进程启动失败，请检查 PI 是否已安装',
					transient: false,
				};
			}

			// 按书隔离 session：同一本书复用上下文（skill 已加载），切换书时 newSession
			// 优先使用 indexId（唯一），否则用 title + author 组合（防重名）
			const bookId = context.book.indexId
				|| (context.book.title && context.book.author ? `${context.book.title}__${context.book.author}` : context.book.title);
			if (this.currentBookId !== bookId) {
				await this.rpcClient.newSession();
				this.currentBookId = bookId;
				log(`[PiManager] New session for book: ${bookId}`);
			} else {
				log(`[PiManager] Reusing session for book: ${bookId}`);
			}

			// 构造 prompt
			const prompt = this.buildPrompt(context);
			log(`[PiManager] Executing skill (${prompt.length} chars): ${context.userRequest.substring(0, 50)}...`);

			onProgress?.('PI 已接收任务，正在处理...');

			// 捕获 agent_end 事件（可能包含统计信息，避免额外 RPC 调用）
			let agentEndEvent: import('./types.js').PiAgentEndEvent | null = null;

			// 流式执行，逐步 yield 事件
			for await (const event of this.rpcClient.sendPromptStream(prompt, 290_000)) {
				if (event.type === 'message_update') {
					const delta = (event as import('./types.js').PiMessageUpdateEvent).assistantMessageEvent;
					if (delta?.type === 'text_delta' && delta.delta) {
						onStreamDelta?.(delta.delta);
					}
				} else if (event.type === 'agent_end') {
					agentEndEvent = event as import('./types.js').PiAgentEndEvent;
				}
			}

			// 验证输出文件实际存在（PI 可能改变扩展名，需容错查找）
			const finalOutputPath = await this.resolveOutputFile(
				context.outputPath,
				this.config!.workingDir,
			);

			return {
				outputPath: finalOutputPath,
				success: true,
				stats: this.tryExtractStatsFromAgentEnd(agentEndEvent) ?? await this.tryGetSessionStats(),
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logError(`[PiManager] Skill execution failed: ${message}`);

			const transient = this.isTransientError(message);
			// 瞬时错误（进程崩溃/超时）→ 杀死进程，下次调用重启
			if (transient) {
				this.killProcess();
			}

			return {
				outputPath: context.outputPath,
				success: false,
				error: message,
				transient,
			};
		} finally {
			clearTimeout(overallTimer);
			this.rpcClient.off(progressHandler);
			this.busy = false;
			if (this.state === PiProcessState.BUSY) {
				this.state = PiProcessState.READY;
			}
		}
	}

	/**
	 * 设置 Extension UI bridge：PI 请求 → Obsidian Modal/Notice
	 */
	setupExtensionUiBridge(): void {
		if (this._bridgeSetup) return;
		this._bridgeSetup = true;
		this.rpcClient.onExtensionUiRequest(async (req: PiExtensionUiRequestEvent): Promise<PiExtensionUiResponse> => {
			switch (req.method) {
				case 'confirm': {
					return new Promise((resolve) => {
						const modal = new ConfirmModal(
							this.app,
							req.title ?? '确认',
							req.message ?? '',
							() => resolve({ type: 'extension_ui_response', id: req.id, confirmed: true }),
							{ onCancel: () => resolve({ type: 'extension_ui_response', id: req.id, cancelled: true }) },
						);
						modal.open();
					});
				}
				case 'select': {
					// select 需要列表选择 Modal，暂回退为取消
					return { type: 'extension_ui_response', id: req.id, cancelled: true };
				}
				default:
					return { type: 'extension_ui_response', id: req.id, cancelled: true };
			}
		});
	}

	/**
	 * 中途引导 PI 执行方向
	 */
	async steer(message: string): Promise<void> {
		await this.rpcClient.steer(message);
	}

	/**
	 * 追加额外指令
	 */
	async followUp(message: string): Promise<void> {
		await this.rpcClient.followUp(message);
	}

	/**
	 * 尝试获取 session 统计（失败不影响主流程）
	 */
	private async tryGetSessionStats(): Promise<import('./types.js').SessionStatsResult | undefined> {
		try {
			return await this.rpcClient.getSessionStats();
		} catch {
			return undefined;
		}
	}

	/**
	 * 解析并验证 PI 输出的 Excalidraw 文件路径
	 * - 精确路径存在时直接返回
	 * - 不存在时搜索同前缀候选文件（按扩展名优先级 + 修改时间排序）
	 * - 最后验证文件是有效的 Excalidraw JSON
	 *
	 * @throws {Error} 文件不存在或无效
	 */
	private async resolveOutputFile(outputPath: string, workingDir: string): Promise<string> {
		const absoluteOutputPath = join(workingDir, outputPath);

		if (existsSync(absoluteOutputPath)) {
			// 精确路径存在，快速验证后直接返回
			await this.validateExcalidrawFile(absoluteOutputPath);
			return outputPath;
		}

		// 精确路径不存在，搜索同前缀候选文件并按扩展名优先级 + 修改时间排序
		const outputBase = basename(outputPath).replace(/\.[^.]+$/, '');
		const outputDirAbs = dirname(absoluteOutputPath);
		const preferredExtensions = ['.excalidraw.md', '.excalidraw', '.md'];

		let finalPath = outputPath;

		try {
			const dirFiles = await readdir(outputDirAbs);
			const allFiles = dirFiles.filter(f => f.startsWith(outputBase) && f !== basename(outputPath));

			type CandidateFile = { name: string; mtimeMs: number; extScore: number };
			const candidates: CandidateFile[] = await Promise.all(allFiles.map(async f => {
				const ext = '.' + f.split('.').slice(1).join('.');
				const extScore = preferredExtensions.indexOf(ext) >= 0
					? (preferredExtensions.length - preferredExtensions.indexOf(ext))
					: 0;
				let mtimeMs = 0;
				try {
					const s = await stat(join(outputDirAbs, f));
					mtimeMs = s.mtimeMs;
				} catch { /* ignore */ }
				return { name: f, mtimeMs, extScore };
			}));

			candidates.sort((a, b) => {
				if (a.extScore !== b.extScore) return b.extScore - a.extScore;
				return b.mtimeMs - a.mtimeMs;
			});

			if (candidates.length > 0) {
				finalPath = join(dirname(outputPath), candidates[0].name);
				log(`[PiManager] File path mismatch, found: ${finalPath} (expected: ${outputPath}), extScore=${candidates[0].extScore}`);
			}
		} catch { /* ignore */ }

		const resolvedPath = join(workingDir, finalPath);
		if (!existsSync(resolvedPath)) {
			throw new Error('PI 未写入输出文件，可能未执行写入操作');
		}

		await this.validateExcalidrawFile(resolvedPath);
		return finalPath;
	}

	/**
	 * 验证文件是有效的 Excalidraw JSON（防误选旧文件或错误文件）
	 * @throws {Error} 文件不存在、无效 JSON 或缺少 elements 数组
	 */
	private async validateExcalidrawFile(filePath: string): Promise<void> {
		const fileContent = await readFile(filePath, 'utf-8');
		try {
			const parsed = JSON.parse(fileContent);
			if (!Array.isArray(parsed.elements)) {
				throw new Error(`File at ${filePath} is not valid Excalidraw JSON (missing elements array)`);
			}
		} catch (err) {
			if (err instanceof SyntaxError) {
				throw new Error(`PI 写入的文件不是有效的 JSON 格式`);
			}
			throw err;
		}
	}

	/**
	 * 从 agent_end 事件的 thinking 块中提取 token 用量统计（避免额外 RPC）
	 *
	 * PI 在 thinking 块中嵌入用量信息，格式如：
	 * <!-- usage: {"input_tokens":100,"output_tokens":200,"cache_read":50,"cache_write":30} -->
	 *
	 * 若提取失败则返回 undefined，调用方会 fallback 到 getSessionStats RPC。
	 */
	private tryExtractStatsFromAgentEnd(event: import('./types.js').PiAgentEndEvent | null): import('./types.js').SessionStatsResult | undefined {
		if (!event?.messages) return undefined;

		try {
			// 扫描所有 thinking 块，查找 usage 元信息
			let usageJson: string | null = null;
			for (const msg of event.messages) {
				if (msg.role !== 'assistant') continue;
				for (const block of msg.content ?? []) {
					if (block.thinking) {
						const match = block.thinking.match(/<!--\s*usage:\s*(\{[^}]+\})\s*-->/);
						if (match) {
							usageJson = match[1];
							break;
						}
					}
				}
				if (usageJson) break;
			}

			if (!usageJson) return undefined;

			const usage = JSON.parse(usageJson);
			const input = usage.input_tokens ?? usage.prompt_tokens ?? 0;
			const output = usage.output_tokens ?? usage.completion_tokens ?? 0;
			const cacheRead = usage.cache_read ?? usage.cached_tokens ?? 0;
			const cacheWrite = usage.cache_write ?? 0;

			return {
				sessionFile: '',
				sessionId: '',
				userMessages: event.messages.filter(m => m.role === 'user').length,
				assistantMessages: event.messages.filter(m => m.role === 'assistant').length,
				toolCalls: 0,
				totalMessages: event.messages.length,
				tokens: {
					input,
					output,
					cacheRead,
					cacheWrite,
					total: input + output,
				},
				cost: 0,
			};
		} catch {
			return undefined;
		}
	}

	/**
	 * 从 App 实例构建 PiConfig
	 */
	buildConfig(apiKey: string, model: string, provider: string, customPiPath?: string): PiConfig {
		const paths = resolvePiPaths(this.app);
		// 只加载 excalidraw skill（避免加载整个 skillsDir），若不存在则 fallback
		const excalidrawSkillPath = `${paths.skillsDir}/excalidraw`;
		const skillPath = existsSync(excalidrawSkillPath) ? excalidrawSkillPath : undefined;
		return {
			apiKey,
			model,
			provider,
			skillsDir: paths.skillsDir,
			skillPath,
			sessionDir: paths.sessionDir,
			exportsDir: paths.exportsDir,
			workingDir: paths.workingDir,
			customPiPath,
		};
	}

	private renderPromptTemplate(
		context: PiSkillContext,
		tocBlock: string,
		structuralBlock: string,
		analysisBlock: string,
	): string {
		return `## 任务上下文
书籍: ${context.book.title} - ${context.book.author}
当前章节: ${context.context.currentSection}
章节摘要: ${context.context.analysisSummary}${tocBlock}${structuralBlock}${analysisBlock}
## 用户请求
${context.userRequest}

## 输出要求
使用 excalidraw skill 生成可视化图表。
输出文件路径: ${context.outputPath}。
重要约束：
1. 必须使用 write 工具写入上述精确路径，不要修改文件名或扩展名
2. 生成完成后用 python 验证 JSON 合法性（json.load），但跳过 render 步骤（不需要 PNG 截图）
3. 如果 JSON 验证失败，修复后重新 write`;
	}

	private buildPrompt(context: PiSkillContext): string {
		const maxPromptLength = 25000;
		const maxContentLength = maxPromptLength - 400;

		const structuralRaw = context.context.structuralAnalysis || '';
		const analysisRaw = context.context.analysisData || '';
		const tocRaw = context.context.tocSummary || '';

		// structuralAnalysis 对可视化最关键，给 50%；analysis 35%；toc 15%
		const structuralBlock = structuralRaw
			? `\n## 结构分析\n${structuralRaw.slice(0, Math.floor(maxContentLength * 0.5))}\n`
			: '';
		const analysisBlock = analysisRaw
			? `\n## 分析内容\n${analysisRaw.slice(0, Math.floor(maxContentLength * 0.35))}\n`
			: '';
		const tocBlock = tocRaw
			? `\n## 目录概览\n${tocRaw.slice(0, Math.floor(maxContentLength * 0.15))}\n`
			: '';

		const prompt = this.renderPromptTemplate(context, tocBlock, structuralBlock, analysisBlock);

		if (prompt.length <= maxPromptLength) return prompt;

		// 总长超限：按比例压缩，analysis 压缩最多
		const excess = prompt.length - maxPromptLength;
		const shrinkPerBlock = Math.ceil(excess / 3);
		const shrink = (text: string, n: number) => text.slice(0, Math.max(0, text.length - n));
		return this.renderPromptTemplate(
			context,
			shrink(tocBlock, shrinkPerBlock),
			shrink(structuralBlock, shrinkPerBlock),
			shrink(analysisBlock, shrinkPerBlock * 2),
		);
	}
}
