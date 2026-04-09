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
    console.log('[DeepReader] Langfuse disabled: missing config or explicitly disabled');
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
 * 使用 @langfuse/otel 的 LangfuseSpanProcessor 和 WebTracerProvider
 * 适用于 Electron 渲染进程（Obsidian 插件环境）
 */
class LangfuseTracerImpl implements ITracer {
  private initialized: boolean = false;
  private spanProcessor: any = null;

  constructor(publicKey: string, secretKey: string, baseUrl: string) {
    try {
      // 动态导入避免编译报错
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { LangfuseSpanProcessor } = require('@langfuse/otel');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { WebTracerProvider } = require('@opentelemetry/sdk-trace-web');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { setLangfuseTracerProvider } = require('@langfuse/tracing');

      // 创建 LangfuseSpanProcessor
      this.spanProcessor = new LangfuseSpanProcessor({
        publicKey,
        secretKey,
        baseUrl,
        flushAt: 1, // 每个 span 立即发送
        flushInterval: 1, // 1秒刷新
      });

      // 创建 WebTracerProvider（适用于 Electron 渲染进程）
      const provider = new WebTracerProvider({
        spanProcessors: [this.spanProcessor],
      });

      // 设置为 Langfuse 使用的 TracerProvider
      setLangfuseTracerProvider(provider);

      this.initialized = true;
      console.log('[DeepReader] Langfuse initialized successfully', { baseUrl });
    } catch (error) {
      console.warn('[DeepReader] Failed to initialize Langfuse client:', error);
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
    } catch (error) {
      console.warn('[DeepReader] Failed to create trace:', error);
      return new NoopTracer().createTrace(params);
    }
  }

  async flush(): Promise<void> {
    if (!this.initialized || !this.spanProcessor) return;
    try {
      await this.spanProcessor.forceFlush();
      console.log('[DeepReader] Langfuse flushed successfully');
    } catch (error) {
      console.warn('[DeepReader] Failed to flush Langfuse:', error);
    }
  }

  async shutdown(): Promise<void> {
    if (!this.initialized || !this.spanProcessor) return;
    try {
      // 5 秒超时保护，避免阻塞插件卸载
      await Promise.race([
        this.spanProcessor.forceFlush(),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
      console.log('[DeepReader] Langfuse shutdown successfully');
    } catch (error) {
      console.warn('[DeepReader] Failed to shutdown Langfuse:', error);
    }
  }
}
