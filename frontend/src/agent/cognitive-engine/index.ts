/**
 * Cognitive Engine - Public API
 *
 * A deterministic state machine for intelligent document reading
 * based on Adler's "How to Read a Book" methodology.
 */

// Main engine
export { runCognitiveEngine } from './engine';

// Context
export { createSharedContext, SharedContextImpl } from './context';

// Types
export type {
  SharedContext,
  StateResult,
  SearchResult,
  ReadingDepth,
  ModelType,
  StateNodeOptions,
  EngineCallbacks,
  ToolInterceptor,
} from './types';

// Errors
export { StateParseError, StateTimeoutError, StateExecutionError } from './errors';

// States (for advanced usage)
export { StateNode, withTimeout, withRetry, executeStateWithProtection } from './states/base';
export { RouterState } from './states/router';
export { InspectionalState } from './states/inspectional';
export { AnalyticalState } from './states/analytical';
export { SyntopicalState } from './states/syntopical';
export { FormatterState } from './states/formatter';

// Interceptor
export { createScopeInterceptor } from './interceptor/scope-interceptor';

// Utilities
export { parseStateOutput } from './parse';