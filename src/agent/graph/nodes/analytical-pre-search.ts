/**
 * S2-Pre: Pre-search Node — Coordinator
 *
 * Sits between S1 Inspectional and S2 Analytical. Delegates to:
 *   - ScopeGuard (enforceScopeHardGuard) — force-include critical chapters
 *   - claim-verifier (L5 negative-claim auto-verification)
 *   - PreSearchEngine — scope validation + BM25/hybrid search + confidence gating
 *   - EarlyStopDecider — wScore + substantive score + LLM response generation
 *
 * This file is the coordinator (~80 lines). All business logic lives in the modules above.
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import type { BookSearchResultV2 } from '../../../pageindex/book-types.js';
import { agentLog as log } from '../../../utils/logger.js';
import { getEarlyStopThreshold } from '../../config/agent-constants.js';
import type { PreSearchInput } from '../node-io.js';
import { buildFullAnalyticalContext } from '../../prompts/utils/index.js';
import type { CognitiveEngineState } from '../state';
import { extractCitedNodeIds } from '../utils/chapter-reference-parser.js';
import {
  shouldVerifyNegativeClaim,
  verifyNegativeClaimWithFullBook,
} from '../utils/claim-verifier.js';
import { resolveCurrentChapterName, extractHumanMessageContents } from '../utils/engine-helpers.js';
import { enforceScopeHardGuard, formatGuardInjectedLog } from '../utils/scope-guard.js';
import { emptyPreSearchResult, formatBlockLines, formatVerifiedFullBookBlock } from '../utils/formatters.js';
import { preSearchEngine } from './pre-search-engine.js';
import { earlyStopDecider } from './early-stop-decider.js';

/**
 * S2-Pre node: scope validation + pre-search RRF + early stop decision.
 */
export async function preSearchNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const {
    scopeNodeIds: rawScopeNodeIds,
    pdfName: statePdfName,
    tocSummary: stateTocSummary,
    rewrittenQuery: stateQuery,
    betterQuestion: stateBetterQuestion,
    suggestedKeywords: stateKeywords,
  }: PreSearchInput = state;
  const ctx = config.configurable?.sharedContext;
  const mainModel = config.configurable?.mainModel;
  const toolContext = config.configurable?.toolContext;

  if (!mainModel || !toolContext) {
    return emptyPreSearchResult(rawScopeNodeIds);
  }

  const effectivePdfName = statePdfName || ctx?.toolContext?.book.pdfName || '';
  const tocSummary = stateTocSummary || ctx?.tocSummary;
  const currentNodeId = toolContext.book.currentNodeId;
  const currentChapterName = resolveCurrentChapterName(currentNodeId, toolContext.book.markdownFiles);
  const markdownFiles = ctx?.toolContext?.book.markdownFiles ?? {};

  // ── 1. Scope hard-guard ────────────────────────────────────────────────
  const citedFromMessages = extractCitedNodeIds(
    extractHumanMessageContents(state.messages),
  );
  const guardResult = enforceScopeHardGuard(
    rawScopeNodeIds,
    currentNodeId,
    citedFromMessages,
  );
  const validatedScopeNodeIds = guardResult.scope;
  if (guardResult.injected.length > 0) {
    log(`[S2-Pre] Scope hard-guard injected ${guardResult.injected.length} ids: ${formatGuardInjectedLog(guardResult.injected)}`);
  }

  // ── 2. L5 negative-claim auto-verification ─────────────────────────────
  const queryForL5 = stateQuery || stateBetterQuestion || ctx?.rawUserQuery || '';
  let verifiedFullBookHits: BookSearchResultV2[] = [];
  if (toolContext.book.indexId
      && toolContext.vault.app
      && shouldVerifyNegativeClaim(state.analysisResult, queryForL5)) {
    verifiedFullBookHits = await verifyNegativeClaimWithFullBook(queryForL5, {
      bookId: toolContext.book.indexId,
      app: toolContext.vault.app,
    });
    if (verifiedFullBookHits.length > 0) {
      log(`[S2-Pre] L5 命中 ${verifiedFullBookHits.length} 条, 强制走 analytical 重新 ReAct`);
    }
  }
  const l5ForcesAnalytical = verifiedFullBookHits.length > 0;

  // Merge L5 hit nodeIds into scope
  const finalScopeNodeIds: string[] = l5ForcesAnalytical
    ? Array.from(new Set([
        ...validatedScopeNodeIds,
        ...verifiedFullBookHits.map(h => h.nodeId),
      ]))
    : validatedScopeNodeIds;

  // ── 3. Pre-search via engine (returns nodeFileMap + earlyStopCandidate) ─
  if (!stateKeywords || stateKeywords.length === 0 || !toolContext.vault.app) {
    return emptyPreSearchResult(finalScopeNodeIds);
  }

  const queryText = stateBetterQuestion || stateQuery || ctx?.rawUserQuery || '';
  const searchResult = await preSearchEngine({
    scopeNodeIds: finalScopeNodeIds,
    keywords: stateKeywords,
    bookId: toolContext.book.indexId || '',
    app: toolContext.vault.app,
    settings: toolContext.vault.plugin?.settings || {},
    currentNodeId,
    queryText,
  });

  if (searchResult.finalHits.length < 2) {
    log(`[S2-Pre] 预检索结果不足 (${searchResult.finalHits.length} 条), 跳过注入`);
    return {
      ...emptyPreSearchResult(finalScopeNodeIds),
      queryVector: searchResult.queryVector,
    };
  }

  // ── 4. Build prompt context (with actual nodeFileMap from engine) ──────
  const { fullSystemPrompt } = buildFullAnalyticalContext({
    scopeNodeIds: finalScopeNodeIds,
    tocSummary,
    currentNodeId,
    currentChapterName,
    userProfileSummary: ctx?.userProfileSummary,
    markdownFiles,
    nodeFileMap: searchResult.nodeFileMap,
    standaloneQuery: stateQuery || ctx?.rawUserQuery || '',
    betterQuestion: stateBetterQuestion || ctx?.betterQuestion,
    recentHistorySummaries: ctx?.recentHistorySummaries,
    prevSearchedBlockIds: ctx?.prevSearchedBlockIds,
    skipUserMessage: true,
  });

  // ── 5. Normalize hits for early-stop decider ──────────────────────────
  const hits = searchResult.finalHits.slice(0, 3).map(r => ({
    node_id: r.nodeId,
    title: r.title,
    file_name: r.fileName,
    score: r.score,
    matched_blocks: r.matchedBlocks.slice(0, 2).map(b => ({
      block_id: b.blockId.replace(/^\^/, ''),
      content: b.content.slice(0, 200),
    })),
  }));

  // block_id dedup across hits
  const seenBlockIds = new Set<string>();
  for (const h of hits) {
    h.matched_blocks = h.matched_blocks.filter(b => {
      if (seenBlockIds.has(b.block_id)) return false;
      seenBlockIds.add(b.block_id);
      return true;
    });
  }

  // ── 6. Early stop decision ────────────────────────────────────────────
  const earlyStopThreshold = getEarlyStopThreshold(toolContext.vault.plugin?.settings);
  const earlyStopResult = await earlyStopDecider({
    hits,
    threshold: earlyStopThreshold,
    mainModel,
    config,
    fullSystemPrompt,
    userQuery: queryText,
    l5ForcesAnalytical,
    earlyStopCandidate: searchResult.earlyStopCandidate,
  });

  if (earlyStopResult.decision === 'early_stop') {
    log(`[S2-Pre] 早停: wScore=${earlyStopResult.wScore.toFixed(2)} >= ${earlyStopThreshold}, substantive=${earlyStopResult.substantiveScore}, 跳过 ReAct`);
    return {
      validatedScopeNodeIds: finalScopeNodeIds,
      nodeFileMap: searchResult.nodeFileMap,
      earlyStopContent: 'done',
      analysisResult: earlyStopResult.content,
      toolResultsSnapshot: earlyStopResult.records || [],
      verifiedFullBookHits,
      queryVector: searchResult.queryVector,
    };
  }

  // ── 7. Normal path: inject pre-search results ─────────────────────────
  if (l5ForcesAnalytical) {
    log(`[S2-Pre] L5 强制走 analytical: 跳过早停决策, 注入 ${verifiedFullBookHits.length} 条全量复核 hits`);
  } else if (earlyStopResult.wScore >= earlyStopThreshold && hits.length >= 2 && earlyStopResult.substantiveScore < 40) {
    log(`[S2-Pre] 早停被质量守卫拦截: wScore=${earlyStopResult.wScore.toFixed(2)} 但实质性分数仅 ${earlyStopResult.substantiveScore}/40, 走 ReAct`);
  }

  const blockLines = formatBlockLines(hits, effectivePdfName);
  const preSearchBlockIds = hits.flatMap(h => h.matched_blocks.map(b => b.block_id).filter(Boolean));
  const existingBlockIds = ctx?.prevSearchedBlockIds ?? [];
  const mergedBlockIds = [...new Set([...existingBlockIds, ...preSearchBlockIds])];

  const mainPreSearchBlock = `<pre_search_results>
基于目录分析自动检索到的相关段落（共 ${searchResult.finalHits.length} 条，取前 ${hits.length} 条），请优先利用。不够可用 search_book 补充。

${blockLines.join('\n\n')}
</pre_search_results>`;

  const preSearchBlock = l5ForcesAnalytical
    ? `${formatVerifiedFullBookBlock(verifiedFullBookHits)}\n\n${mainPreSearchBlock}`
    : mainPreSearchBlock;

  log(`[S2-Pre] 预检索注入: ${searchResult.finalHits.length} 条结果, wScore=${earlyStopResult.wScore.toFixed(2)}, substantive=${earlyStopResult.substantiveScore}, ${stateKeywords.length} 个关键词, ${mergedBlockIds.length} 个 block_id 已标记, L5=${verifiedFullBookHits.length}`);

  return {
    validatedScopeNodeIds: finalScopeNodeIds,
    nodeFileMap: searchResult.nodeFileMap,
    preSearchBlock,
    earlyStopContent: '',
    toolResultsSnapshot: [],
    prevSearchedBlockIds: mergedBlockIds,
    verifiedFullBookHits,
    queryVector: searchResult.queryVector,
  };
}
