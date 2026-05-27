/**
 * PI Agent RPC 客户端
 *
 * 通过 JSONL 协议与 PI 子进程通信。
 * 不使用 Node readline（它误把 U+2028/U+2029 当换行符）。
 */

import type { ChildProcess } from 'child_process';
import type { PiCommand, PiEvent, PiAgentEndEvent } from './types.js';
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

		// Dispatch to all handlers
		for (const handler of this.handlers) {
			try {
				handler(event);
			} catch (e) {
				logError(`[PiRpc] Handler error: ${e}`);
			}
		}
	}
}
