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
import { resolveCurrentChapterName } from '../utils/engine-helpers.js';
import { PAGEINDEX_DIR } from '../../../pageindex/paths.js';

/** 空的 pre-search 返回结构，多处复用 */
function emptyPreSearchResult(validatedScopeNodeIds: string[] = []): Partial<CognitiveEngineState> {
  return {
    validatedScopeNodeIds,
    preSearchBlock: '',
    earlyStopContent: '',
    toolResultsSnapshot: [],
  };
}

/**
 * Validate scopeNodeIds against tree.json nodeFileMap.
 */
async function validateScopeNodeIds(
  app: import('obsidian').App,
  bookId: string,
  pdfName: string,
  scopeNodeIds: string[]
): Promise<string[]> {
  if (scopeNodeIds.length === 0 || !bookId) return [];

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

    return validIds;
  } catch (err) {
    log('[S2-Pre] Scope validation failed, using all IDs:', err);
    return scopeNodeIds;
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
  const validatedScopeNodeIds = await validateScopeNodeIds(
    toolContext.vault.app,
    toolContext.book.indexId || '',
    statePdfName || ctx?.toolContext?.book.pdfName || '',
    rawScopeNodeIds,
  );

  const tocSummary = stateTocSummary || ctx?.tocSummary;
  const currentNodeId = toolContext.book.currentNodeId;
  const currentChapterName = resolveCurrentChapterName(currentNodeId, toolContext.book.markdownFiles);
  const markdownFiles = ctx?.toolContext?.book.markdownFiles ?? {};

  // 2. Build prompt context (shared with analytical node)
  const { fullSystemPrompt } = buildFullAnalyticalContext({
    scopeNodeIds: validatedScopeNodeIds,
    tocSummary,
    currentNodeId,
    currentChapterName,
    userProfileSummary: ctx?.userProfileSummary,
    markdownFiles,
    standaloneQuery: stateQuery || ctx?.rawUserQuery || '',
    betterQuestion: stateBetterQuestion || ctx?.betterQuestion,
    recentHistorySummaries: ctx?.recentHistorySummaries,
    prevSearchedBlockIds: ctx?.prevSearchedBlockIds,
    skipUserMessage: true,
  });

  // 3. Pre-search RRF with S1's suggested_keywords
  if (!stateKeywords || stateKeywords.length === 0 || !toolContext.vault.app) {
    return emptyPreSearchResult(validatedScopeNodeIds);
  }

  const pluginSettings = toolContext.vault.plugin?.settings;
  const earlyStopThreshold = getEarlyStopThreshold(pluginSettings);

  try {
    const embeddingRole = pluginSettings ? resolveRoleConfig('embedding', pluginSettings) : null;
    const rerankerRole = pluginSettings ? resolveRoleConfig('reranker', pluginSettings) : null;
    const rerankerWeight = pluginSettings?.rerankerWeight ?? 0.7;
    const baseSearchOpts: Omit<BookSearchOptionsV2, 'query'> = {
      filePath: '',
      topK: 10,
      embedding: embeddingRole ? toEmbeddingOptions(embeddingRole) : undefined,
      reranker: rerankerRole ? toRerankerOptions(rerankerRole, rerankerWeight) : undefined,
      scopeNodeIds: validatedScopeNodeIds.length > 0 ? validatedScopeNodeIds : undefined,
      app: toolContext.vault.app,
    };
    if (toolContext.book.indexId) {
      baseSearchOpts.bookId = toolContext.book.indexId;
    }

    const limitedKeywords = stateKeywords.slice(0, 8);
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
      return emptyPreSearchResult(validatedScopeNodeIds);
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

    // 4. Early stop check
    const avgScore = hits.reduce((s, h) => s + h.score, 0) / hits.length;

    if (avgScore >= earlyStopThreshold && hits.length >= 2) {
      log(`[S2-Pre] 早停: avg=${avgScore.toFixed(2)} >= ${earlyStopThreshold}, 跳过 ReAct`);

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
        validatedScopeNodeIds,
        earlyStopContent: 'done',
        analysisResult: verifyResult.content,
        toolResultsSnapshot: preSearchRecords,
      };
    }

    // 5. Normal path: inject compact pre-search results
    const blockLines = formatBlockLines(hits);

    const preSearchBlock = `<pre_search_results>
基于目录分析自动检索到的相关段落（共 ${preResults.length} 条，取前 ${hits.length} 条），请优先利用。不够可用 search_book 补充。

${blockLines.join('\n\n')}
</pre_search_results>`;

    log(`[S2-Pre] 预检索注入: ${preResults.length} 条结果, avg=${avgScore.toFixed(2)}, ${stateKeywords.length} 个关键词`);

    return {
      validatedScopeNodeIds,
      preSearchBlock,
      earlyStopContent: '',
      toolResultsSnapshot: [],
    };
  } catch (err) {
    log('[S2-Pre] 预检索失败 (非致命):', err instanceof Error ? err.message : String(err));
    return emptyPreSearchResult(validatedScopeNodeIds);
  }
}
