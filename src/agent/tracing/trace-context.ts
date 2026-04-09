import type { ITraceContext, IObservationRef } from './types';

/**
 * Langfuse v5 observation 对象的最小接口
 * 只暴露我们需要的方法
 */
export interface LangfuseObservation {
  startObservation(
    name: string,
    options?: Record<string, unknown>,
    config?: { asType: 'span' | 'generation' | 'tool' | 'event' }
  ): LangfuseObservation;
  update(options: Record<string, unknown>): LangfuseObservation;
  end(): void;
  readonly traceId?: string;
}

/**
 * Langfuse 追踪上下文 — 基于 v5 startObservation API
 * 不可变：withSpan 返回新实例
 */
export class LangfuseTraceContext implements ITraceContext {
  private observation: LangfuseObservation;

  constructor(observation: LangfuseObservation) {
    this.observation = observation;
  }

  withSpan(name: string, options?: { input?: unknown; metadata?: Record<string, unknown> }): ITraceContext {
    const child = this.observation.startObservation(
      name,
      {
        ...(options?.input !== undefined ? { input: options.input } : {}),
        ...(options?.metadata ? { metadata: options.metadata } : {}),
      },
      { asType: 'span' }
    );
    return new LangfuseTraceContext(child);
  }

  withGeneration(name: string, params: {
    model?: string;
    input?: unknown;
    metadata?: Record<string, unknown>;
  }): IObservationRef {
    const generation = this.observation.startObservation(
      name,
      {
        ...(params.input !== undefined ? { input: params.input } : {}),
        ...(params.model ? { model: params.model } : {}),
        ...(params.metadata ? { metadata: params.metadata } : {}),
      },
      { asType: 'generation' }
    );
    return {
      update(p: { output?: unknown; usageDetails?: Record<string, number>; metadata?: Record<string, unknown> }) {
        generation.update(p as Record<string, unknown>);
        return this;
      },
      end(p?: { output?: unknown; level?: string; metadata?: Record<string, unknown>; [key: string]: unknown }) {
        if (p && Object.keys(p).length > 0) {
          generation.update(p as Record<string, unknown>);
        }
        generation.end();
      },
    };
  }

  end(output?: Record<string, unknown>): void {
    if (output) {
      this.observation.update({ output }).end();
    } else {
      this.observation.end();
    }
  }

  getTraceId(): string | undefined {
    return this.observation.traceId;
  }
}
