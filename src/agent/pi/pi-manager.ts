/**
 * PI Agent 进程管理器
 *
 * 懒启动、长驻、new_session 隔离、崩溃重启、超时 abort、并发拒绝。
 */

import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
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
		if (!piStatus.available) {
			this.state = PiProcessState.ERROR;
			throw new Error('PI CLI not found. Please install PI and retry.');
		}
		const piBin = piStatus.path ?? 'pi';

		const args = buildSpawnArgs(config);
		const spawnEnv = { ...buildSpawnEnv(), ANTHROPIC_API_KEY: config.apiKey };

		this.process = spawn(piBin, args, {
			cwd: config.workingDir,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: spawnEnv,
		});

		this.process.on('error', (err) => {
			logError(`[PiManager] Process error: ${err.message}`);
			this.state = PiProcessState.ERROR;
			this.process = null;
		});

		this.process.on('close', (code) => {
			log(`[PiManager] Process exited with code ${code}`);
			if (this.state !== PiProcessState.STOPPED) {
				// 异常退出，标记为错误状态（下次调用会重启）
				this.state = PiProcessState.ERROR;
			}
			this.process = null;
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
	}

	/**
	 * 强制清理进程资源
	 */
	private killProcess(): void {
		if (this.process) {
			this.process.kill();
			this.process = null;
			this.rpcClient.detach();
			this.state = PiProcessState.ERROR;
		}
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
			};
		}

		this.busy = true;
		this.state = PiProcessState.BUSY;

		// 整体超时保护（含进程启动 + skill 执行）
		const overallTimeout = 90_000;
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
				};
			}

			// 重置上下文
			await this.rpcClient.newSession();

			// 构造 prompt
			const prompt = this.buildPrompt(context);
			log(`[PiManager] Executing skill: ${context.userRequest.substring(0, 50)}...`);

			onProgress?.('PI 已接收任务，正在处理...');

			// 流式执行，逐步 yield 事件
			for await (const event of this.rpcClient.sendPromptStream(prompt, 60_000)) {
				if (event.type === 'message_update') {
					const delta = (event as import('./types.js').PiMessageUpdateEvent).assistantMessageEvent;
					if (delta?.type === 'text_delta' && delta.delta) {
						onStreamDelta?.(delta.delta);
					}
				}
			}

			return {
				outputPath: context.outputPath,
				success: true,
				stats: await this.tryGetSessionStats(),
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logError(`[PiManager] Skill execution failed: ${message}`);

			// 进程可能崩溃，标记错误状态
			if (message.includes('stdin not writable') || message.includes('Timed out')) {
				this.killProcess();
			}

			return {
				outputPath: context.outputPath,
				success: false,
				error: message,
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
	 * 从 App 实例构建 PiConfig
	 */
	buildConfig(apiKey: string, model: string, provider: string, customPiPath?: string): PiConfig {
		const paths = resolvePiPaths(this.app);
		return {
			apiKey,
			model,
			provider,
			skillsDir: paths.skillsDir,
			sessionDir: paths.sessionDir,
			exportsDir: paths.exportsDir,
			workingDir: paths.workingDir,
			customPiPath,
		};
	}

	private buildPrompt(context: PiSkillContext): string {
		const analysisBlock = context.context.analysisData
			? `\n## 分析内容\n${context.context.analysisData.slice(0, 6000)}\n`
			: '';
		const structuralBlock = context.context.structuralAnalysis
			? `\n## 结构分析\n${context.context.structuralAnalysis.slice(0, 4000)}\n`
			: '';
		const tocBlock = context.context.tocSummary
			? `\n## 目录概览\n${context.context.tocSummary.slice(0, 2000)}\n`
			: '';

		return `## 任务上下文
书籍: ${context.book.title} - ${context.book.author}
当前章节: ${context.context.currentSection}
章节摘要: ${context.context.analysisSummary}${tocBlock}${structuralBlock}${analysisBlock}
## 可用 Skill
${context.skillDescriptions.join('\n')}

## 用户请求
${context.userRequest}

## 输出要求
请根据用户请求选择合适的 skill 执行，结果写入文件: ${context.outputPath}`;
	}
}
