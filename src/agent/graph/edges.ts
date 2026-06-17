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
  // 三路触发 visualizer：
  // 1. 用户消息/重写查询命中画图关键词（正则，快速路径，用户明说"画图/思维导图"）
  // 2. router LLM 自主判断 shouldVisualize（语义级，概念/流程/框架类问题主动配图）
  // 任一为真即触发。
  const humanMsgs = extractHumanMessageContents(state.messages);
  const lastUserMsg = humanMsgs[humanMsgs.length - 1] || '';
  const keywordIntent = hasDiagramIntent(lastUserMsg) || hasDiagramIntent(state.rewrittenQuery || '');
  const semanticIntent = state.shouldVisualize === true;
  return keywordIntent || semanticIntent;
}

/**
 * Route from START node.
 * - No book selected AND not in booklist mode → advisor or casual
 * - otherwise: go directly to inspectional (which handles routing & chapter selection)
 */
export function routeFromStart(state: CognitiveEngineState): string {
  const mode = resolveMode(state);
  if (!state.pdfName && !state.crossBookMode) {
    if (mode === 'socratic') return NODE_NAMES.FORMATTER;
    if (state.wereadAvailable) return NODE_NAMES.ADVISOR;
    return NODE_NAMES.FORMATTER;
  }
  return NODE_NAMES.INSPECTIONAL;
}

/**
 * Route after S1 Inspectional.
 *
 * - mode=proactive → visualizer or formatter (ask Socratic question)
 * - mode=socratic → formatter (dialogue mode, skip S2, reuse chatHistory)
 * - depth=0 (casual) → formatter
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

  if (state.depth === ReadingDepth.CASUAL) {
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
