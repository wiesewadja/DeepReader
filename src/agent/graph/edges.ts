/**
 * Conditional edges for the cognitive engine graph
 */

import type { CognitiveEngineState } from './state';
import { ReadingDepth } from './state';
import { NODE_NAMES, EDGE_KEYS } from './node-names';

function hasDiagramIntent(state: CognitiveEngineState): boolean {
  const tools = state.allowedTools ?? [];
  return tools.includes('excalidraw') || tools.includes('generate_infographic');
}

/**
 * Route from START node.
 * - isProactive: skip router, go directly to inspectional
 * - otherwise: go to router (normal flow)
 */
export function routeFromStart(state: CognitiveEngineState): string {
  if (state.isProactive) return NODE_NAMES.INSPECTIONAL;
  return NODE_NAMES.ROUTER;
}

/**
 * Route after S0 Router based on classified depth.
 */
export function routeByDepth(state: CognitiveEngineState): string {
  if (state.depth === ReadingDepth.CASUAL) return NODE_NAMES.FORMATTER;
  return NODE_NAMES.INSPECTIONAL;
}

/**
 * Route after S1 Inspectional.
 *
 * - isProactive → visualizer or formatter (ask Socratic question)
 * - isSocratic → formatter (dialogue mode, skip S2, reuse chatHistory)
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
      return NODE_NAMES.VISUALIZER;
    }
    return EDGE_KEYS.DONE;
  }

  // Socratic: skip S2, go to formatter with dialogue mode (reuses chatHistory)
  if (state.isSocratic) {
    return EDGE_KEYS.DONE;
  }

  if (state.depth === ReadingDepth.SYNTOPICAL) {
    return NODE_NAMES.SYNTOPICAL;
  }
  // depth=1: check if diagram intent (skip visualizer if S1 failed — no valid structural analysis)
  if (state.depth === ReadingDepth.INSPECTIONAL) {
    if (state.nodeErrors?.inspectional || !state.structuralAnalysis) return EDGE_KEYS.DONE;
    return hasDiagramIntent(state) ? NODE_NAMES.VISUALIZER : EDGE_KEYS.DONE;
  }
  // depth=2 → analytical
  return EDGE_KEYS.CONTINUE;
}

/**
 * Route after S2 Analytical or S3 Syntopical.
 *
 * - diagram intent → visualizer
 * - otherwise → formatter
 */
export function routeAfterAnalysis(state: CognitiveEngineState): string {
  return hasDiagramIntent(state) ? NODE_NAMES.VISUALIZER : NODE_NAMES.FORMATTER;
}
