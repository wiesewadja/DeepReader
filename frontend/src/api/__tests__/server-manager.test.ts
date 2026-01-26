/**
 * Server Manager 测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock child_process before importing ServerManager
const mockStdoutOn = vi.fn();
const mockStderrOn = vi.fn();
const mockProcessOn = vi.fn();
const mockKill = vi.fn();

const mockProcess = {
    stdout: { on: mockStdoutOn },
    stderr: { on: mockStderrOn },
    on: mockProcessOn,
    kill: mockKill
};

vi.mock('child_process', () => ({
    spawn: vi.fn(() => mockProcess)
}));

// Mock fetch globally
global.fetch = vi.fn(() =>
    Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok' })
    } as Response)
) as any;

import { ServerManager } from '../server-manager.js';
import { spawn } from 'child_process';

describe('ServerManager', () => {
    let manager: ServerManager;

    beforeEach(() => {
        vi.clearAllMocks();
        manager = new ServerManager(8000);
        // 重置 fetch mock
        (global.fetch as any).mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ status: 'ok' })
        });
    });

    afterEach(() => {
        if ((manager as any).process) {
            manager.stop();
        }
    });

    describe('start', () => {
        it('should start server with correct command', async () => {
            await manager.start('/path/to/backend');

            expect(spawn).toHaveBeenCalledWith('uv', [
                '--directory', '/path/to/backend',
                'run', 'uvicorn',
                'deeppdf.main:app',
                '--port', '8000',
                '--loop', 'asyncio'
            ], expect.any(Object));
        });

        it('should detect server ready from health check', async () => {
            await manager.start('/path/to/backend');

            expect(global.fetch).toHaveBeenCalledWith('http://localhost:8000/health');
            expect(manager.isRunning()).toBe(true);
        });

        it('should handle server startup successfully', async () => {
            const startPromise = manager.start('/path/to/backend');

            await startPromise;

            expect(spawn).toHaveBeenCalled();
            expect(manager.isRunning()).toBe(true);
        });

        it('should use custom port', async () => {
            const customManager = new ServerManager(9000);

            await customManager.start('/path/to/backend');

            expect(spawn).toHaveBeenCalledWith('uv', [
                '--directory', '/path/to/backend',
                'run', 'uvicorn',
                'deeppdf.main:app',
                '--port', '9000',
                '--loop', 'asyncio'
            ], expect.any(Object));
        });

        it('should not start server if already running', async () => {
            await manager.start('/path/to/backend');

            const result = manager.start('/path/to/backend');

            // 应该立即返回（不需要 await）
            expect(result).resolves.toBeUndefined();
        });
    });

    describe('stop', () => {
        it('should stop running server', async () => {
            // 先启动服务器
            await manager.start('/path/to/backend');

            // 停止服务器
            await manager.stop();

            expect(mockKill).toHaveBeenCalled();
            expect((manager as any).process).toBeNull();
        });

        it('should handle stop when no process running', async () => {
            await expect(manager.stop()).resolves.toBeUndefined();
        });
    });

    describe('isRunning', () => {
        it('should return true when server is running', async () => {
            await manager.start('/path/to/backend');

            expect(manager.isRunning()).toBe(true);
        });

        it('should return false when server is not running', () => {
            expect(manager.isRunning()).toBe(false);
        });
    });
});
