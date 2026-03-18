/**
 * Scope Interceptor for the Cognitive Engine
 *
 * Physically locks search scope to prevent LLM from accessing
 * chapters outside the locked scope.
 */

import type { ToolInterceptor } from '../types';

/**
 * Create a tool interceptor that physically locks search scope
 * Prevents LLM from accessing chapters outside the locked scope
 */
export function createScopeInterceptor(scopeNodeIds: string[]): ToolInterceptor {
  return (toolName: string, toolArgs: Record<string, unknown>): Record<string, unknown> => {
    // Intercept search_doc: force inject scope
    if (toolName === 'search_doc') {
      return {
        ...toolArgs,
        scopeNodeIds: scopeNodeIds,
      };
    }

    // Intercept get_chapter: check if in scope
    if (toolName === 'get_chapter' && toolArgs.node_id) {
      if (!scopeNodeIds.includes(toolArgs.node_id as string)) {
        console.warn(`[Interceptor] node_id ${toolArgs.node_id} out of scope`);
        return {
          ...toolArgs,
          _error: `章节 ${toolArgs.node_id} 不在允许范围内`,
        };
      }
    }

    // Pass through other tools unchanged
    return toolArgs;
  };
}