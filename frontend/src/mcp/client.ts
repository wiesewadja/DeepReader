/**
 * MCP Client 核心实现
 *
 * 整合 JSON-RPC 和 Stdio Transport，提供完整的 MCP 协议客户端功能。
 * 支持：
 * - 连接管理（initialize 握手）
 * - 工具调用（tools/call）
 * - 自动重试（指数退避策略）
 */

import { JSONRPCClient, JSONRPCRequest, JSONRPCResponse, JSONRPCError } from "./json-rpc.js";
import { StdioTransport, StdioTransportConfig } from "./stdio-transport.js";
import {
    IndexPDFResult,
    QueryPDFResult,
    ListIndexesResult,
    DeleteIndexResult
} from "./types.js";

/**
 * MCP 协议错误类
 */
export class MCPClientError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'MCPClientError';
  }
}

/**
 * MCP Client 配置
 */
export interface MCPClientConfig extends Omit<StdioTransportConfig, 'serverPath'> {
  /**
   * 服务器路径（MCP 服务器目录）
   */
  serverPath: string;

  /**
   * 最大重试次数
   */
  maxRetries?: number;

  /**
   * 重试基础延迟时间（毫秒）
   */
  retryDelay?: number;

  /**
   * 请求超时时间（毫秒）
   */
  requestTimeout?: number;

  /**
   * 环境变量（传递给 Python 进程）
   */
  env?: Record<string, string>;
}

/**
 * 默认配置
 */
const DEFAULT_MCP_CONFIG: Required<Pick<MCPClientConfig, 'maxRetries' | 'retryDelay' | 'requestTimeout'>> = {
  maxRetries: 3,
  retryDelay: 1000, // 1秒
  requestTimeout: 30000, // 30秒
};

/**
 * MCP Client 核心类
 *
 * 功能：
 * - 管理与 MCP Server 的连接
 * - 实现工具调用
 * - 自动重试和错误恢复
 */
export class MCPClient {
  private transport: StdioTransport;
  private jsonrpc: JSONRPCClient;
  private config: MCPClientConfig & {
    maxRetries: number;
    retryDelay: number;
    requestTimeout: number;
  };
  private isConnected: boolean = false;

  constructor(config: MCPClientConfig) {
    this.config = {
      ...config,
      ...DEFAULT_MCP_CONFIG,
      startupTimeout: config.startupTimeout ?? 5000,
      sendTimeout: config.sendTimeout ?? 10000,
      requestTimeout: config.requestTimeout ?? DEFAULT_MCP_CONFIG.requestTimeout,
    };
    this.transport = new StdioTransport({
      serverPath: this.config.serverPath,
      pythonPath: this.config.pythonPath,
      cwd: this.config.cwd,
      startupTimeout: this.config.startupTimeout,
      sendTimeout: this.config.sendTimeout,
      env: config.env,
    });
    this.jsonrpc = new JSONRPCClient();

    // 监听传输层消息
    this.transport.onMessage((data: string) => {
      this.handleMessage(data);
    });

    // 监听传输层关闭
    this.transport.onClose((code, signal) => {
      console.log(`[MCPClient] Transport closed: code=${code}, signal=${signal}`);
      this.isConnected = false;
    });

    // 监听传输层错误
    this.transport.onError((error) => {
      console.error('[MCPClient] Transport error:', error);
      this.isConnected = false;
      // 向上传播传输层错误
      this.emitError(new MCPClientError('Transport layer error', error));
    });
  }

  /**
   * 发射错误事件（用于错误传播）
   */
  private emitError(error: MCPClientError): void {
    console.error('[MCPClient]', error.message, error.cause);
  }

  /**
   * 处理接收到的消息
   *
   * @param data - JSON 字符串格式的消息
   */
  private handleMessage(data: string): void {
    try {
      const response = this.jsonrpc.parseResponse(data);
      this.jsonrpc.handleResponse(response);
    } catch (error) {
      // 向上传播 JSON-RPC 解析错误
      const mcpError = new MCPClientError(
        `Failed to parse/handle message: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined
      );
      this.emitError(mcpError);
    }
  }

  /**
   * 连接到 MCP Server
   *
   * 执行 initialize 握手，建立与 MCP Server 的连接
   *
   * @throws {MCPClientError} 如果连接失败
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      console.log('[MCPClient] Already connected');
      return;
    }

    try {
      // 启动传输层进程
      console.log('[MCPClient] Starting transport...');
      await this.transport.start();
      console.log('[MCPClient] Transport started');

      // 执行 initialize 握手
      console.log('[MCPClient] Performing initialize handshake...');
      await this.initialize();
      console.log('[MCPClient] Initialize handshake successful');

      this.isConnected = true;
      console.log('[MCPClient] Connected to MCP Server');
    } catch (error) {
      console.error('[MCPClient] Failed to connect:', error);
      this.transport.kill();
      throw new MCPClientError('Failed to connect to MCP Server', error as Error);
    }
  }

  /**
   * 执行 initialize 握手
   *
   * MCP 协议要求在调用任何工具前先执行 initialize 握手
   */
  private async initialize(): Promise<void> {
    const request = this.jsonrpc.createRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'obsidian-deeppdf',
        version: '0.1.0',
      },
    });

    const response = await this.sendRequestWithRetry(request);

    if (!response.result) {
      throw new MCPClientError('Initialize failed: no result in response');
    }

    console.log('[MCPClient] Initialize response:', response.result);
  }

  /**
   * 调用 MCP Tool
   *
   * @param toolName - 工具名称
   * @param args - 工具参数
   * @returns 工具执行结果
   * @throws {MCPClientError} 如果工具调用失败
   */
  async callTool(toolName: string, args?: Record<string, unknown>): Promise<unknown> {
    if (!this.isConnected) {
      throw new MCPClientError('Not connected to MCP Server');
    }

    // 验证参数
    if (typeof toolName !== 'string' || toolName.trim() === '') {
      throw new MCPClientError('Invalid tool name');
    }

    const request = this.jsonrpc.createRequest('tools/call', {
      name: toolName,
      arguments: args || {},
    });

    try {
      const response = await this.sendRequestWithRetry(request);

      if (!response.result) {
        throw new MCPClientError('Tool call failed: no result in response');
      }

      return response.result;
    } catch (error) {
      throw new MCPClientError(`Tool call failed: ${toolName}`, error as Error);
    }
  }

  /**
   * 索引 PDF
   *
   * @param pdfPath - PDF 文件路径
   * @returns 索引结果
   */
  async indexPDF(pdfPath: string): Promise<IndexPDFResult> {
    const result = await this.callTool("index_pdf", { path: pdfPath });
    return this.parseToolResult(result);
  }

  /**
   * 查询 PDF
   *
   * @param query - 查询文本
   * @param indexId - 索引 ID
   * @returns 查询结果
   */
  async queryPDF(query: string, indexId: string): Promise<QueryPDFResult> {
    const result = await this.callTool("query_pdf", { query, index_id: indexId });
    return this.parseToolResult(result);
  }

  /**
   * 列出所有索引
   *
   * @returns 索引列表
   */
  async listIndexes(): Promise<ListIndexesResult> {
    const result = await this.callTool("list_indexes", {});
    return this.parseToolResult(result);
  }

  /**
   * 删除索引
   *
   * @param indexId - 索引 ID
   * @returns 删除结果
   */
  async deleteIndex(indexId: string): Promise<DeleteIndexResult> {
    const result = await this.callTool("delete_index", { index_id: indexId });
    return this.parseToolResult(result);
  }

  /**
   * 解析工具调用结果
   *
   * MCP SDK 返回格式（低级服务器）：
   * - structuredContent: 结构化数据（自动序列化的 JSON）
   * - content: 文本内容数组（向后兼容）
   *
   * @param result - 工具调用返回的原始结果
   * @returns 解析后的结果对象
   * @throws {MCPClientError} 如果解析失败
   */
  private parseToolResult<T>(result: unknown): T {
    if (!result || typeof result !== 'object') {
      throw new MCPClientError('Invalid tool result: not an object');
    }

    const resultObj = result as Record<string, unknown>;

    // 优先使用 structuredContent（结构化输出）
    if ('structuredContent' in resultObj && resultObj.structuredContent) {
      return resultObj.structuredContent as T;
    }

    // 回退到 content 字段（文本格式）
    if ('content' in resultObj) {
      const content = resultObj.content;

      // 如果 content 是数组，取第一个元素
      if (Array.isArray(content) && content.length > 0) {
        const first = content[0];
        if (first && typeof first === 'object' && 'type' in first) {
          if (first.type === 'text' && 'text' in first) {
            try {
              return JSON.parse((first as { text: string }).text);
            } catch (error) {
              // 如果解析 JSON 失败，可能是纯文本，直接返回
              return (first as { text: string }).text as T;
            }
          }
        }
      }
    }

    throw new MCPClientError('Invalid tool result format: missing content and structuredContent');
  }

  /**
   * 发送请求并自动重试
   *
   * 使用指数退避策略进行重试：
   * - 第1次重试：延迟 1s
   * - 第2次重试：延迟 2s
   * - 第3次重试：延迟 4s
   *
   * @param request - JSON-RPC 请求对象
   * @returns JSON-RPC 响应对象
   */
  private async sendRequestWithRetry(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[MCPClient] Retry attempt ${attempt}/${this.config.maxRetries}`);
          // 计算延迟时间：2^(attempt-1) * retryDelay
          const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }

        return await this.sendRequest(request);
      } catch (error) {
        lastError = error as Error;
        console.error(`[MCPClient] Attempt ${attempt + 1} failed:`, error);

        // 如果是最后一次尝试，不再重试
        if (attempt === this.config.maxRetries) {
          break;
        }

        // 某些错误不应该重试（如参数错误）
        if (error instanceof JSONRPCError) {
          if (
            error.code === -32600 || // Invalid Request
            error.code === -32602 || // Invalid params
            error.code === -32601 // Method not found
          ) {
            break;
          }
        }
      }
    }

    throw new MCPClientError(
      `Request failed after ${this.config.maxRetries + 1} attempts`,
      lastError
    );
  }

  /**
   * 发送单个请求（带超时控制）
   *
   * @param request - JSON-RPC 请求对象
   * @returns Promise<JSONRPCResponse>
   * @throws {MCPClientError} 如果发送失败或超时
   */
  private sendRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
    return new Promise((resolve, reject) => {
      // 超时定时器 ID（在外部声明，避免闭包问题）
      let timeoutId: NodeJS.Timeout;

      // 创建超时 Promise
      const timeoutPromise = new Promise<JSONRPCResponse>((_, rejectTimeout) => {
        timeoutId = setTimeout(() => {
          // 超时后取消注册请求
          this.jsonrpc['pendingRequests']?.delete(request.id);
          rejectTimeout(
            new MCPClientError(`Request timeout after ${this.config.requestTimeout}ms`)
          );
        }, this.config.requestTimeout);
      });

      // 创建实际请求 Promise
      const requestPromise = new Promise<JSONRPCResponse>((resolveRequest, rejectRequest) => {
        // 注册待处理的请求
        this.jsonrpc.registerPendingRequest(
          request.id,
          (response: JSONRPCResponse) => {
            resolveRequest(response);
          },
          (error: Error) => {
            rejectRequest(error);
          }
        );

        // 发送请求
        const message = JSON.stringify(request);
        this.transport.send(message).catch((error) => {
          // 发送失败，手动触发错误回调
          this.jsonrpc.handleResponse(
            this.jsonrpc.createError(-32603, 'Internal error', error, request.id)
          );
        });
      });

      // 使用 Promise.race 竞争：请求完成 vs 超时
      Promise.race([requestPromise, timeoutPromise])
        .then((response) => {
          // 清除超时定时器
          clearTimeout(timeoutId);
          resolve(response);
        })
        .catch((error) => {
          // 清除超时定时器
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * 断开与 MCP Server 的连接
   */
  disconnect(): void {
    if (!this.isConnected) {
      return;
    }

    console.log('[MCPClient] Disconnecting from MCP Server...');
    this.transport.kill();
    this.isConnected = false;
    this.jsonrpc.clearPendingRequests();
    console.log('[MCPClient] Disconnected');
  }

  /**
   * 重启连接
   */
  async restart(): Promise<void> {
    this.disconnect();
    await this.sleep(500);
    await this.connect();
  }

  /**
   * 检查是否已连接
   */
  checkConnection(): boolean {
    return this.isConnected && this.transport.isRunning();
  }

  /**
   * 睡眠函数（用于重试延迟）
   *
   * @param ms - 延迟时间（毫秒）
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
