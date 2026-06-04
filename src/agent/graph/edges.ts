/**
 * Conditional edges for the cognitive engine graph
 */

import type { CognitiveEngineState } from './state';
import { ReadingDepth } from './state';
import { NODE_NAMES, EDGE_KEYS } from './node-names';
import { resolveMode } from './utils/engine-helpers';

function hasDiagramIntent(_state: CognitiveEngineState): boolean {
  // 图表生成已迁移到 Hermes，暂时跳过
  return false;
}

/**
 * Route from START node.
 * - proactive: skip router, go directly to inspectional
 * - otherwise: go to router (normal flow)
 */
export function routeFromStart(state: CognitiveEngineState): string {
  const mode = resolveMode(state);
  if (mode === 'proactive') return NODE_NAMES.INSPECTIONAL;
  return NODE_NAMES.ROUTER;
}

/**
 * Route after S0 Router based on classified depth.
 */
export function routeByDepth(state: CognitiveEngineState): string {
  // No book selected AND not in booklist mode → advisor or casual
  if (!state.pdfName && !state.crossBookMode) {
    const mode = resolveMode(state);
    if (mode === 'socratic') return NODE_NAMES.FORMATTER;
    if (state.wereadAvailable) return NODE_NAMES.ADVISOR;
    return NODE_NAMES.FORMATTER;
  }
  if (state.depth === ReadingDepth.CASUAL) return NODE_NAMES.FORMATTER;
  // Syntopical (depth=3) skips Inspectional — multi-book search doesn't use single-book TOC analysis
  if (state.depth === ReadingDepth.SYNTOPICAL) return NODE_NAMES.SYNTOPICAL;
  return NODE_NAMES.INSPECTIONAL;
}

/**
 * Route after S1 Inspectional.
 *
 * - mode=proactive → visualizer or formatter (ask Socratic question)
 * - mode=socratic → formatter (dialogue mode, skip S2, reuse chatHistory)
 * - depth=3 → S3 (syntopical)
 * - depth=1 + diagram intent → visualizer (use S1's structural analysis)
 * - depth=1 + no diagram → formatter
 * - depth=2 → S2 (analytical)
 */
export function routeAfterInspectional(state: CognitiveEngineState): string {
  const mode = resolveMode(state);

  // Proactive: inspectional + Excalidraw → visualizer; otherwise → formatter
  if (mode === 'proactive') {
    if (state.proactiveTrigger === 'inspectional'
        && typeof window !== 'undefined'
        && window.ExcalidrawAutomate) {
      return NODE_NAMES.VISUALIZER;
    }
    return EDGE_KEYS.DONE;
  }

  // Socratic: skip S2, go to formatter with dialogue mode (reuses chatHistory)
  if (mode === 'socratic') {
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
  // depth=2 → pre-search (then analytical or early-stop formatter)
  return NODE_NAMES.PRE_SEARCH;
}

/**
 * Route after S2-Pre (Pre-search).
 *
 * - earlyStopContent is a routing signal: 'done' means pre-search quality was
 *   high enough to generate a direct answer (stored in analysisResult).
 *   Empty string means normal path → analytical.
 * - otherwise → analytical (run ReAct/PlanExecute)
 */
export function routeAfterPreSearch(state: CognitiveEngineState): string {
  if (state.earlyStopContent) {
    return hasDiagramIntent(state) ? NODE_NAMES.VISUALIZER : NODE_NAMES.FORMATTER;
  }
  return NODE_NAMES.ANALYTICAL;
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
