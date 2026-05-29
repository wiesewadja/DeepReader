/**
 * PiRpcClient 单元测试
 *
 * 验证 JSONL 帧解析、命令序列化、事件分发。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PiRpcClient } from '@/agent/pi/pi-client';
import type { PiEvent } from '@/agent/pi/types';
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

	describe('sendPromptStream', () => {
		it('应逐步 yield 事件直到 agent_end', async () => {
			// 模拟流式输出：agent_start → message_update → agent_end
			setTimeout(() => {
				(mockProc as any).stdout.emit('data', '{"type":"agent_start"}\n');
				(mockProc as any).stdout.emit('data', '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Hello"}}\n');
				(mockProc as any).stdout.emit('data', '{"type":"agent_end","messages":[]}\n');
			}, 10);

			const events: PiEvent[] = [];
			for await (const event of client.sendPromptStream('test', 5000)) {
				events.push(event);
			}

			expect(events).toHaveLength(3);
			expect(events[0].type).toBe('agent_start');
			expect(events[1].type).toBe('message_update');
			expect(events[2].type).toBe('agent_end');
		});

		it('应处理空流（直接 agent_end）', async () => {
			setTimeout(() => {
				(mockProc as any).stdout.emit('data', '{"type":"agent_end","messages":[]}\n');
			}, 10);

			const events: PiEvent[] = [];
			for await (const event of client.sendPromptStream('test', 5000)) {
				events.push(event);
			}

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe('agent_end');
		});

		it('应在超时时 throw', async () => {
			const gen = client.sendPromptStream('test', 50);
			await expect(gen.next()).rejects.toThrow('timed out');
		});

		describe('setAutoRetry', () => {
			it('应发送 set_auto_retry 命令并在成功时 resolve', async () => {
				const promise = client.setAutoRetry(true, 5000);

				const written = (mockProc as any).stdin.write.mock.calls[0][0] as string;
				const parsed = JSON.parse(written);
				expect(parsed.type).toBe('set_auto_retry');
				expect(parsed.enabled).toBe(true);

				setTimeout(() => {
					(mockProc as any).stdout.emit('data', '{"type":"response","command":"set_auto_retry","success":true,"id":"' + parsed.id + '"}\n');
				}, 10);

				await promise;
			});

			it('应在失败时 reject', async () => {
				const promise = client.setAutoRetry(true, 5000);

				const written = (mockProc as any).stdin.write.mock.calls[0][0] as string;
				const parsed = JSON.parse(written);

				setTimeout(() => {
					(mockProc as any).stdout.emit('data', '{"type":"response","command":"set_auto_retry","success":false,"error":"not supported","id":"' + parsed.id + '"}\n');
				}, 10);

				await expect(promise).rejects.toThrow('set_auto_retry failed');
			});
		});

		describe('abortRetry', () => {
			it('应发送 abort_retry 命令并在成功时 resolve', async () => {
				const promise = client.abortRetry(5000);

				const written = (mockProc as any).stdin.write.mock.calls[0][0] as string;
				const parsed = JSON.parse(written);
				expect(parsed.type).toBe('abort_retry');

				setTimeout(() => {
					(mockProc as any).stdout.emit('data', '{"type":"response","command":"abort_retry","success":true,"id":"' + parsed.id + '"}\n');
				}, 10);

				await promise;
			});
		});

	});


	describe('Extension UI', () => {
		it('无 handler 时 extension_ui_request 应自动取消', () => {
			const handler = vi.fn();
			client.on(handler);

			(mockProc as any).stdout.emit('data', '{"type":"extension_ui_request","id":"ui-1","method":"confirm","title":"Test","message":"OK?"}\n');

			// handler 不应收到 extension_ui_request（被 dispatch 拦截）
			expect(handler).not.toHaveBeenCalled();

			// 应发送取消响应
			const calls = (mockProc as any).stdin.write.mock.calls;
			const lastCall = calls[calls.length - 1][0] as string;
			const resp = JSON.parse(lastCall);
			expect(resp.type).toBe('extension_ui_response');
			expect(resp.id).toBe('ui-1');
			expect(resp.cancelled).toBe(true);
		});

		it('有 handler 时 extension_ui_request 应调用 handler 并发送响应', async () => {
			const uiHandler = vi.fn().mockResolvedValue({
				type: 'extension_ui_response',
				id: 'ui-2',
				confirmed: true,
			});
			client.onExtensionUiRequest(uiHandler);

			(mockProc as any).stdout.emit('data', '{"type":"extension_ui_request","id":"ui-2","method":"confirm","title":"Test","message":"OK?"}\n');

			// 等待 async handler
			await new Promise(r => setTimeout(r, 20));

			expect(uiHandler).toHaveBeenCalledWith(expect.objectContaining({
				type: 'extension_ui_request',
				id: 'ui-2',
				method: 'confirm',
			}));

			const calls = (mockProc as any).stdin.write.mock.calls;
			const lastCall = calls[calls.length - 1][0] as string;
			const resp = JSON.parse(lastCall);
			expect(resp.type).toBe('extension_ui_response');
			expect(resp.confirmed).toBe(true);
		});

		it('fire-and-forget 类型应广播但不发送响应', () => {
			const handler = vi.fn();
			client.on(handler);

			const writeCallCount = (mockProc as any).stdin.write.mock.calls.length;

			(mockProc as any).stdout.emit('data', '{"type":"extension_ui_request","id":"ui-3","method":"notify","message":"hello"}\n');

			// handler 应收到广播
			expect(handler).toHaveBeenCalledWith(expect.objectContaining({
				type: 'extension_ui_request',
				method: 'notify',
			}));

			// 不应发送响应（write 调用次数不变）
			expect((mockProc as any).stdin.write.mock.calls.length).toBe(writeCallCount);
		});
	});
});
