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
  /** End the observation, optionally providing output */
  end(output?: unknown): void;
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
  end(output?: unknown): void;

  /** Get the trace ID for correlation */
  getTraceId(): string | undefined;
}

/**
 * Tracer - root factory for traces
 */
export interface ITracer {
  /** Create a new trace */
  createTrace(params?: { name?: string; metadata?: Record<string, unknown> }): ITraceContext;

  /** Flush pending traces to the backend */
  flush(): Promise<void>;

  /** Shutdown the tracer and flush remaining traces */
  shutdown(): Promise<void>;
}
