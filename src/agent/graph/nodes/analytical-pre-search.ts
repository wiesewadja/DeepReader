/**
 * S2-Pre: Pre-search Node — Scope validation + RRF retrieval + early stop
 *
 * Sits between S1 Inspectional and S2 Analytical. Validates scope node IDs,
 * runs pre-search with S1's suggested keywords, and decides whether to
 * early-stop (high-quality results) or pass data to the ReAct loop.
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { RunnableLambda } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import type { ToolResultSnapshot } from '../state';
import { getEarlyStopThreshold } from '../../config/agent-constants.js';
import type { PreSearchInput } from '../node-io.js';
import { buildFullAnalyticalContext } from '../prompts/analytical-prompt.js';
import { buildEarlyStopPrompt } from '../prompts/pre-search-prompt.js';
import { searchBookV2 } from '../../../pageindex/book-search-v2.js';
import type { BookSearchResultV2, BookSearchOptionsV2 } from '../../../pageindex/book-types.js';
import { agentLog as log } from '../../../utils/logger.js';
import { resolveRoleConfig } from '../../../config/providers.js';
import { toEmbeddingOptions, toRerankerOptions } from '../../../config/role-adapters.js';
import { verifyAndCleanContent } from '../utils/self-verification.js';
import { resolveCurrentChapterName, extractHumanMessageContents } from '../utils/engine-helpers.js';
import { extractCitedNodeIds } from '../utils/chapter-reference-parser.js';
import { enforceScopeHardGuard, formatGuardInjectedLog } from '../utils/scope-guard.js';
import {
  shouldVerifyNegativeClaim,
  verifyNegativeClaimWithFullBook,
} from '../utils/claim-verifier.js';
import { PAGEINDEX_DIR } from '../../../pageindex/paths.js';

/** 空的 pre-search 返回结构，多处复用 */
function emptyPreSearchResult(validatedScopeNodeIds: string[] = []): Partial<CognitiveEngineState> {
  return {
    validatedScopeNodeIds,
    preSearchBlock: '',
    earlyStopContent: '',
    toolResultsSnapshot: [],
    prevSearchedBlockIds: [],
    verifiedFullBookHits: [],
  };
}

/** 把 L5 全量复核命中的 hits 格式化为 prompt 块 */
function formatVerifiedFullBookBlock(hits: BookSearchResultV2[]): string {
  const lines = hits.slice(0, 3).flatMap(h =>
    h.matchedBlocks.slice(0, 2).map(b => {
      const content = b.content.length > 200 ? `${b.content.slice(0, 200)}...` : b.content;
      return `【${h.title}】(file_name: "${h.fileName}", block_id: ${b.blockId.replace(/^\^/, '')})\n${content}`;
    })
  );
  return `<verified_full_book_hits>
【L5 负向声明自动复核命中】上一轮你或前序 S2 说过"书中未出现相关概念"，但全量书库搜索（不受当前 scope 限制）已找到以下证据。请基于这些证据重新分析，禁止再次输出"未出现/未提及"：
${lines.join('\n\n')}
</verified_full_book_hits>`;
}

/**
 * Validate scopeNodeIds against tree.json nodeFileMap.
 */
async function validateScopeNodeIds(
  app: import('obsidian').App,
  bookId: string,
  pdfName: string,
  scopeNodeIds: string[]
): Promise<{ validIds: string[]; nodeFileMap: Record<string, string> }> {
  if (scopeNodeIds.length === 0 || !bookId) return { validIds: [], nodeFileMap: {} };

  try {
    const treePath = `${PAGEINDEX_DIR}/${bookId}/tree.json`;
    const treeContent = await app.vault.adapter.read(treePath);
    const treeData = JSON.parse(treeContent);

    const validIds: string[] = [];
    const allNodeIds = new Set<string>();
    collectAllNodeIds((treeData.structure || []) as TreeNode[], allNodeIds);

    for (const id of scopeNodeIds) {
      if (allNodeIds.has(id)) {
        validIds.push(id);
      }
    }

    if (validIds.length < scopeNodeIds.length) {
      log(`[S2-Pre] Scope validation: ${validIds.length}/${scopeNodeIds.length} IDs valid`);
    }

    const nodeFileMap: Record<string, string> = treeData.nodeFileMap || {};
    return { validIds, nodeFileMap };
  } catch (err) {
    log('[S2-Pre] Scope validation failed, using all IDs:', err);
    return { validIds: scopeNodeIds, nodeFileMap: {} };
  }
}

type TreeNode = { nodeId?: string; nodes?: TreeNode[] };
function collectAllNodeIds(nodes: TreeNode[], idSet: Set<string>): void {
  for (const node of nodes) {
    if (node.nodeId) idSet.add(node.nodeId);
    if (node.nodes) collectAllNodeIds(node.nodes, idSet);
  }
}

/** 格式化命中结果为带元数据的文本行 */
type HitEntry = { title: string; file_name: string; matched_blocks: { block_id: string; content: string }[] };
function formatBlockLines(hits: HitEntry[]): string[] {
  return hits.flatMap(h =>
    h.matched_blocks.map(b =>
      `【${h.title}】(file_name: "${h.file_name}", block_id: ${b.block_id})\n${b.content}`
    )
  );
}

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

  // 1. Validate scope
  const { validIds: validatedScopeNodeIdsRaw, nodeFileMap } = await validateScopeNodeIds(
    toolContext.vault.app,
    toolContext.book.indexId || '',
    statePdfName || ctx?.toolContext?.book.pdfName || '',
    rawScopeNodeIds,
  );

  const tocSummary = stateTocSummary || ctx?.tocSummary;
  const currentNodeId = toolContext.book.currentNodeId;
  const currentChapterName = resolveCurrentChapterName(currentNodeId, toolContext.book.markdownFiles);
  const markdownFiles = ctx?.toolContext?.book.markdownFiles ?? {};

  // === Scope hard-guard (defense in depth — see utils/scope-guard.ts docstring) ===
  const citedFromMessages = extractCitedNodeIds(
    extractHumanMessageContents(state.messages),
  );
  const guardResult = enforceScopeHardGuard(
    validatedScopeNodeIdsRaw,
    currentNodeId,
    citedFromMessages,
  );
  const validatedScopeNodeIds = guardResult.scope;
  if (guardResult.injected.length > 0) {
    log(`[S2-Pre] Scope hard-guard injected ${guardResult.injected.length} ids: ${formatGuardInjectedLog(guardResult.injected)}`);
  }

  // === L5: Negative-claim auto-verification against the FULL book ===
  // If the previous turn's analysisResult contained a "未出现" claim AND
  // a full-book search now surfaces meaningful hits, force a state-machine
  // restart at S2 Analytical (skip the early-stop path) and inject the
  // verified hits into S2's context. S2's ReAct loop can then re-analyze
  // with the new evidence rather than S4 patching a wrong answer.
  // See utils/claim-verifier.ts:75 for the detection + search.
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

  // L5 命中后，把 verified hits 的 nodeIds 合并进 validatedScopeNodeIds（去重），
  // 让 S2 的 search_book 可以深入这些章节 explore 上下文。Scope 是 S2-Pre 的
  // 单一收尾点（与 enforceScopeHardGuard 一致），S2 不应再知道 L5 的存在。
  // 用 Set 重写并保持 `validatedScopeNodeIds` 的 const 语义清晰。
  const finalScopeNodeIds: string[] = verifiedFullBookHits.length > 0
    ? Array.from(new Set([
        ...validatedScopeNodeIds,
        ...verifiedFullBookHits.map(h => h.nodeId),
      ]))
    : validatedScopeNodeIds;

  // 2. Build prompt context (shared with analytical node)
  const { fullSystemPrompt } = buildFullAnalyticalContext({
    scopeNodeIds: finalScopeNodeIds,
    tocSummary,
    currentNodeId,
    currentChapterName,
    userProfileSummary: ctx?.userProfileSummary,
    markdownFiles,
    nodeFileMap,
    standaloneQuery: stateQuery || ctx?.rawUserQuery || '',
    betterQuestion: stateBetterQuestion || ctx?.betterQuestion,
    recentHistorySummaries: ctx?.recentHistorySummaries,
    prevSearchedBlockIds: ctx?.prevSearchedBlockIds,
    skipUserMessage: true,
  });

  // 3. Pre-search RRF with S1's suggested_keywords
  if (!stateKeywords || stateKeywords.length === 0 || !toolContext.vault.app) {
    return emptyPreSearchResult(finalScopeNodeIds);
  }

  const pluginSettings = toolContext.vault.plugin?.settings;
  const earlyStopThreshold = getEarlyStopThreshold(pluginSettings);

  try {
    const embeddingRole = pluginSettings ? resolveRoleConfig('embedding', pluginSettings) : null;
    const rerankerRole = pluginSettings ? resolveRoleConfig('reranker', pluginSettings) : null;
    const rerankerWeight = pluginSettings?.rerankerWeight ?? 0.7;

    // #6: 动态 topK — 事实性短查询用少量精确结果，概念性长查询提高召回
    const queryText = stateBetterQuestion || stateQuery || ctx?.rawUserQuery || '';
    const queryLen = queryText.length;
    const dynamicTopK = queryLen < 8 ? 5 : queryLen > 30 ? 15 : 10;

    const baseSearchOpts: Omit<BookSearchOptionsV2, 'query'> = {
      filePath: '',
      topK: dynamicTopK,
      embedding: embeddingRole ? toEmbeddingOptions(embeddingRole) : undefined,
      reranker: rerankerRole ? toRerankerOptions(rerankerRole, rerankerWeight) : undefined,
      scopeNodeIds: finalScopeNodeIds.length > 0 ? finalScopeNodeIds : undefined,
      app: toolContext.vault.app,
    };
    if (toolContext.book.indexId) {
      baseSearchOpts.bookId = toolContext.book.indexId;
    }

    // Deduplicate and limit keywords (S1 may produce overlapping terms)
    const uniqueKeywords = [...new Set(stateKeywords.map(k => k.trim()).filter(Boolean))];
    const limitedKeywords = uniqueKeywords.slice(0, 5);
    const preSearchRunnable = RunnableLambda.from(
      async () => {
        const subResults = await Promise.all(
          limitedKeywords.map(async (kw) => {
            try {
              return await searchBookV2({ ...baseSearchOpts, query: kw });
            } catch (err) {
              log(`[S2-Pre] Keyword search failed for "${kw}":`, err instanceof Error ? err.message : String(err));
              return [];
            }
          })
        );

        const mergedMap = new Map<string, { result: BookSearchResultV2; hitCount: number }>();
        for (const results of subResults) {
          for (const r of results) {
            const existing = mergedMap.get(r.nodeId);
            if (existing) {
              existing.hitCount++;
              if (r.score > existing.result.score) existing.result = r;
            } else {
              mergedMap.set(r.nodeId, { result: r, hitCount: 1 });
            }
          }
        }
        return Array.from(mergedMap.values())
          .sort((a, b) => {
            let scoreA = a.result.score + a.hitCount * 0.1;
            let scoreB = b.result.score + b.hitCount * 0.1;
            if (currentNodeId && a.result.nodeId === currentNodeId) scoreA += 0.2;
            if (currentNodeId && b.result.nodeId === currentNodeId) scoreB += 0.2;
            return scoreB - scoreA;
          })
          .map(e => e.result);
      }
    ).withConfig({ runName: 'pre_search_rrf' });
    const preResults = await preSearchRunnable.invoke({}, { callbacks: config.callbacks });

    if (!Array.isArray(preResults) || preResults.length < 2) {
      log(`[S2-Pre] 预检索结果不足 (${Array.isArray(preResults) ? preResults.length : 0} 条), 跳过注入`);
      return emptyPreSearchResult(finalScopeNodeIds);
    }

    const hits = preResults.slice(0, 3).map(r => ({
      node_id: r.nodeId,
      title: r.title,
      file_name: r.fileName,
      score: r.score,
      matched_blocks: r.matchedBlocks.slice(0, 2).map(b => ({
        block_id: b.blockId.replace(/^\^/, ''),
        content: b.content.slice(0, 200),
      })),
    }));

    // #7: block_id 级别去重 — 不同关键词可能命中同一 block
    const seenBlockIds = new Set<string>();
    for (const h of hits) {
      h.matched_blocks = h.matched_blocks.filter(b => {
        if (seenBlockIds.has(b.block_id)) return false;
        seenBlockIds.add(b.block_id);
        return true;
      });
    }

    // 4. Early stop check
    // #1: 加权 avgScore — Top-1 占 60%, Top-2 占 30%, Top-3 占 10%
    const wScore = hits[0].score * 0.6
      + (hits[1]?.score ?? 0) * 0.3
      + (hits[2]?.score ?? 0) * 0.1;

    // #3: 连续性实质性分数（0-100），替代原来的二元 hasSubstantiveBlocks
    // 考虑: block_id 非空 +20, 内容长度每 10 字 +1(上限+30), 非空壳 +15
    function computeSubstantiveScore(): number {
      // 所有 block_id 均为空 → 纯标题回退，直接返回 0
      if (hits.every(h => h.matched_blocks.every(b => !b.block_id))) {
        return 0;
      }
      let maxScore = 0;
      for (const h of hits) {
        for (const b of h.matched_blocks) {
          let s = 0;
          if (b.block_id) s += 20;
          s += Math.min(b.content.length / 10, 30);
          if (b.content.length > 20) s += 15;
          maxScore = Math.max(maxScore, s);
        }
      }
      return maxScore;
    }
    const SUBSTANTIVE_THRESHOLD = 30;
    const substantiveScore = computeSubstantiveScore();

    if (wScore >= earlyStopThreshold && hits.length >= 2 && substantiveScore >= SUBSTANTIVE_THRESHOLD
        && !l5ForcesAnalytical) {
      log(`[S2-Pre] 早停: wScore=${wScore.toFixed(2)} >= ${earlyStopThreshold}, substantive=${substantiveScore}, 跳过 ReAct`);

      const blockLines = formatBlockLines(hits);

      const pdfName = statePdfName || ctx?.toolContext?.book.pdfName || '';
      const userQuery = stateBetterQuestion || stateQuery || ctx?.rawUserQuery || '';
      const directPrompt = buildEarlyStopPrompt(fullSystemPrompt, blockLines, userQuery, pdfName);

      const directResponse = await mainModel.invoke([
        new SystemMessage(directPrompt),
        new HumanMessage(userQuery),
      ], config);

      const directContent = typeof directResponse.content === 'string'
        ? directResponse.content
        : Array.isArray(directResponse.content)
          ? (directResponse.content as { type: string; text: string }[])
              .filter(c => c.type === 'text')
              .map(c => c.text)
              .join('')
          : '';

      const preSearchRecords = hits.flatMap(h =>
        h.matched_blocks.map(b => ({
          toolName: 'pre_search',
          args: { query: 'auto', node_id: h.node_id },
          result: b.content,
          originalResultLength: b.content.length,
          extractedBlockIds: [b.block_id],
        }))
      );

      const verifyResult = await verifyAndCleanContent(directContent, preSearchRecords);

      return {
        validatedScopeNodeIds: finalScopeNodeIds,
        nodeFileMap,
        earlyStopContent: 'done',
        analysisResult: verifyResult.content,
        toolResultsSnapshot: preSearchRecords,
        verifiedFullBookHits,
      };
    }

    // 5. Normal path: inject compact pre-search results
    const blockLines = formatBlockLines(hits);
    if (l5ForcesAnalytical) {
      log(`[S2-Pre] L5 强制走 analytical: 跳过早停决策, 注入 ${verifiedFullBookHits.length} 条全量复核 hits`);
    } else if (wScore >= earlyStopThreshold && hits.length >= 2 && substantiveScore < SUBSTANTIVE_THRESHOLD) {
      log(`[S2-Pre] 早停被质量守卫拦截: wScore=${wScore.toFixed(2)} 但实质性分数仅 ${substantiveScore}/${SUBSTANTIVE_THRESHOLD}, 走 ReAct`);
    }

    // #5: 提取所有已搜 block_ids，供下游 ReAct 循环避免重复搜索
    const preSearchBlockIds = hits.flatMap(h =>
      h.matched_blocks.map(b => b.block_id).filter(Boolean)
    );
    const existingBlockIds = ctx?.prevSearchedBlockIds ?? [];
    const mergedBlockIds = [...new Set([...existingBlockIds, ...preSearchBlockIds])];

    const mainPreSearchBlock = `<pre_search_results>
基于目录分析自动检索到的相关段落（共 ${preResults.length} 条，取前 ${hits.length} 条），请优先利用。不够可用 search_book 补充。

${blockLines.join('\n\n')}
</pre_search_results>`;

    // L5 注入：把全量书库复核命中的 hits 放在 main pre-search 之前，
    // 让 S2 ReAct 看到「之前 S2 答错了，但全量复核已找到证据」的上下文。
    const preSearchBlock = l5ForcesAnalytical
      ? `${formatVerifiedFullBookBlock(verifiedFullBookHits)}\n\n${mainPreSearchBlock}`
      : mainPreSearchBlock;

    log(`[S2-Pre] 预检索注入: ${preResults.length} 条结果, wScore=${wScore.toFixed(2)}, substantive=${substantiveScore}, ${stateKeywords.length} 个关键词, ${mergedBlockIds.length} 个 block_id 已标记, L5=${verifiedFullBookHits.length}`);

    return {
      validatedScopeNodeIds: finalScopeNodeIds,
      nodeFileMap,
      preSearchBlock,
      earlyStopContent: '',
      toolResultsSnapshot: [],
      prevSearchedBlockIds: mergedBlockIds,
      verifiedFullBookHits,
    };
  } catch (err) {
    log('[S2-Pre] 预检索失败 (非致命):', err instanceof Error ? err.message : String(err));
    return emptyPreSearchResult(finalScopeNodeIds);
  }
}
