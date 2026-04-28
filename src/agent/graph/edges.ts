/**
 * Conditional edges for the cognitive engine graph
 */

import type { CognitiveEngineState } from './state';

function hasDiagramIntent(state: CognitiveEngineState): boolean {
  return (state.allowedTools ?? []).includes('excalidraw');
}

/**
 * Route from START node.
 * - isProactive: skip router, go directly to inspectional
 * - otherwise: go to router (normal flow)
 */
export function routeFromStart(state: CognitiveEngineState): string {
  if (state.isProactive) return 'inspectional';
  return 'router';
}

/**
 * Route after S0 Router based on classified depth.
 */
export function routeByDepth(state: CognitiveEngineState): string {
  if (state.depth === 0) return 'formatter';
  return 'inspectional';
}

/**
 * Route after S1 Inspectional.
 *
 * - depth=3 → S3 (syntopical)
 * - depth=1 + diagram intent → visualizer (use S1's structural analysis)
 * - depth=1 + no diagram → formatter
 * - depth=2 → S2 (analytical)
 */
export function routeAfterInspectional(state: CognitiveEngineState): string {
  // Proactive: inspectional + Excalidraw → visualizer; otherwise → formatter
  if (state.isProactive) {
    if (state.proactiveTrigger === 'inspectional'
        && typeof window !== 'undefined'
        && (window as any).ExcalidrawAutomate) {
      return 'visualizer';
    }
    return 'done';
  }

  if (state.depth === 3) {
    return 'syntopical';
  }
  // depth=1: check if diagram intent
  if (state.depth === 1 && state.structuralAnalysis) {
    return hasDiagramIntent(state) ? 'visualizer' : 'done';
  }
  // depth=2 → analytical
  return 'continue';
}

/**
 * Route after S2 Analytical or S3 Syntopical.
 *
 * - diagram intent → visualizer
 * - no diagram → formatter
 */
export function routeAfterAnalysis(state: CognitiveEngineState): string {
  return hasDiagramIntent(state) ? 'visualizer' : 'formatter';
}
