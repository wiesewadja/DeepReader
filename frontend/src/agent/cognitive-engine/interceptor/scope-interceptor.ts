/**
 * Scope Interceptor for the Cognitive Engine
 *
 * Physically locks search scope to prevent LLM from accessing
 * chapters outside the locked scope.
 *
 * When scopeNodeIds is empty, no scope filtering is applied (global search).
 */

import type { ToolInterceptor } from '../types';

/**
 * Create a tool interceptor that physically locks search scope
 * Prevents LLM from accessing chapters outside the locked scope
 *
 * @param scopeNodeIds - 章节范围 ID 列表，空数组表示全局搜索
 */
export function createScopeInterceptor(scopeNodeIds: string[]): ToolInterceptor {
  const hasScope = scopeNodeIds.length > 0;

  return (toolName: string, toolArgs: Record<string, unknown>): Record<string, unknown> => {
    // Intercept search_doc: inject scope only when has valid scope
    if (toolName === 'search_doc') {
      if (hasScope) {
        return {
          ...toolArgs,
          scopeNodeIds: scopeNodeIds,
        };
      }
      // 空数组时不注入 scopeNodeIds，让后端使用全局搜索
      return toolArgs;
    }

    // Intercept get_chapter: check if in scope (only when scope is locked)
    if (toolName === 'get_chapter' && toolArgs.node_id && hasScope) {
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