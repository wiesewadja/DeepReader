/**
 * Tracing Module
 *
 * Provides tracing capabilities for the agent system.
 * - Langfuse: for the old cognitive engine path (manual spans)
 * - LangSmith: for the new LangGraph path (automatic tracing via callbacks)
 */

export { initTracer, getTracer } from './tracer.js';
export type { ITracer, ITraceContext, IObservationRef } from './types.js';
export { getLangSmithTracer, resetLangSmithTracer } from './langsmith.js';
export type { LangSmithConfig } from './langsmith.js';
