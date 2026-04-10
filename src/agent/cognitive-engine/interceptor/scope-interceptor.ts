/**
 * Scope Interceptor for the Cognitive Engine
 *
 * Physically locks search scope to prevent LLM from accessing
 * chapters outside the locked scope.
 *
 * When scopeNodeIds is empty, no scope filtering is applied (global search).
 *
 * Design rationale:
 * - search_book: inject scope_node_ids to filter search results
 * - read_book_section: NO scope check needed, because:
 *   1. LLM decides which section to read based on search results
 *   2. Search results are already filtered by scope
 *   3. The tool uses heading/block_id, not node_id directly
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
    // Intercept search_book: inject scope only when has valid scope
    if (toolName === 'search_book') {
      if (hasScope) {
        return {
          ...toolArgs,
          scope_node_ids: scopeNodeIds,  // snake_case to match tool parameter
        };
      }
      // 空数组时不注入 scope_node_ids，让工具使用全局搜索
      return toolArgs;
    }

    // read_book_section: 不需要 scope 检查
    // 因为 LLM 基于已过滤的搜索结果决定读取哪个章节
    // 搜索结果已经只包含范围内的内容

    // Pass through other tools unchanged
    return toolArgs;
  };
}