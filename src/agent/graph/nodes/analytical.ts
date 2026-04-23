/**
 * S2: Analytical Reading Node — LangGraph node using ReAct subgraph
 *
 * Optimized retrieval flow:
 * 1. Pre-search using S1's suggested_keywords (Path B)
 * 2. Inject pre-search results into ReAct initial context
 * 3. Run ReAct loop with reduced maxToolCalls (3 instead of 5)
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { RunnableLambda } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import { runReactLoop, runPlanExecute } from '../subgraphs/react-loop.js';
import {
  buildAnalyticalSystemPrompt,
  buildScopedChaptersBlock,
  buildAnalyticalUserMessage,
} from '../prompts/analytical-prompt.js';
import { createLangChainTools } from '../../tools/index.js';
import { searchBookV2 } from '../../../pageindex/book-search-v2.js';
import type { BookSearchResultV2, BookSearchOptionsV2 } from '../../../pageindex/book-types.js';
import { interrupt } from '@langchain/langgraph';
import { agentLog as log } from '../../../utils/logger.js';
import { loadTreeJson } from '../utils/tree-loader.js';
import { resolveRoleConfig } from '../../../config/providers.js';
import { toEmbeddingOptions } from '../../../config/role-adapters.js';
import { verifyAndCleanContent } from '../utils/self-verification.js';

/**
 * Validate scopeNodeIds against tree.json nodeFileMap.
 * Returns only IDs that exist in the tree structure.
 */
async function validateScopeNodeIds(
  app: any,
  bookId: string,
  pdfName: string,
  scopeNodeIds: string[]
): Promise<string[]> {
  if (scopeNodeIds.length === 0) return [];

  try {
    const vaultPath = app.vault.adapter.getBasePath?.() ?? '';
    const treePath = `.pageindex/${bookId}/tree.json`;
    const treeContent = await app.vault.adapter.read(treePath);
    const treeData = JSON.parse(treeContent);

    const validIds: string[] = [];
    const allNodeIds = new Set<string>();
    collectAllNodeIds(treeData.structure || [], allNodeIds);

    for (const id of scopeNodeIds) {
      if (allNodeIds.has(id)) {
        validIds.push(id);
      }
    }

    if (validIds.length < scopeNodeIds.length) {
      log(`[S2 Analytical] Scope validation: ${validIds.length}/${scopeNodeIds.length} IDs valid`);
    }

    return validIds;
  } catch (err) {
    log('[S2 Analytical] Scope validation failed, using all IDs:', err);
    return scopeNodeIds;
  }
}

function collectAllNodeIds(nodes: any[], idSet: Set<string>): void {
  for (const node of nodes) {
    if (node.nodeId) idSet.add(node.nodeId);
    if (node.nodes) collectAllNodeIds(node.nodes, idSet);
  }
}

/**
 * Build the scope interceptor that injects scope_node_ids into search_book calls.
 */
function createScopeInterceptor(scopeNodeIds: string[]) {
  return (toolName: string, args: Record<string, unknown>): Record<string, unknown> => {
    if (toolName === 'search_book' && scopeNodeIds.length > 0) {
      return { ...args, scope_node_ids: scopeNodeIds };
    }
    return args;
  };
}

/**
 * S2 Analytical node: deep analysis with tool-augmented ReAct loop.
 *
 * Flow:
 * 1. Build system prompt + user message (scope from graph state)
 * 2. Run ReAct subgraph with scoped tools
 * 3. Store results in graph state
 * 4. Optional HITL interrupt
 */
export async function analyticalNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const ctx = config.configurable?.sharedContext;
  const mainModel = config.configurable?.mainModel;
  const toolContext = config.configurable?.toolContext;
  const callbacks = config.configurable?.callbacks as {
    onContent?: (content: string) => void;
    onProgress?: (msg: string) => void;
  } | undefined;

  if (!mainModel || !toolContext) {
    console.warn('[S2 Analytical] Missing required config, returning empty result.');
    return {
      analysisResult: '',
      toolResultsSnapshot: [],
    };
  }

  // Use scope from graph state (set by S1 or empty for global search)
  const rawScopeNodeIds = state.scopeNodeIds ?? [];

  // Validate scopeNodeIds against tree structure
  const validatedScopeNodeIds = await validateScopeNodeIds(
    toolContext.app,
    toolContext.indexId || '',
    state.pdfName || ctx?.pdfName || '',
    rawScopeNodeIds
  );

  // Build system prompt and user message
  const tocSummary = state.tocSummary || ctx?.tocSummary;
  const currentNodeId = toolContext.currentNodeId;
  
  // 获取当前章节名称（用于提示词）
  let currentChapterName: string | undefined;
  if (currentNodeId && toolContext.markdownFiles) {
    for (const [path, _] of Object.entries(toolContext.markdownFiles)) {
      const fileName = path.split('/').pop() ?? '';
      if (fileName.startsWith(currentNodeId.replace(/^0+/, ''))) {
        currentChapterName = fileName.replace(/\.md$/, '');
        break;
      }
    }
  }

  const systemPrompt = buildAnalyticalSystemPrompt({
    scopeNodeIds: validatedScopeNodeIds,
    tocSummary,
    currentNodeId,
    currentChapterName,
    userProfile: ctx?.userProfile,
  });

  const markdownFiles = ctx?.markdownFiles ?? {};
  const scopedChapters = buildScopedChaptersBlock(validatedScopeNodeIds, markdownFiles);
  const fullSystemPrompt = scopedChapters
    ? `${systemPrompt}\n${scopedChapters}`
    : systemPrompt;

  const userMessage = buildAnalyticalUserMessage(
    state.rewrittenQuery || ctx?.rawUserQuery || '',
    state.betterQuestion || ctx?.betterQuestion,
    ctx?.recentHistorySummaries,
    ctx?.prevSearchedBlockIds,
  );

  // === Path B: Pre-search with S1's suggested_keywords (RRF multi-query) ===
  let preSearchBlock = '';
  const suggestedKeywords = state.suggestedKeywords;
  if (suggestedKeywords && suggestedKeywords.length > 0 && toolContext.app) {
    try {
      const vaultPath = (toolContext.app.vault.adapter as any).basePath;
      const settings = toolContext.plugin?.settings;
      const embeddingRole = settings ? resolveRoleConfig('embedding', settings) : null;
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

      // RRF multi-query: 每个关键词独立检索后融合
      const limitedKeywords = suggestedKeywords.slice(0, 8);
      const currentNodeId = toolContext.currentNodeId;
      const preSearchRunnable = RunnableLambda.from(
        async () => {
          const subResults = await Promise.all(
            limitedKeywords.map(async (kw) => {
              try {
                return await searchBookV2({ ...baseSearchOpts, query: kw });
              } catch (err) {
                log(`[S2 Analytical] Keyword search failed for "${kw}":`, err instanceof Error ? err.message : String(err));
                return [];
              }
            })
          );

          // Merge: dedupe by nodeId, track hit count for multi-keyword boost
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

      // Quality threshold: only inject top-3 compact results
      if (Array.isArray(preResults) && preResults.length >= 2) {
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

        // === Early stop: if pre-search quality is high, skip ReAct entirely ===
        const avgScore = hits.reduce((s, h) => s + h.score, 0) / hits.length;
        const EARLY_STOP_THRESHOLD = 0.6;

        if (avgScore >= EARLY_STOP_THRESHOLD && hits.length >= 2) {
          log(`[S2 Analytical] 早停: pre-search 平均分=${avgScore.toFixed(2)} >= ${EARLY_STOP_THRESHOLD}，跳过 ReAct`);

          const blockLines = hits.flatMap(h =>
            h.matched_blocks.map(b =>
              `【${h.title}】(file_name: "${h.file_name}", block_id: ${b.block_id})\n${b.content}`
            )
          );

          const pdfName = state.pdfName || ctx?.pdfName || '';
          const directPrompt = `${fullSystemPrompt}\n\n基于以下检索结果直接回答用户问题，无需调用任何工具。如果信息不足，说明还需要查看哪些章节。

<pre_search_results>
${blockLines.join('\n\n')}
</pre_search_results>

用户问题：${state.betterQuestion || state.rewrittenQuery || ctx?.rawUserQuery || ''}

输出格式要求：
- 引用来源用 [[${pdfName}/file_name#^block_id|短别名]] 格式，别名 2-6 字核心词
- file_name 和 block_id 必须来自上方检索结果中标注的值，禁止编造
- 链接必须嵌入句子内部替代关键词，不要孤立在句尾
- 如果检索结果足够，给出完整分析
- 如果不够，简要说明并指出需要补充搜索的方向`;

          const directResponse = await mainModel.invoke([
            new SystemMessage(directPrompt),
            new HumanMessage(state.betterQuestion || state.rewrittenQuery || ''),
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
            analysisResult: verifyResult.content,
            toolResultsSnapshot: preSearchRecords,
          };
        }

        // Normal path: inject compact pre-search results with citation metadata
        const blockLines = hits.flatMap(h =>
          h.matched_blocks.map(b =>
            `【${h.title}】(file_name: "${h.file_name}", block_id: ${b.block_id})\n${b.content}`
          )
        );

        preSearchBlock = `<pre_search_results>
基于目录分析自动检索到的相关段落（共 ${preResults.length} 条，取前 ${hits.length} 条），请优先利用。不够可用 search_book 补充。

${blockLines.join('\n\n')}
</pre_search_results>`;

        log(`[S2 Analytical] 预检索注入: ${preResults.length} 条结果, avg=${avgScore.toFixed(2)}, ${suggestedKeywords.length} 个关键词`);
      } else {
        log(`[S2 Analytical] 预检索结果不足 (${preResults.length} 条), 跳过注入`);
      }
    } catch (err) {
      log('[S2 Analytical] 预检索失败 (非致命):', err instanceof Error ? err.message : String(err));
    }
  }

  // 构建最终 userMessage（合并预检索结果）
  const finalUserMessage = preSearchBlock
    ? `${preSearchBlock}\n\n${userMessage}`
    : userMessage;

  // Create LangChain tools (only search_book + read_book_section for S2)
  const allTools = createLangChainTools(toolContext);
  const s2ToolNames = ['search_book', 'read_book_section'];
  const s2Tools = allTools.filter(t => s2ToolNames.includes(t.name));

  const loopMessages = [
    new SystemMessage(fullSystemPrompt),
    new HumanMessage(finalUserMessage),
  ];
  const loopConfig = {
    tools: s2Tools,
    model: mainModel,
    maxIterations: 6,
    maxToolCalls: 3,
    forcedConclusionContext: {
      pdfName: state.pdfName || ctx?.pdfName,
      scopeNodeIds: validatedScopeNodeIds,
    },
    toolInterceptor: createScopeInterceptor(validatedScopeNodeIds),
    onProgress: callbacks?.onProgress,
  };

  // Plan-then-Execute (default): 2 LLM calls instead of iterative ReAct
  const result = await runPlanExecute(loopMessages, loopConfig, config);

  // Store results
  const stateUpdate: Partial<CognitiveEngineState> = {
    analysisResult: result.content,
    toolResultsSnapshot: result.toolResults.map(r => ({
      toolName: r.toolName,
      args: r.args,
      result: r.result,
      originalResultLength: r.originalResultLength,
      extractedBlockIds: r.extractedBlockIds,
    })),
  };

  // HITL interrupt (if enabled)
  const enableHumanReview = config.configurable?.enableHumanReview as boolean | undefined;
  if (enableHumanReview) {
    const resumeValue = interrupt({
      nodeId: 'analytical',
      question: 'S2 分析完成，是否满意当前分析结果？',
      content: result.content,
    }) as { approved: boolean; feedback: string } | undefined;

    if (resumeValue?.approved === false && resumeValue.feedback) {
      // User rejected: re-run with feedback using Plan-then-Execute
      const refinedResult = await runPlanExecute(
        [
          new SystemMessage(fullSystemPrompt),
          new HumanMessage(finalUserMessage),
          new HumanMessage(`用户反馈：${resumeValue.feedback}\n\n请根据反馈补充或修正分析。`),
        ],
        {
          tools: s2Tools,
          model: mainModel,
          maxIterations: 4,
          maxToolCalls: 3,
          forcedConclusionContext: {
            pdfName: state.pdfName || ctx?.pdfName,
            scopeNodeIds: validatedScopeNodeIds,
          },
          toolInterceptor: createScopeInterceptor(validatedScopeNodeIds),
          onProgress: callbacks?.onProgress,
        },
        config,
      );

      stateUpdate.analysisResult = refinedResult.content;
      stateUpdate.toolResultsSnapshot = refinedResult.toolResults.map(r => ({
        toolName: r.toolName,
        args: r.args,
        result: r.result,
        originalResultLength: r.originalResultLength,
        extractedBlockIds: r.extractedBlockIds,
      }));
    }
  }

  return stateUpdate;
}
