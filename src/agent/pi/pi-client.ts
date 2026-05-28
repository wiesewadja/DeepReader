/**
 * PI Agent RPC 客户端
 *
 * 通过 JSONL 协议与 PI 子进程通信。
 * 不使用 Node readline（它误把 U+2028/U+2029 当换行符）。
 */

import type { ChildProcess } from 'child_process';
import type { PiCommand, PiEvent, PiAgentEndEvent, PiExtensionUiRequestEvent, PiExtensionUiResponse, SessionStatsResult } from './types.js';
import { agentLog as log, error as logError } from '../../utils/logger.js';

export type PiEventHandler = (event: PiEvent) => void;

export class PiRpcClient {
	private childProcess: ChildProcess | null = null;
	private stdoutBuffer = '';
	private handlers: PiEventHandler[] = [];
	private pendingResponse: {
		resolve: (event: PiEvent & { type: 'response' }) => void;
		reject: (err: Error) => void;
		id: string;
	} | null = null;
	private extensionUiHandler: ((req: PiExtensionUiRequestEvent) => Promise<PiExtensionUiResponse>) | null = null;

	/**
	 * 绑定到已有子进程（由 PiProcessManager spawn）
	 */
	attach(proc: ChildProcess): void {
		this.childProcess = proc;

		proc.stdout?.on('data', (chunk: Buffer | string) => {
			this.stdoutBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
			this.drainBuffer();
		});

		proc.stderr?.on('data', (data: Buffer | string) => {
			logError(`[PiRpc] stderr: ${data}`);
		});
	}

	/**
	 * 断开与子进程的绑定
	 */
	detach(): void {
		this.childProcess = null;
		this.stdoutBuffer = '';
		this.handlers = [];
		this.pendingResponse = null;
	}

	/**
	 * 发送 RPC 命令
	 */
	sendCommand(cmd: PiCommand): void {
		if (!this.childProcess) {
			throw new Error('[PiRpc] Cannot send command: PI process not attached');
		}
		if (!this.childProcess.stdin) {
			throw new Error('[PiRpc] Cannot send command: PI process stdin unavailable');
		}
		if (!this.childProcess.stdin.writable) {
			throw new Error('[PiRpc] Cannot send command: PI process stdin not writable');
		}
		const line = JSON.stringify(cmd) + '\n';
		log(`[PiRpc] → ${cmd.type}${cmd.id ? ` (${cmd.id})` : ''}`);
		this.childProcess.stdin.write(line);
	}

	/**
	 * 发送命令并等待 response 事件
	 */
	async sendCommandAndWait(cmd: PiCommand & { id?: string }, timeoutMs = 10000): Promise<PiEvent & { type: 'response' }> {
		const id = cmd.id ?? `req-${Date.now()}`;
		const cmdWithId = { ...cmd, id };

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingResponse = null;
				reject(new Error(`[PiRpc] Command ${cmd.type} timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			this.pendingResponse = {
				id,
				resolve: (evt) => {
					clearTimeout(timer);
					resolve(evt);
				},
				reject,
			};

			this.sendCommand(cmdWithId);
		});
	}

	/**
	 * 发送 prompt 并等待 agent_end
	 */
	async sendPrompt(message: string, timeoutMs = 60000): Promise<PiAgentEndEvent> {
		this.sendCommand({ type: 'prompt', message });

		return this.waitForAgentEnd(timeoutMs);
	}

	/**
	 * 等待 agent_end 事件
	 */
	async waitForAgentEnd(timeoutMs = 60000): Promise<PiAgentEndEvent> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`[PiRpc] Timed out waiting for agent_end (${timeoutMs}ms)`));
			}, timeoutMs);

			const handler: PiEventHandler = (event) => {
				if (event.type === 'agent_end') {
					clearTimeout(timer);
					this.off(handler);
					resolve(event);
				}
			};

			this.on(handler);
		});
	}

	/**
	 * 发送 new_session 命令
	 */
	async newSession(timeoutMs = 10000): Promise<void> {
		const resp = await this.sendCommandAndWait({ type: 'new_session' }, timeoutMs);
		if (!resp.success) {
			throw new Error(`[PiRpc] new_session failed: ${resp.error ?? 'unknown'}`);
		}
		log('[PiRpc] Session reset');
	}

	/**
	 * 发送 abort 命令
	 */
	async abort(timeoutMs = 5000): Promise<void> {
		const resp = await this.sendCommandAndWait({ type: 'abort' }, timeoutMs);
		if (!resp.success) {
			throw new Error(`[PiRpc] abort failed: ${resp.error ?? 'unknown'}`);
		}
		log('[PiRpc] Aborted');
	}

	/**
	 * 启用/禁用自动重试
	 */
	async setAutoRetry(enabled: boolean, timeoutMs = 5000): Promise<void> {
		const resp = await this.sendCommandAndWait({ type: 'set_auto_retry', enabled }, timeoutMs);
		if (!resp.success) {
			throw new Error(`[PiRpc] set_auto_retry failed: ${resp.error ?? 'unknown'}`);
		}
		log(`[PiRpc] Auto retry ${enabled ? 'enabled' : 'disabled'}`);
	}

	/**
	 * 中止当前自动重试
	 */
	async abortRetry(timeoutMs = 5000): Promise<void> {
		const resp = await this.sendCommandAndWait({ type: 'abort_retry' }, timeoutMs);
		if (!resp.success) {
			throw new Error(`[PiRpc] abort_retry failed: ${resp.error ?? 'unknown'}`);
		}
		log('[PiRpc] Retry aborted');
	}

	/**
	 * 获取 session 统计信息
	 */
	async getSessionStats(timeoutMs = 5000): Promise<SessionStatsResult> {
		const resp = await this.sendCommandAndWait({ type: 'get_session_stats' }, timeoutMs);
		if (!resp.success) {
			throw new Error(`[PiRpc] get_session_stats failed: ${resp.error ?? 'unknown'}`);
		}
		return resp.data as SessionStatsResult;
	}

	/**
	 * 获取当前 session 状态
	 */
	async getState(timeoutMs = 5000): Promise<Record<string, unknown>> {
		const resp = await this.sendCommandAndWait({ type: 'get_state' }, timeoutMs);
		if (!resp.success) {
			throw new Error(`[PiRpc] get_state failed: ${resp.error ?? 'unknown'}`);
		}
		return (resp.data ?? {}) as Record<string, unknown>;
	}

	/**
	 * 手动压缩上下文
	 */
	async compact(customInstructions?: string, timeoutMs = 30000): Promise<void> {
		const resp = await this.sendCommandAndWait({ type: 'compact', customInstructions }, timeoutMs);
		if (!resp.success) {
			throw new Error(`[PiRpc] compact failed: ${resp.error ?? 'unknown'}`);
		}
		log('[PiRpc] Context compacted');
	}

	/**
	 * 启用/禁用自动压缩
	 */
	async setAutoCompaction(enabled: boolean, timeoutMs = 5000): Promise<void> {
		const resp = await this.sendCommandAndWait({ type: 'set_auto_compaction', enabled }, timeoutMs);
		if (!resp.success) {
			throw new Error(`[PiRpc] set_auto_compaction failed: ${resp.error ?? 'unknown'}`);
		}
		log(`[PiRpc] Auto compaction ${enabled ? 'enabled' : 'disabled'}`);
	}

	/**
	 * 中途引导：调整 PI 当前执行方向
	 */
	async steer(message: string, timeoutMs = 10000): Promise<void> {
		const resp = await this.sendCommandAndWait({ type: 'steer', message }, timeoutMs);
		if (!resp.success) {
			throw new Error(`[PiRpc] steer failed: ${resp.error ?? 'unknown'}`);
		}
		log('[PiRpc] Steer sent');
	}

	/**
	 * 追加消息：在当前执行中追加额外指令
	 */
	async followUp(message: string, timeoutMs = 10000): Promise<void> {
		const resp = await this.sendCommandAndWait({ type: 'follow_up', message }, timeoutMs);
		if (!resp.success) {
			throw new Error(`[PiRpc] follow_up failed: ${resp.error ?? 'unknown'}`);
		}
		log('[PiRpc] Follow-up sent');
	}

	/**
	 * 流式发送 prompt：返回 AsyncGenerator 逐步 yield 所有事件，直到 agent_end。
	 */
	async *sendPromptStream(
		message: string,
		timeoutMs = 60000,
	): AsyncGenerator<PiEvent, void, void> {
		this.sendCommand({ type: 'prompt', message });

		const MAX_QUEUE_SIZE = 10000;
		const eventQueue: PiEvent[] = [];
		let resolveWait: (() => void) | null = null;
		let done = false;
		let error: Error | null = null;

		const timer = setTimeout(() => {
			error = new Error(`[PiRpc] sendPromptStream timed out (${timeoutMs}ms)`);
			resolveWait?.();
		}, timeoutMs);

		// 监听进程 stdout EOF，提前结束 generator
		const onStdoutEnd = () => {
			if (!done) {
				error = new Error('[PiRpc] PI process stdout closed unexpectedly');
				resolveWait?.();
			}
		};
		this.childProcess?.stdout?.once('end', onStdoutEnd);

		const handler: PiEventHandler = (event) => {
			if (event.type === 'agent_end') {
				done = true;
				clearTimeout(timer);
				this.off(handler);
			}
			if (eventQueue.length >= MAX_QUEUE_SIZE) {
				logError(`[PiRpc] eventQueue exceeded ${MAX_QUEUE_SIZE}, dropping oldest event`);
				eventQueue.shift();
			}
			eventQueue.push(event);
			resolveWait?.();
		};
		this.on(handler);

		try {
			while (!done) {
				if (error) throw error;
				while (eventQueue.length > 0) {
					yield eventQueue.shift()!;
				}
				if (!done) {
					await new Promise<void>((r) => { resolveWait = r; });
				}
			}
			// Drain remaining
			while (eventQueue.length > 0) {
				yield eventQueue.shift()!;
			}
		} finally {
			clearTimeout(timer);
			this.childProcess?.stdout?.removeListener('end', onStdoutEnd);
			this.off(handler);
		}
	}

	/**
	 * 订阅事件
	 */
	on(handler: PiEventHandler): void {
		this.handlers.push(handler);
	}

	/**
	 * 取消订阅
	 */
	off(handler: PiEventHandler): void {
		this.handlers = this.handlers.filter(h => h !== handler);
	}

	/**
	 * 注册 Extension UI 请求处理函数
	 */
	onExtensionUiRequest(handler: (req: PiExtensionUiRequestEvent) => Promise<PiExtensionUiResponse>): void {
		this.extensionUiHandler = handler;
	}

	// ─── 内部方法 ───

	private drainBuffer(): void {
		while (true) {
			const nlIndex = this.stdoutBuffer.indexOf('\n');
			if (nlIndex === -1) break;

			let line = this.stdoutBuffer.substring(0, nlIndex);
			this.stdoutBuffer = this.stdoutBuffer.substring(nlIndex + 1);

			if (line.endsWith('\r')) {
				line = line.substring(0, line.length - 1);
			}

			if (!line.trim()) continue;

			try {
				const event = JSON.parse(line) as PiEvent;
				this.dispatch(event);
			} catch (e) {
				logError(`[PiRpc] Failed to parse event: ${line.substring(0, 100)}`);
			}
		}
	}

	private dispatch(event: PiEvent): void {
		// Handle pending response
		if (event.type === 'response' && this.pendingResponse) {
			const resp = event as PiEvent & { type: 'response'; id?: string };
			if (resp.id === this.pendingResponse.id) {
				this.pendingResponse.resolve(resp);
				this.pendingResponse = null;
			}
		}

		// Extension UI 请求 → 特殊处理
		if (event.type === 'extension_ui_request') {
			this.handleExtensionUiRequest(event as PiExtensionUiRequestEvent);
			return;
		}

		// Dispatch to all handlers
		for (const handler of this.handlers) {
			try {
				handler(event);
			} catch (e) {
				logError(`[PiRpc] Handler error: ${e}`);
			}
		}
	}

	private handleExtensionUiRequest(req: PiExtensionUiRequestEvent): void {
		// fire-and-forget 类型直接广播给 UI 层
		const fireAndForget = ['notify', 'setStatus', 'setWidget', 'setTitle', 'set_editor_text'];
		if (fireAndForget.includes(req.method)) {
			for (const handler of this.handlers) {
				try {
					handler(req);
				} catch (e) {
					logError(`[PiRpc] Extension UI handler error: ${e}`);
				}
			}
			return;
		}

		// dialog 类型 → 等待用户响应
		if (this.extensionUiHandler) {
			this.extensionUiHandler(req).then((resp) => {
				this.sendCommand(resp);
			}).catch(() => {
				this.sendCommand({ type: 'extension_ui_response', id: req.id, cancelled: true });
			});
		} else {
			// 无 handler → 取消
			this.sendCommand({ type: 'extension_ui_response', id: req.id, cancelled: true });
		}
	}
}
