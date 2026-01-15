/**
 * JSON-RPC 2.0 客户端实现
 *
 * 参考：https://www.jsonrpc.org/specification
 */

/**
 * JSON-RPC 请求对象
 */
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown> | unknown[];
  id: string | number;
}

/**
 * JSON-RPC 响应对象
 */
export interface JSONRPCResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: JSONRPCErrorObject;
  id: string | number;
}

/**
 * JSON-RPC 错误对象
 */
export interface JSONRPCErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * JSON-RPC 错误类
 */
export class JSONRPCError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = 'JSONRPCError';
  }
}

/**
 * 待处理的请求回调
 */
interface PendingRequest {
  resolve: (response: JSONRPCResponse) => void;
  reject: (error: Error) => void;
}

/**
 * JSON-RPC 客户端类
 *
 * 功能：
 * - 创建符合 JSON-RPC 2.0 规范的请求
 * - 解析 JSON-RPC 响应
 * - 管理待处理的请求
 */
export class JSONRPCClient {
  private pendingRequests: Map<string | number, PendingRequest> = new Map();
  private nextId: number = 1;

  /**
   * 创建 JSON-RPC 请求
   *
   * @param method - 方法名
   * @param params - 参数（可选）
   * @returns JSON-RPC 请求对象
   */
  createRequest(method: string, params?: Record<string, unknown> | unknown[]): JSONRPCRequest {
    return {
      jsonrpc: '2.0',
      method,
      params,
      id: this.nextId++,
    };
  }

  /**
   * 创建 JSON-RPC 错误响应
   *
   * @param code - 错误代码
   * @param message - 错误消息
   * @param data - 错误数据（可选）
   * @param id - 请求 ID
   * @returns JSON-RPC 响应对象
   */
  createError(
    code: number,
    message: string,
    data?: unknown,
    id?: string | number
  ): JSONRPCResponse {
    return {
      jsonrpc: '2.0',
      error: {
        code,
        message,
        data,
      },
      id: id ?? 0,
    };
  }

  /**
   * 解析 JSON-RPC 响应
   *
   * @param data - JSON 字符串
   * @returns JSON-RPC 响应对象
   * @throws {JSONRPCError} 如果解析失败或响应格式错误
   */
  parseResponse(data: string): JSONRPCResponse {
    let response: unknown;

    try {
      response = JSON.parse(data);
    } catch (error) {
      throw new JSONRPCError(-32700, 'Parse error', error);
    }

    // 验证响应格式
    if (!response || typeof response !== 'object') {
      throw new JSONRPCError(-32600, 'Invalid Response', 'Response is not an object');
    }

    const resp = response as Record<string, unknown>;

    if (resp.jsonrpc !== '2.0') {
      throw new JSONRPCError(-32600, 'Invalid Response', 'jsonrpc version must be 2.0');
    }

    if (typeof resp.id !== 'string' && typeof resp.id !== 'number') {
      throw new JSONRPCError(-32600, 'Invalid Response', 'id must be a string or number');
    }

    // 检查是否有错误
    if (resp.error) {
      const error = resp.error as JSONRPCErrorObject;
      return {
        jsonrpc: '2.0',
        error,
        id: resp.id as string | number,
      };
    }

    return {
      jsonrpc: '2.0',
      result: resp.result,
      id: resp.id as string | number,
    };
  }

  /**
   * 注册待处理的请求
   *
   * @param id - 请求 ID
   * @param resolve - 成功回调
   * @param reject - 失败回调
   */
  registerPendingRequest(
    id: string | number,
    resolve: (response: JSONRPCResponse) => void,
    reject: (error: Error) => void
  ): void {
    this.pendingRequests.set(id, { resolve, reject });
  }

  /**
   * 处理 JSON-RPC 响应
   *
   * @param response - JSON-RPC 响应对象
   * @throws {JSONRPCError} 如果响应中有错误或找不到对应的请求
   */
  handleResponse(response: JSONRPCResponse): void {
    const pending = this.pendingRequests.get(response.id);

    if (!pending) {
      throw new JSONRPCError(-32600, 'Invalid Response', `No pending request for id ${response.id}`);
    }

    // 删除待处理的请求
    this.pendingRequests.delete(response.id);

    // 如果响应中有错误，拒绝 Promise
    if (response.error) {
      const error = new JSONRPCError(
        response.error.code,
        response.error.message,
        response.error.data
      );
      pending.reject(error);
    } else {
      pending.resolve(response);
    }
  }

  /**
   * 清除所有待处理的请求
   */
  clearPendingRequests(): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      pending.reject(new Error('Request cancelled'));
    }
    this.pendingRequests.clear();
  }

  /**
   * 获取待处理的请求数量
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }
}
