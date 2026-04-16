/**
 * S2: Analytical Reading Node — LangGraph node using ReAct subgraph
 *
 * Optimized retrieval flow:
 * 1. Pre-search using S1's suggested_keywords (Path B)
 * 2. Inject pre-search results into ReAct initial context
 * 3. Run ReAct loop with reduced maxToolCalls (3 instead of 5)
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import { runReactLoop } from '../subgraphs/react-loop.js';
import {
  buildAnalyticalSystemPrompt,
  buildScopedChaptersBlock,
  buildAnalyticalUserMessage,
} from '../prompts/analytical-prompt.js';
import { createLangChainTools } from '../../tools/index.js';
import { searchBookV2 } from '../../../pageindex/book-search-v2.js';
import { interrupt } from '@langchain/langgraph';
import { agentLog as log } from '../../../utils/logger.js';

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

  if (!mainModel || !toolContext) {
    console.warn('[S2 Analytical] Missing required config, returning empty result.');
    return {
      analysisResult: '',
      toolResultsSnapshot: [],
    };
  }

  // Use scope from graph state (set by S1 or empty for global search)
  const scopeNodeIds = state.scopeNodeIds ?? [];

  // Build system prompt and user message
  const tocSummary = state.tocSummary || ctx?.tocSummary;
  const systemPrompt = buildAnalyticalSystemPrompt({
    scopeNodeIds,
    tocSummary,
  });

  const markdownFiles = ctx?.markdownFiles ?? {};
  const scopedChapters = buildScopedChaptersBlock(scopeNodeIds, markdownFiles);
  const fullSystemPrompt = scopedChapters
    ? `${systemPrompt}\n${scopedChapters}`
    : systemPrompt;

  const userMessage = buildAnalyticalUserMessage(
    state.rewrittenQuery || ctx?.rawUserQuery || '',
    state.betterQuestion || ctx?.betterQuestion,
    ctx?.recentHistorySummaries,
    ctx?.prevSearchedBlockIds,
  );

  // === Path B: Pre-search with S1's suggested_keywords ===
  let preSearchBlock = '';
  const suggestedKeywords = state.suggestedKeywords;
  if (suggestedKeywords && suggestedKeywords.length > 0 && toolContext.app) {
    try {
      const vaultPath = (toolContext.app.vault.adapter as any).basePath;
      const searchOpts: any = {
        filePath: '',
        query: suggestedKeywords.join(' '),
        topK: 10,
        embedding: toolContext.plugin?.settings?.embedding,
        scopeNodeIds: scopeNodeIds.length > 0 ? scopeNodeIds : undefined,
      };
      if (toolContext.indexId && vaultPath) {
        searchOpts.bookId = toolContext.indexId;
        searchOpts.vaultPath = vaultPath;
      }

      const preResults = await searchBookV2(searchOpts);

      // Quality threshold: only inject if we got meaningful results
      if (preResults.length >= 2) {
        const hits = preResults.slice(0, 5).map(r => ({
          node_id: r.nodeId,
          title: r.title,
          file_name: r.fileName,
          matched_blocks: r.matchedBlocks.map(b => ({
            block_id: b.blockId.replace(/^\^/, ''),
            content: b.content,
          })),
          score: Math.round(r.score * 100) / 100,
        }));

        const blockLines = hits.flatMap(h =>
          h.matched_blocks.map(b =>
            `【${h.title}】${b.content.slice(0, 300)}`
          )
        );

        preSearchBlock = `<pre_search_results>
以下是基于目录分析自动检索到的相关段落（共 ${preResults.length} 条），请优先利用这些内容。如果不够详细，可使用 search_book 自行补充搜索，或用 read_book_section 读取完整章节。

${blockLines.join('\n\n')}
</pre_search_results>`;

        log(`[S2 Analytical] 预检索注入: ${preResults.length} 条结果, ${suggestedKeywords.length} 个关键词`);
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

  // Run ReAct subgraph (with pre-search context if available)
  const result = await runReactLoop(
    [
      new SystemMessage(fullSystemPrompt),
      new HumanMessage(finalUserMessage),
    ],
    {
      tools: s2Tools,
      model: mainModel,
      maxIterations: 6,
      maxToolCalls: 3,
      forcedConclusionContext: {
        pdfName: state.pdfName || ctx?.pdfName,
        scopeNodeIds,
      },
      toolInterceptor: createScopeInterceptor(scopeNodeIds),
    },
    config,
  );

  // Store results
  const stateUpdate: Partial<CognitiveEngineState> = {
    analysisResult: result.content,
    toolResultsSnapshot: result.toolResults.map(r => ({
      toolName: r.toolName,
      args: r.args,
      result: r.result,
      originalResultLength: r.originalResultLength,
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
      // User rejected: re-run with feedback
      const refinedResult = await runReactLoop(
        [
          new SystemMessage(fullSystemPrompt),
          new HumanMessage(userMessage),
          new HumanMessage(`用户反馈：${resumeValue.feedback}\n\n请根据反馈补充或修正分析。`),
        ],
        {
          tools: s2Tools,
          model: mainModel,
          maxIterations: 4,
          maxToolCalls: 3,
          forcedConclusionContext: {
            pdfName: state.pdfName || ctx?.pdfName,
            scopeNodeIds,
          },
          toolInterceptor: createScopeInterceptor(scopeNodeIds),
        },
        config,
      );

      stateUpdate.analysisResult = refinedResult.content;
      stateUpdate.toolResultsSnapshot = refinedResult.toolResults.map(r => ({
        toolName: r.toolName,
        args: r.args,
        result: r.result,
        originalResultLength: r.originalResultLength,
      }));
    }
  }

  return stateUpdate;
}
