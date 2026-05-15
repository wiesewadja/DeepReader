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
import { searchBookV2 } from '../../../pageindex/book-search-v2.js';
import type { BookSearchResultV2, BookSearchOptionsV2 } from '../../../pageindex/book-types.js';
import { agentLog as log } from '../../../utils/logger.js';
import { resolveRoleConfig } from '../../../config/providers.js';
import { toEmbeddingOptions } from '../../../config/role-adapters.js';
import { verifyAndCleanContent } from '../utils/self-verification.js';
import { resolveCurrentChapterName } from '../utils/engine-helpers.js';

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
    const treePath = `.pageindex/${bookId}/tree.json`;
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
    return {
      validatedScopeNodeIds: rawScopeNodeIds,
      preSearchBlock: '',
      earlyStopContent: '',
      toolResultsSnapshot: [],
    };
  }

  // 1. Validate scope
  const validatedScopeNodeIds = await validateScopeNodeIds(
    toolContext.app,
    toolContext.indexId || '',
    statePdfName || ctx?.pdfName || '',
    rawScopeNodeIds,
  );

  const tocSummary = stateTocSummary || ctx?.tocSummary;
  const currentNodeId = toolContext.currentNodeId;
  const currentChapterName = resolveCurrentChapterName(currentNodeId, toolContext.markdownFiles);
  const markdownFiles = ctx?.markdownFiles ?? {};

  // 2. Build prompt context (shared with analytical node)
  const { fullSystemPrompt, userMessage } = buildFullAnalyticalContext({
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
  });

  // 3. Pre-search RRF with S1's suggested_keywords
  if (!stateKeywords || stateKeywords.length === 0 || !toolContext.app) {
    return {
      validatedScopeNodeIds,
      preSearchBlock: '',
      earlyStopContent: '',
      toolResultsSnapshot: [],
    };
  }

  const pluginSettings = toolContext.plugin?.settings;
  const earlyStopThreshold = getEarlyStopThreshold(pluginSettings);

  try {
    const vaultPath = (toolContext.app.vault.adapter as { basePath: string }).basePath;
    const embeddingRole = pluginSettings ? resolveRoleConfig('embedding', pluginSettings) : null;
    const baseSearchOpts: Omit<BookSearchOptionsV2, 'query'> = {
      filePath: '',
      topK: 10,
      embedding: embeddingRole ? toEmbeddingOptions(embeddingRole) : undefined,
      scopeNodeIds: validatedScopeNodeIds.length > 0 ? validatedScopeNodeIds : undefined,
    };
    if (toolContext.indexId && vaultPath) {
      baseSearchOpts.bookId = toolContext.indexId;
      baseSearchOpts.vaultPath = vaultPath;
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
      return {
        validatedScopeNodeIds,
        preSearchBlock: '',
        earlyStopContent: '',
        toolResultsSnapshot: [],
      };
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

      const blockLines = hits.flatMap(h =>
        h.matched_blocks.map(b =>
          `【${h.title}】(file_name: "${h.file_name}", block_id: ${b.block_id})\n${b.content}`
        )
      );

      const pdfName = statePdfName || ctx?.pdfName || '';
      const directPrompt = `${fullSystemPrompt}\n\n基于以下检索结果回答用户问题。你必须从检索结果中引用原文，并使用 wiki 链接标注来源。即使信息不完整，也要基于已有内容给出尽可能充分的回答。

<pre_search_results>
${blockLines.join('\n\n')}
</pre_search_results>

用户问题：${stateBetterQuestion || stateQuery || ctx?.rawUserQuery || ''}

输出格式要求：
- 引用来源用 [[${pdfName}/file_name#^block_id|短别名]] 格式，别名 2-6 字核心词
- file_name 和 block_id 必须来自上方检索结果中标注的值，禁止编造
- 链接必须嵌入句子内部替代关键词，不要孤立在句尾
- 必须在回答中包含至少一个 wiki 链接
- 如果检索结果部分覆盖了问题，先基于已有内容回答，再简要说明哪些方面需要更多探索`;

      const directResponse = await mainModel.invoke([
        new SystemMessage(directPrompt),
        new HumanMessage(stateBetterQuestion || stateQuery || ''),
      ], config);

      const directContent = typeof directResponse.content === 'string'
        ? directResponse.content : JSON.stringify(directResponse.content);

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
    const blockLines = hits.flatMap(h =>
      h.matched_blocks.map(b =>
        `【${h.title}】(file_name: "${h.file_name}", block_id: ${b.block_id})\n${b.content}`
      )
    );

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
    return {
      validatedScopeNodeIds,
      preSearchBlock: '',
      earlyStopContent: '',
      toolResultsSnapshot: [],
    };
  }
}
