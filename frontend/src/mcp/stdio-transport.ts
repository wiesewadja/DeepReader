/**
 * Stdio 传输层实现
 *
 * 负责通过标准输入/输出（stdin/stdout）与 Python MCP Server 进程通信。
 * 使用 Node.js child_process API 启动子进程，并提供消息发送和接收功能。
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";

/**
 * 传输层事件类型
 */
export interface StdioTransportEvents {
  /**
   * 接收到消息时触发
   */
  message: (data: string) => void;

  /**
   * 进程退出时触发
   */
  close: (code: number | null, signal: NodeJS.Signals | null) => void;

  /**
   * 发生错误时触发
   */
  error: (error: Error) => void;
}

/**
 * Stdio 传输层配置
 */
export interface StdioTransportConfig {
  /**
   * 服务器路径（MCP 服务器目录）
   */
  serverPath: string;

  /**
   * Python 可执行文件路径（可选，默认使用 uv run python）
   */
  pythonPath?: string;

  /**
   * 工作目录（可选，默认为 serverPath）
   */
  cwd?: string;

  /**
   * 进程启动超时时间（毫秒）
   */
  startupTimeout?: number;

  /**
   * 消息发送超时时间（毫秒）
   */
  sendTimeout?: number;

  /**
   * 环境变量（传递给 Python 进程）
   */
  env?: Record<string, string>;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  startupTimeout: 5000,
  sendTimeout: 10000,
};

/**
 * Stdio 传输层类
 *
 * 功能：
 * - 启动和管理 Python MCP Server 进程
 * - 通过 stdin/stdout 进行消息通信
 * - 处理进程生命周期和错误
 * - 提供事件监听机制
 */
export class StdioTransport extends EventEmitter {
  private process: ChildProcess | null = null;
  private config: StdioTransportConfig & Required<Pick<StdioTransportConfig, 'startupTimeout' | 'sendTimeout'>>;
  private isStarted: boolean = false;
  private messageBuffer: string = '';
  private killTimeout?: NodeJS.Timeout;
  private customEnv?: Record<string, string>;

  constructor(config: StdioTransportConfig) {
    super();
    this.config = {
      ...config,
      startupTimeout: config.startupTimeout ?? DEFAULT_CONFIG.startupTimeout,
      sendTimeout: config.sendTimeout ?? DEFAULT_CONFIG.sendTimeout,
      cwd: config.cwd ?? config.serverPath,
    };
    this.customEnv = config.env;

    // 设置最大监听器数量（防止内存泄漏警告）
    this.setMaxListeners(100);
  }

  /**
   * 启动 Python MCP Server 进程
   *
   * @throws {Error} 如果进程启动失败或超时
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      throw new Error('Transport already started');
    }

    return new Promise((resolve, reject) => {
      try {
        // 准备 spawn 选项
        const spawnOptions: import('child_process').SpawnOptions = {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: this.config.cwd,
          env: {
            ...process.env,
            PYTHONPATH: `${this.config.serverPath}/packages/deeppdf/src`,
            ...this.customEnv,
          },
        };

        console.log('[StdioTransport] Starting MCP server process...');
        console.log('[StdioTransport] Working directory:', this.config.cwd);
        console.log('[StdioTransport] PYTHONPATH:', spawnOptions.env?.PYTHONPATH);
        console.log('[StdioTransport] Environment variables:', Object.keys(spawnOptions.env || {})
            .filter(k => k.startsWith('DEEPSEEK_') || k.startsWith('OPENAI_') || k.startsWith('PDF_INDEX_'))
            .map(k => `${k}=${(spawnOptions.env![k] || '').substring(0, 10)}...`)
            .join(', '));

        // 使用虚拟环境中的 Python 解释器启动 MCP 服务器
        const pythonPath = this.config.pythonPath || `${this.config.serverPath}/.venv/bin/python`;
        const serverArgs = ['-m', 'deeppdf.server'];

        // 使用 spawn 启动 Python 进程
        console.log('[StdioTransport] Spawning:', pythonPath, serverArgs.join(' '));
        this.process = spawn(pythonPath, serverArgs, spawnOptions);

        console.log('[StdioTransport] Process spawned, PID:', this.process.pid);

        // 设置进程退出监听器
        if (this.process) {
          this.process.on('close', (code, signal) => {
            console.log(`[StdioTransport] Process closed with code ${code} and signal ${signal}`);
            this.isStarted = false;
            this.emit('close', code, signal);
          });

          // 设置进程错误监听器
          this.process.on('error', (error) => {
            console.error('[StdioTransport] Process error:', error);
            this.emit('error', error);
            reject(error);
          });

          // 设置 stdout 数据监听器
          if (this.process.stdout) {
            this.process.stdout.on('data', (data: Buffer) => {
              this.handleStdoutData(data);
            });

            this.process.stdout.on('error', (error) => {
              console.error('[StdioTransport] stdout error:', error);
              this.emit('error', error);
            });
          }

          // 设置 stderr 数据监听器（用于调试）
          if (this.process.stderr) {
            this.process.stderr.on('data', (data: Buffer) => {
              console.error('[StdioTransport] stderr:', data.toString());
            });
          }
        }

        // 设置启动超时
        const timeout = setTimeout(() => {
          if (!this.isStarted) {
            this.kill();
            reject(new Error('Process startup timeout'));
          }
        }, this.config.startupTimeout);

        // 等待一小段时间确认进程启动成功
        setTimeout(() => {
          clearTimeout(timeout);
          this.isStarted = true;
          console.log('[StdioTransport] Process started successfully');
          resolve();
        }, 100);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 处理 stdout 接收到的数据
   *
   * JSON-RPC 消息可能被分片传输，需要使用换行符分割消息
   *
   * @param data - 接收到的 Buffer 数据
   */
  private handleStdoutData(data: Buffer): void {
    // 将 Buffer 转换为字符串并追加到缓冲区
    this.messageBuffer += data.toString();

    // 按换行符分割消息
    const lines = this.messageBuffer.split('\n');

    // 保留最后一个不完整的行（可能还未接收完整）
    this.messageBuffer = lines.pop() || '';

    // 处理每个完整的消息
    for (const line of lines) {
      if (line.trim()) {
        this.emit('message', line);
      }
    }
  }

  /**
   * 发送消息到 Python 进程
   *
   * @param data - 要发送的 JSON 字符串
   * @throws {Error} 如果进程未启动或发送失败
   */
  async send(data: string): Promise<void> {
    if (!this.isStarted || !this.process) {
      throw new Error('Process not started');
    }

    if (!this.process.stdin) {
      throw new Error('Process stdin not available');
    }

    return new Promise((resolve, reject) => {
      // 在消息末尾添加换行符（Python 端使用 readline() 读取）
      const message = data + '\n';

      // 设置发送超时
      const timeout = setTimeout(() => {
        reject(new Error('Send timeout'));
      }, this.config.sendTimeout);

      // 写入 stdin
      const writeSuccess = this.process!.stdin!.write(message, (error) => {
        clearTimeout(timeout);

        if (error) {
          console.error('[StdioTransport] Failed to send message:', error);
          reject(error);
        } else {
          resolve();
        }
      });

      // 如果写入失败（缓冲区已满），触发错误
      if (!writeSuccess) {
        clearTimeout(timeout);
        reject(new Error('Failed to write to stdin (buffer full)'));
      }
    });
  }

  /**
   * 终止进程
   *
   * 优雅关闭：先尝试 SIGTERM，如果进程在 1 秒内未退出，则使用 SIGKILL
   */
  kill(): void {
    if (this.process && this.isStarted) {
      console.log('[StdioTransport] Killing process...');

      // 清理之前的定时器（防止内存泄漏）
      if (this.killTimeout) {
        clearTimeout(this.killTimeout);
        this.killTimeout = undefined;
      }

      // 先尝试优雅关闭（SIGTERM）
      this.process.kill('SIGTERM');

      // 1 秒后如果还未退出，强制杀死（SIGKILL）
      // 保存定时器引用以便清理
      this.killTimeout = setTimeout(() => {
        if (this.process && this.isStarted) {
          console.log('[StdioTransport] Force killing process...');
          this.process.kill('SIGKILL');
        }
        this.killTimeout = undefined;
      }, 1000);

      this.isStarted = false;
    }
  }

  /**
   * 重启进程
   *
   * 如果进程正在运行，先终止它，然后重新启动
   */
  async restart(): Promise<void> {
    if (this.isStarted) {
      this.kill();
      // 等待进程完全退出
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await this.start();
  }

  /**
   * 添加消息监听器
   *
   * @param listener - 消息处理函数
   */
  onMessage(listener: (data: string) => void): void {
    this.on('message', listener);
  }

  /**
   * 添加关闭监听器
   *
   * @param listener - 关闭处理函数
   */
  onClose(listener: (code: number | null, signal: NodeJS.Signals | null) => void): void {
    this.on('close', listener);
  }

  /**
   * 添加错误监听器
   *
   * @param listener - 错误处理函数
   */
  onError(listener: (error: Error) => void): void {
    this.on('error', listener);
  }

  /**
   * 检查进程是否正在运行
   */
  isRunning(): boolean {
    return this.isStarted && this.process !== null;
  }

  /**
   * 获取进程 PID（用于调试）
   */
  getPid(): number | undefined {
    return this.process?.pid;
  }
}
