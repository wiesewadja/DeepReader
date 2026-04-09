import type { ITracer, ITraceContext, IObservationRef } from './types';
import { NoopObservationRef } from './types';

/**
 * No-op trace context — 所有方法为空操作
 */
export class NoopTraceContext implements ITraceContext {
  withSpan(_name: string, _metadata?: Record<string, unknown>): ITraceContext {
    return this;
  }

  withGeneration(_name: string, _params: {
    model?: string;
    input?: unknown;
    metadata?: Record<string, unknown>;
  }): IObservationRef {
    return new NoopObservationRef();
  }

  end(_output?: Record<string, unknown>): void {
    // no-op
  }

  getTraceId(): string | undefined {
    return undefined;
  }
}

/**
 * No-op tracer — Langfuse 未配置时的降级实现
 * 零性能开销，零 console 输出
 */
export class NoopTracer implements ITracer {
  private static instance: NoopTraceContext = new NoopTraceContext();

  isEnabled(): boolean {
    return false;
  }

  createTrace(_params: {
    name: string;
    sessionId?: string;
    userId?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): ITraceContext {
    return NoopTracer.instance;
  }

  async flush(): Promise<void> {
    // no-op
  }

  async shutdown(): Promise<void> {
    // no-op
  }
}
