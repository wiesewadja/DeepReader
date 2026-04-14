/**
 * Conditional edges for the cognitive engine graph
 */

import type { CognitiveEngineState } from './state';

/**
 * Route after S0 Router based on classified depth.
 *
 * - depth=0: casual chat → END (no further processing)
 * - depth=1: inspectional reading → S1
 * - depth=2 (analytical) and depth=3 (syntopical, downgraded in router) → S2
 */
export function routeByDepth(state: CognitiveEngineState): string {
  if (state.depth === 0) return 'casual';
  if (state.depth === 1) return 'inspectional';
  // depth=2 (analytical) and depth=3 (syntopical, already downgraded to 2)
  return 'analytical';
}

/**
 * Route after S1 Inspectional based on depth and results.
 *
 * - depth=1 with structural analysis complete → S4 (formatter)
 * - depth>=2 → S2 (analytical, which will use scopeNodeIds from S1)
 */
export function routeAfterInspectional(state: CognitiveEngineState): string {
  // depth=1 and structural analysis done → go straight to formatter
  if (state.depth <= 1 && state.structuralAnalysis) {
    return 'done';
  }
  // depth>=2 → continue to analytical reading
  return 'continue';
}
