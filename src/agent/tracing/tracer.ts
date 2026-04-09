import type { ITracer, ITraceContext } from './types';
import { NoopTracer } from './noop-tracer';
import { LangfuseTraceContext } from './trace-context';
import type { LangfuseObservation } from './trace-context';

let tracerInstance: ITracer | null = null;

/**
 * 初始化 Tracer 单例
 * 如果 Langfuse 配置完整，创建真实 tracer；否则降级为 NoopTracer
 */
export function initTracer(config?: {
  publicKey?: string;
  secretKey?: string;
  baseUrl?: string;
  enabled?: boolean;
}): ITracer {
  // 优先使用传入的配置，其次读 process.env
  const publicKey = config?.publicKey || process?.env?.LANGFUSE_PUBLIC_KEY;
  const secretKey = config?.secretKey || process?.env?.LANGFUSE_SECRET_KEY;
  const baseUrl = config?.baseUrl || process?.env?.LANGFUSE_HOST;
  // enabled: 显式 false 则禁用，否则检查环境变量
  const enabled = config?.enabled !== false && process?.env?.LANGFUSE_ENABLED !== 'false';

  if (!publicKey || !secretKey || !baseUrl || !enabled) {
    tracerInstance = new NoopTracer();
    return tracerInstance;
  }

  tracerInstance = new LangfuseTracerImpl(publicKey, secretKey, baseUrl);
  return tracerInstance;
}

/**
 * 获取 Tracer 单例（未初始化时自动创建 NoopTracer）
 */
export function getTracer(): ITracer {
  if (!tracerInstance) {
    tracerInstance = new NoopTracer();
  }
  return tracerInstance;
}

/**
 * 真实 Langfuse Tracer 实现
 *
 * 注意：LangfuseClient 构造时会自动注册到 @langfuse/tracing 的全局状态，
 * 因此后续的 startObservation() 调用可以找到正确的 client 实例。
 */
class LangfuseTracerImpl implements ITracer {
  private initialized: boolean;

  constructor(publicKey: string, secretKey: string, baseUrl: string) {
    try {
      // 动态导入避免在 Langfuse 包结构变化时编译报错
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { LangfuseClient } = require('@langfuse/client');
      // LangfuseClient 构造即注册到 @langfuse/tracing 全局
      new LangfuseClient({ publicKey, secretKey, baseUrl });
      this.initialized = true;
    } catch {
      console.warn('[DeepReader] Failed to initialize Langfuse client, falling back to NoopTracer');
      this.initialized = false;
    }
  }

  isEnabled(): boolean {
    return this.initialized;
  }

  createTrace(params: {
    name: string;
    sessionId?: string;
    userId?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): ITraceContext {
    if (!this.initialized) {
      return new NoopTracer().createTrace(params);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { startObservation } = require('@langfuse/tracing');
      const observation = startObservation(params.name, {
        input: params.input,
        metadata: {
          ...params.metadata,
          ...(params.sessionId ? { sessionId: params.sessionId } : {}),
          ...(params.userId ? { userId: params.userId } : {}),
        },
      }, { asType: 'span' }) as unknown as LangfuseObservation;

      return new LangfuseTraceContext(observation);
    } catch {
      return new NoopTracer().createTrace(params);
    }
  }

  async flush(): Promise<void> {
    if (!this.initialized) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { langfuseSpanProcessor } = require('@langfuse/tracing');
      await langfuseSpanProcessor.forceFlush();
    } catch {
      // flush 失败静默处理
    }
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { langfuseSpanProcessor } = require('@langfuse/tracing');
      // 5 秒超时保护，避免阻塞插件卸载
      await Promise.race([
        langfuseSpanProcessor.forceFlush(),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    } catch {
      // shutdown 失败静默处理
    }
  }
}
