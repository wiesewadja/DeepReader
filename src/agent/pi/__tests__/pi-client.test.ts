/**
 * PiRpcClient 单元测试
 *
 * 验证 JSONL 帧解析、命令序列化、事件分发。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PiRpcClient } from '../pi-client.js';
import type { PiEvent } from '../types.js';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

// Mock child process with EventEmitter-based stdout/stdin
function createMockProcess() {
	const stdout = new EventEmitter();
	const stdin = { write: vi.fn(), writable: true };
	const stderr = new EventEmitter();

	return {
		stdout,
		stdin,
		stderr,
		kill: vi.fn(),
	} as unknown as ChildProcess;
}

describe('PiRpcClient', () => {
	let client: PiRpcClient;
	let mockProc: ChildProcess;

	beforeEach(() => {
		client = new PiRpcClient();
		mockProc = createMockProcess();
		client.attach(mockProc);
	});

	describe('sendCommand', () => {
		it('应将命令序列化为 JSONL 写入 stdin', () => {
			client.sendCommand({ type: 'prompt', message: 'hello' });
			expect((mockProc as any).stdin.write).toHaveBeenCalledWith(
				'{"type":"prompt","message":"hello"}\n'
			);
		});
	});

	describe('JSONL 帧解析', () => {
		it('应按 \\n 分割完整行', () => {
			const handler = vi.fn();
			client.on(handler);

			// 模拟 PI 输出两行 JSONL
			const data = '{"type":"agent_start"}\n{"type":"agent_end","messages":[]}\n';
			(mockProc as any).stdout.emit('data', data);

			expect(handler).toHaveBeenCalledTimes(2);
			expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent_start' }));
			expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent_end' }));
		});

		it('应处理跨 chunk 的不完整行', () => {
			const handler = vi.fn();
			client.on(handler);

			// 第一 chunk：不完整的行
			(mockProc as any).stdout.emit('data', '{"type":"agent_start"}\n{"type":"agent');
			expect(handler).toHaveBeenCalledTimes(1);

			// 第二 chunk：补全剩余
			(mockProc as any).stdout.emit('data', '_end","messages":[]}\n');
			expect(handler).toHaveBeenCalledTimes(2);
		});

		it('应去除尾部 \\r', () => {
			const handler = vi.fn();
			client.on(handler);

			(mockProc as any).stdout.emit('data', '{"type":"agent_start"}\r\n');
			expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent_start' }));
		});

		it('应忽略空行', () => {
			const handler = vi.fn();
			client.on(handler);

			(mockProc as any).stdout.emit('data', '\n\n{"type":"agent_start"}\n\n');
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('不应将 U+2028 和 U+2029 视为换行符', () => {
			const handler = vi.fn();
			client.on(handler);

			// U+2028/U+2029 是合法 JSON 字符串内容，不应被分割
			const jsonWithSpecialChars = '{"type":"agent_start","msg":"line1 line2 line3"}\n';
			(mockProc as any).stdout.emit('data', jsonWithSpecialChars);

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'agent_start',
					msg: 'line1 line2 line3',
				})
			);
		});
	});

	describe('事件订阅', () => {
		it('on/off 应正确管理订阅', () => {
			const handler = vi.fn();
			client.on(handler);

			(mockProc as any).stdout.emit('data', '{"type":"agent_start"}\n');
			expect(handler).toHaveBeenCalledTimes(1);

			client.off(handler);
			(mockProc as any).stdout.emit('data', '{"type":"agent_end","messages":[]}\n');
			expect(handler).toHaveBeenCalledTimes(1); // 不再收到事件
		});
	});

	describe('waitForAgentEnd', () => {
		it('应在收到 agent_end 事件时 resolve', async () => {
			const promise = client.waitForAgentEnd(5000);

			// 模拟 agent_end
			setTimeout(() => {
				(mockProc as any).stdout.emit('data', '{"type":"agent_end","messages":[{"role":"assistant","content":[{"type":"text","text":"OK"}]}]}\n');
			}, 10);

			const result = await promise;
			expect(result.type).toBe('agent_end');
			expect(result.messages?.[0]?.role).toBe('assistant');
		});

		it('应在超时时 reject', async () => {
			await expect(client.waitForAgentEnd(50)).rejects.toThrow('Timed out');
		});
	});

	describe('sendCommandAndWait', () => {
		it('应在收到匹配 id 的 response 时 resolve', async () => {
			const promise = client.sendCommandAndWait({ type: 'new_session' }, 5000);

			// 获取实际写入的命令中的 id
			const written = (mockProc as any).stdin.write.mock.calls[0][0] as string;
			const parsed = JSON.parse(written);
			const id = parsed.id;

			// 模拟 response
			setTimeout(() => {
				(mockProc as any).stdout.emit('data', `{"type":"response","command":"new_session","success":true,"id":"${id}"}\n`);
			}, 10);

			const result = await promise;
			expect(result.success).toBe(true);
			expect(result.command).toBe('new_session');
		});

		it('应在超时时 reject', async () => {
			await expect(
				client.sendCommandAndWait({ type: 'abort' }, 50)
			).rejects.toThrow('timed out');
		});
	});
});
