/**
 * FastAPI 服务器进程管理
 */

import { spawn, ChildProcess } from 'child_process';
import { apiLog as log, error as logError } from '../utils/logger.js';

export class ServerManager {
  private process: ChildProcess | null = null;
  private readonly port: number;

  constructor(port: number = 8000) {
    this.port = port;
  }

  /**
   * 启动服务器
   */
  async start(serverPath: string): Promise<void> {
    if (this.process) {
      log('[ServerManager] Server already running');
      return;
    }

    log('[ServerManager] Starting FastAPI server...');

    this.process = spawn('uv', [
      '--directory',
      serverPath,
      'run',
      'uvicorn',
      'deeppdf.main:app',
      '--port',
      String(this.port),
      '--loop',
      'asyncio'
    ]);

    this.process.stdout?.on('data', (data) => {
      log(`[Server] ${data}`);
    });

    this.process.stderr?.on('data', (data) => {
      logError(`[Server Error] ${data}`);
    });

    this.process.on('close', (code) => {
      log(`[ServerManager] Server process exited with code ${code}`);
      this.process = null;
    });

    // 等待服务器启动
    await this.waitForReady();
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    if (!this.process) {
      log('[ServerManager] No server process running');
      return;
    }

    log('[ServerManager] Stopping server...');
    this.process.kill();
    this.process = null;
  }

  /**
   * 等待服务器就绪
   */
  private async waitForReady(timeout: number = 10000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch(`http://localhost:${this.port}/health`);
        if (response.ok) {
          log('[ServerManager] Server is ready');
          return true;
        }
      } catch {
        // 服务器尚未就绪，继续等待
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error('Server failed to start within timeout');
  }

  /**
   * 检查服务器是否运行
   */
  isRunning(): boolean {
    return this.process !== null;
  }
}
