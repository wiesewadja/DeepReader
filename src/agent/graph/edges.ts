/**
 * Conditional edges for the cognitive engine graph
 */

import { agentLog as log } from '../../utils/logger.js';
import { NODE_NAMES, EDGE_KEYS } from './node-names';
import type { CognitiveEngineState } from './state';
import { ReadingDepth } from './state';
import { hasDiagramIntent } from './utils/diagram-helper.js';
import { extractHumanMessageContents, resolveMode } from './utils/engine-helpers';

function userHasDiagramIntent(state: CognitiveEngineState): boolean {
  // Prefer original user message over rewrittenQuery — the router LLM may
  // strip diagram keywords (e.g. "画思维导图" → "整体结构").
  const humanMsgs = extractHumanMessageContents(state.messages);
  const lastUserMsg = humanMsgs[humanMsgs.length - 1] || '';
  return hasDiagramIntent(lastUserMsg) || hasDiagramIntent(state.rewrittenQuery || '');
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

  // Proactive: 直接完成（图表生成已迁移到 Hermes）
  if (mode === 'proactive') {
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
    return userHasDiagramIntent(state) ? NODE_NAMES.VISUALIZER : EDGE_KEYS.DONE;
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
 *
 * Two independent overrides force ANALYTICAL:
 *  - correctionDetected: user is pushing back on a prior answer
 *  - verifiedFullBookHits: S2-Pre ran L5 (negative-claim auto-verification)
 *    and the full-book search found evidence that the previous turn's
 *    "未出现" answer was wrong. Routing back to S2 lets the ReAct loop
 *    re-analyze with the new evidence — the only robust fix, since
 *    patching the analysis string and hoping S4 rephrases is unreliable.
 */
export function routeAfterPreSearch(state: CognitiveEngineState): string {
  if (state.correctionDetected) {
    log(`[Edges] correctionDetected=true, 强制跳过早停 → analytical`);
    return NODE_NAMES.ANALYTICAL;
  }
  if (state.verifiedFullBookHits && state.verifiedFullBookHits.length > 0) {
    log(`[Edges] verifiedFullBookHits=${state.verifiedFullBookHits.length}, L5 状态机重启 → analytical`);
    return NODE_NAMES.ANALYTICAL;
  }
  if (state.earlyStopContent) {
    return userHasDiagramIntent(state) ? NODE_NAMES.VISUALIZER : NODE_NAMES.FORMATTER;
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
  return userHasDiagramIntent(state) ? NODE_NAMES.VISUALIZER : NODE_NAMES.FORMATTER;
}
