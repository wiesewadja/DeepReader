/**
 * safeNode: wraps a graph node with error boundary.
 *
 * - Catches exceptions so the graph doesn't crash
 * - Sets nodeErrors[nodeName] so downstream nodes can detect upstream failure
 * - Calls node-specific fallback if provided, otherwise returns minimal safe state
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { agentLog as log } from '../../../utils/logger.js';
import type { CognitiveEngineState, NodeError } from '../state';

export type NodeFn = (
  state: CognitiveEngineState,
  config: RunnableConfig,
) => Promise<Partial<CognitiveEngineState>>;

export function safeNode(
  name: string,
  fn: NodeFn,
  fallback?: (state: CognitiveEngineState, err: unknown) => Partial<CognitiveEngineState>,
): NodeFn {
  return async (state, config) => {
    try {
      const result = await fn(state, config);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[${name}] 节点执行失败:`, msg);

      const nodeError: NodeError = {
        message: msg,
        recoverable: name !== 'formatter',
      };

      const base: Partial<CognitiveEngineState> = {
        nodeErrors: { [name]: nodeError },
      };

      if (fallback) {
        return { ...fallback(state, err), ...base };
      }

      return base;
    }
  };
}
