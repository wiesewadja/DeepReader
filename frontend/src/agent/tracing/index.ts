/**
 * Langfuse Tracing Module
 *
 * Provides tracing capabilities for the agent system.
 * Currently a no-op implementation that will be replaced with Langfuse.
 */

import type { ITracer, ITraceContext } from './types';

// No-op trace context
class NoopTraceContext implements ITraceContext {
  withSpan(_name: string, _metadata?: Record<string, unknown>): ITraceContext {
    return new NoopTraceContext();
  }

  withGeneration(
    _name: string,
    _params: { model?: string; input?: unknown; metadata?: Record<string, unknown> }
  ) {
    return {
      end(_output?: unknown) {},
    };
  }

  end(_output?: unknown): void {}

  getTraceId(): string | undefined {
    return undefined;
  }
}

// No-op tracer
class NoopTracer implements ITracer {
  createTrace(_params?: { name?: string; metadata?: Record<string, unknown> }): ITraceContext {
    return new NoopTraceContext();
  }

  async flush(): Promise<void> {}

  async shutdown(): Promise<void> {}
}

let tracerInstance: ITracer | null = null;

/**
 * Initialize the tracer.
 * Will be connected to Langfuse when configuration is available.
 */
export function initTracer(): void {
  // No-op for now; will initialize Langfuse tracer when config is available
  if (!tracerInstance) {
    tracerInstance = new NoopTracer();
  }
}

/**
 * Get the global tracer instance.
 * Returns null-safe tracer (always returns a valid ITracer).
 */
export function getTracer(): ITracer {
  if (!tracerInstance) {
    tracerInstance = new NoopTracer();
  }
  return tracerInstance;
}

export type { ITracer, ITraceContext, IObservationRef } from './types';
