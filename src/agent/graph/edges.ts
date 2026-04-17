/**
 * Conditional edges for the cognitive engine graph
 */

import type { CognitiveEngineState } from './state';

/**
 * Route after S0 Router based on classified depth.
 *
 * - depth=0: casual chat → S4 (formatter, skip S1/S2)
 * - depth>=1: S1 (inspectional) first, then S2 or S4 based on depth
 *
 * All reading queries (depth>=1) go through S1 for scope narrowing.
 */
export function routeByDepth(state: CognitiveEngineState): string {
  if (state.depth === 0) return 'formatter';  // casual → skip S1/S2, go directly to S4
  // depth>=1: run inspectional first to get scope
  return 'inspectional';
}

/**
 * Route after S1 Inspectional based on depth and results.
 *
 * - depth=1 with structural analysis complete → S4 (formatter)
 * - depth=2 → S2 (analytical, which will use scopeNodeIds from S1)
 * - depth=3 → S3 (syntopical, multi-book fusion analysis)
 */
export function routeAfterInspectional(state: CognitiveEngineState): string {
  // depth=3 → go to syntopical (S3)
  if (state.depth === 3) {
    return 'syntopical';
  }
  // depth=1 and structural analysis done → go straight to formatter
  if (state.depth <= 1 && state.structuralAnalysis) {
    return 'done';
  }
  // depth=2 → continue to analytical reading
  return 'continue';
}
