/**
 * Server Manager 测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'child_process';

// Mock child_process
vi.mock('child_process', () => ({
    spawn: vi.fn()
}));

import { ServerManager } from '../server-manager.js';

describe('ServerManager', () => {
    let manager: ServerManager;
    const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn()
    };

    beforeEach(() => {
        vi.clearAllMocks();
        manager = new ServerManager(8000);
        (spawn as any).mockReturnValue(mockProcess);
    });

    afterEach(() => {
        if ((manager as any).process) {
            manager.stop();
        }
    });

    describe('start', () => {
        it('should start server with correct command', async () => {
            const startPromise = manager.start('/path/to/backend');

            // 模拟服务器启动成功
            setTimeout(() => {
                const stdoutCallback = mockProcess.stdout.on.mock.calls[0][1];
                stdoutCallback('Application startup complete');
            }, 100);

            await startPromise;

            expect(spawn).toHaveBeenCalledWith('uv', [
                '--directory', '/path/to/backend',
                'run', 'uvicorn',
                'deeppdf.main:app',
                '--port', '8000',
                '--loop', 'asyncio'
            ], expect.any(Object));
        });

        it('should detect server ready from output', async () => {
            const startPromise = manager.start('/path/to/backend');

            setTimeout(() => {
                const stdoutCallback = mockProcess.stdout.on.mock.calls[0][1];
                stdoutCallback('Uvicorn running on http://127.0.0.1:8000');
            }, 50);

            await startPromise;
            expect((manager as any).ready).toBe(true);
        });

        it('should handle stderr output', async () => {
            const startPromise = manager.start('/path/to/backend');

            setTimeout(() => {
                const stderrCallback = mockProcess.stderr.on.mock.calls[0][1];
                stderrCallback('INFO: Started server process');
                const stdoutCallback = mockProcess.stdout.on.mock.calls[0][1];
                stdoutCallback('Application startup complete');
            }, 50);

            await startPromise;
        });

        it('should handle process exit', async () => {
            mockProcess.on.mockImplementation((event: string, callback: Function) => {
                if (event === 'exit') {
                    setTimeout(() => callback(1, 'SIGTERM'), 50);
                }
            });

            const startPromise = manager.start('/path/to/backend');

            try {
                await startPromise;
                expect.fail('Should have thrown an error');
            } catch (error: any) {
                expect(error.message).toContain('Server exited');
            }
        });

        it('should use custom port', async () => {
            const customManager = new ServerManager(9000);
            const startPromise = customManager.start('/path/to/backend');

            setTimeout(() => {
                const stdoutCallback = mockProcess.stdout.on.mock.calls[0][1];
                stdoutCallback('Application startup complete');
            }, 50);

            await startPromise;

            expect(spawn).toHaveBeenCalledWith('uv', [
                '--directory', '/path/to/backend',
                'run', 'uvicorn',
                'deeppdf.main:app',
                '--port', '9000',
                '--loop', 'asyncio'
            ], expect.any(Object));
        });
    });

    describe('stop', () => {
        it('should stop running server', async () => {
            // 先启动服务器
            const startPromise = manager.start('/path/to/backend');
            setTimeout(() => {
                const stdoutCallback = mockProcess.stdout.on.mock.calls[0][1];
                stdoutCallback('Application startup complete');
            }, 50);
            await startPromise;

            // 停止服务器
            manager.stop();

            expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
            expect((manager as any).process).toBeNull();
        });

        it('should handle stop when no process running', () => {
            expect(() => manager.stop()).not.toThrow();
        });
    });

    describe('isRunning', () => {
        it('should return true when server is running', async () => {
            const startPromise = manager.start('/path/to/backend');
            setTimeout(() => {
                const stdoutCallback = mockProcess.stdout.on.mock.calls[0][1];
                stdoutCallback('Application startup complete');
            }, 50);
            await startPromise;

            expect(manager.isRunning()).toBe(true);
        });

        it('should return false when server is not running', () => {
            expect(manager.isRunning()).toBe(false);
        });
    });
});
