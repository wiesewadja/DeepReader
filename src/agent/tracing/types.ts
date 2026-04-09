/**
 * Langfuse Tracing Types
 *
 * Defines the tracing interfaces used across the agent system.
 * Actual implementations may be Langfuse-backed or no-op.
 */

/**
 * Reference to an observation (span or generation) for ending/tracking
 */
export interface IObservationRef {
  /** Update the observation with output/usage/metadata */
  update(params: {
    output?: unknown;
    usageDetails?: Record<string, number>;
    metadata?: Record<string, unknown>;
  }): IObservationRef;
  /** End the observation, optionally providing final output/metadata */
  end(params?: Record<string, unknown>): void;
}

/**
 * Trace context - represents an active trace or span
 */
export interface ITraceContext {
  /** Create a child span within this trace */
  withSpan(name: string, metadata?: Record<string, unknown>): ITraceContext;

  /** Create a generation (LLM call) observation */
  withGeneration(
    name: string,
    params: {
      model?: string;
      input?: unknown;
      metadata?: Record<string, unknown>;
    }
  ): IObservationRef;

  /** End this trace/span, optionally providing output */
  end(output?: Record<string, unknown>): void;

  /** Get the trace ID for correlation */
  getTraceId(): string | undefined;
}

/**
 * Noop implementation of IObservationRef
 */
export class NoopObservationRef implements IObservationRef {
  update(_params: { output?: unknown; usageDetails?: Record<string, number>; metadata?: Record<string, unknown> }): IObservationRef {
    return this;
  }
  end(_params?: Record<string, unknown>): void {
    // no-op
  }
}

/**
 * Tracer - root factory for traces
 */
export interface ITracer {
  /** Check if tracer is enabled */
  isEnabled(): boolean;

  /** Create a new trace */
  createTrace(params: {
    name: string;
    sessionId?: string;
    userId?: string;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): ITraceContext;

  /** Flush pending traces to the backend */
  flush(): Promise<void>;

  /** Shutdown the tracer and flush remaining traces */
  shutdown(): Promise<void>;
}
