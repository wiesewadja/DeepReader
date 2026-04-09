/**
 * Langfuse Tracing Module
 *
 * Provides tracing capabilities for the agent system.
 * Uses Langfuse v5 SDK when configured, falls back to NoopTracer otherwise.
 */

export { initTracer, getTracer } from './tracer.js';
export type { ITracer, ITraceContext, IObservationRef } from './types.js';
