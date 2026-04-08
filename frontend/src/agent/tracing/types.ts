/**
 * Langfuse 追踪上下文接口
 * 通过函数参数在模块间传递，不使用全局变量
 */
export interface ITraceContext {
  /**
   * 创建子 span observation，返回新的 context（不可变）
   * NoopTracer 下返回自身
   */
  withSpan(name: string, metadata?: Record<string, unknown>): ITraceContext;

  /**
   * 在当前 context 下创建 generation observation
   * 返回 observation 引用，用于后续 update/end
   */
  withGeneration(name: string, params: {
    model?: string;
    input?: unknown;
    metadata?: Record<string, unknown>;
  }): IObservationRef;

  /**
   * 结束当前 observation
   */
  end(output?: Record<string, unknown>): void;

  /**
   * 获取 trace ID（用于 Langfuse UI 链接）
   */
  getTraceId(): string | undefined;
}

/**
 * Langfuse observation 引用
 * 用于 update + end 操作
 */
export interface IObservationRef {
  update(params: {
    output?: unknown;
    usageDetails?: Record<string, number>;
    metadata?: Record<string, unknown>;
  }): IObservationRef;
  end(): void;
}

/**
 * Noop implementation of IObservationRef
 */
export class NoopObservationRef implements IObservationRef {
  update(_params: { output?: unknown; usageDetails?: Record<string, number>; metadata?: Record<string, unknown> }): IObservationRef {
    return this;
  }
  end(): void {
    // no-op
  }
}

/**
 * Langfuse Tracer 单例接口
 */
export interface ITracer {
  /**
   * 创建根 observation（对应一次完整对话）
   */
  createTrace(params: {
    name: string;
    sessionId?: string;
    userId?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): ITraceContext;

  /**
   * 刷新缓冲区，上传所有待发送数据
   */
  flush(): Promise<void>;

  /**
   * 关闭 tracer，带超时保护
   */
  shutdown(): Promise<void>;

  /**
   * 是否已启用（Langfuse 配置完整）
   */
  isEnabled(): boolean;
}
