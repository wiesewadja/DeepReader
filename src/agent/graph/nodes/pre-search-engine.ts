/**
 * PreSearchEngine — Scope validation + BM25/hybrid search + confidence gating
 *
 * Encapsulates the search logic extracted from analytical-pre-search.ts.
 * Responsibilities:
 *   1. Validate scopeNodeIds against tree.json
 *   2. Run multi-keyword BM25 search via keywordSearchFusion
 *   3. Compute BM25 confidence (literal instant kill gate)
 *   4. Optionally upgrade to vector search when confidence is medium
 *   5. Return merged hits + confidence signals for EarlyStopDecider
 */

import type { App } from 'obsidian';
import { resolveRoleConfig } from '../../../config/providers.js';
import { toEmbeddingOptions, toRerankerOptions } from '../../../config/role-adapters.js';
import type { BookSearchOptionsV2, BookSearchResultV2 } from '../../../pageindex/book-types.js';
import { PAGEINDEX_DIR } from '../../../pageindex/paths.js';
import { agentLog as log } from '../../../utils/logger.js';
import { computeMaxTheoryBM25, computeKeywordCoverage } from '../utils/scoring-utils.js';
import { keywordSearchFusion } from '../utils/keyword-search-fusion.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PreSearchEngineParams {
  scopeNodeIds: string[];
  keywords: string[];
  bookId: string;
  app: App;
  settings: Record<string, unknown>;
  currentNodeId: string;
  queryText?: string;
}

export interface PreSearchEngineResult {
  finalHits: BookSearchResultV2[];
  validatedScopeNodeIds: string[];
  nodeFileMap: Record<string, string>;
  bm25Confidence: number;
  queryVector: number[] | null;
  earlyStopCandidate: boolean;
}

// ─── Scope validation ──────────────────────────────────────────────────────

type TreeNode = { nodeId?: string; nodes?: TreeNode[] };

function collectAllNodeIds(nodes: TreeNode[], idSet: Set<string>): void {
  for (const node of nodes) {
    if (node.nodeId) idSet.add(node.nodeId);
    if (node.nodes) collectAllNodeIds(node.nodes, idSet);
  }
}

async function validateScopeNodeIds(
  app: App,
  bookId: string,
  scopeNodeIds: string[],
): Promise<{ validIds: string[]; nodeFileMap: Record<string, string> }> {
  if (scopeNodeIds.length === 0 || !bookId) return { validIds: [], nodeFileMap: {} };

  try {
    const treePath = `${PAGEINDEX_DIR}/${bookId}/tree.json`;
    const treeContent = await app.vault.adapter.read(treePath);
    const treeData = JSON.parse(treeContent);

    const allNodeIds = new Set<string>();
    collectAllNodeIds((treeData.structure || []) as TreeNode[], allNodeIds);

    const validIds = scopeNodeIds.filter(id => allNodeIds.has(id));

    if (validIds.length < scopeNodeIds.length) {
      log(`[PreSearchEngine] Scope validation: ${validIds.length}/${scopeNodeIds.length} IDs valid`);
    }

    const nodeFileMap: Record<string, string> = treeData.nodeFileMap || {};
    return { validIds, nodeFileMap };
  } catch (err) {
    log('[PreSearchEngine] Scope validation failed, using all IDs:', err);
    return { validIds: scopeNodeIds, nodeFileMap: {} };
  }
}

// ─── Main engine ───────────────────────────────────────────────────────────

export async function preSearchEngine(
  params: PreSearchEngineParams,
): Promise<PreSearchEngineResult> {
  const { scopeNodeIds, keywords, bookId, app, settings, currentNodeId, queryText } = params;

  if (keywords.length === 0) {
    return {
      finalHits: [],
      validatedScopeNodeIds: scopeNodeIds,
      nodeFileMap: {},
      bm25Confidence: 0,
      queryVector: null,
      earlyStopCandidate: false,
    };
  }

  // 1. Validate scope
  const { validIds: validatedScopeNodeIds, nodeFileMap } = await validateScopeNodeIds(app, bookId, scopeNodeIds);

  // 2. Dynamic topK based on query length
  const queryLen = (queryText || '').length;
  const dynamicTopK = queryLen < 8 ? 5 : queryLen > 30 ? 15 : 10;

  const searchOpts: BookSearchOptionsV2 = {
    filePath: '',
    topK: dynamicTopK,
    scopeNodeIds: validatedScopeNodeIds.length > 0 ? validatedScopeNodeIds : undefined,
    app,
    bookId: bookId || undefined,
    query: '',
  };

  // 3. BM25 search
  const bm25Results = await keywordSearchFusion(keywords.slice(0, 5), searchOpts, { currentNodeId });

  if (bm25Results.length < 2) {
    return {
      finalHits: [],
      validatedScopeNodeIds,
      nodeFileMap,
      bm25Confidence: 0,
      queryVector: null,
      earlyStopCandidate: false,
    };
  }

  // 4. Compute BM25 confidence
  const top1 = bm25Results[0];
  let bm25Index: Record<string, unknown> | null = null;
  try {
    const bm25Path = `${PAGEINDEX_DIR}/${bookId}/bm25.json`;
    const bm25Content = await app.vault.adapter.read(bm25Path);
    bm25Index = JSON.parse(bm25Content);
  } catch {
    // bm25.json missing or corrupt — use fallback confidence
  }

  const maxTheory = computeMaxTheoryBM25(keywords, bm25Index as any);
  const confidence = top1.score / maxTheory;
  const coverage = computeKeywordCoverage(
    keywords,
    top1.matchedBlocks.map(b => b.content).join(' '),
  );

  // 5. Literal instant kill check
  const top1SubstantiveScore = (top1.matchedBlocks[0]?.blockId ? 20 : 0)
    + Math.min((top1.matchedBlocks[0]?.content.length || 0) / 10, 30)
    + ((top1.matchedBlocks[0]?.content.length || 0) > 20 ? 15 : 0);

  const isLiteralInstantKill = confidence >= 0.7
    && coverage >= 0.8
    && top1SubstantiveScore >= 40;

  if (isLiteralInstantKill) {
    log(`[PreSearchEngine] Literal instant kill: confidence=${confidence.toFixed(2)}, coverage=${coverage.toFixed(2)}`);
    return {
      finalHits: bm25Results,
      validatedScopeNodeIds,
      nodeFileMap,
      bm25Confidence: confidence,
      queryVector: null,
      earlyStopCandidate: true,
    };
  }

  // 6. Medium confidence → upgrade to vector search
  let finalHits = bm25Results;
  let queryVector: number[] | null = null;

  if (confidence >= 0.25) {
    log(`[PreSearchEngine] Medium confidence (${confidence.toFixed(2)}), upgrading to vector search`);
    const embeddingRole = settings ? resolveRoleConfig('embedding', settings as any) : null;
    const rerankerRole = settings ? resolveRoleConfig('reranker', settings as any) : null;
    const rerankerWeight = (settings as any)?.rerankerWeight ?? 0.7;

    if (embeddingRole) {
      try {
        const embOpts = toEmbeddingOptions(embeddingRole);
        const { getOrGenerateEmbedding } = await import('../../../pageindex/vault/embedding-cache.js');
        queryVector = await getOrGenerateEmbedding(queryText || '', embOpts);
      } catch (embErr) {
        log('[PreSearchEngine] Vector generation failed:', embErr);
      }
    }

    const hybridOpts: BookSearchOptionsV2 = {
      ...searchOpts,
      embedding: embeddingRole ? toEmbeddingOptions(embeddingRole) : undefined,
      reranker: rerankerRole ? toRerankerOptions(rerankerRole, rerankerWeight) : undefined,
    };
    if (queryVector) {
      hybridOpts.precomputedEmbedding = queryVector;
    }

    const hybridResults = await keywordSearchFusion(keywords.slice(0, 5), hybridOpts, { currentNodeId });
    if (hybridResults.length >= 2) {
      finalHits = hybridResults;
    }
  }

  return {
    finalHits,
    validatedScopeNodeIds,
    nodeFileMap,
    bm25Confidence: confidence,
    queryVector,
    earlyStopCandidate: false,
  };
}
