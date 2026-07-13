/**
 * S2: Analytical Reading Node — ReAct/PlanExecute loop
 *
 * Receives pre-search data from S2-Pre node via graph state.
 * Runs PlanExecute with scoped tools for deep analysis.
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { interrupt } from '@langchain/langgraph';
import { agentLog as log } from '../../../utils/logger.js';
import { createLangChainTools } from '../../tools/index.js';
import { NODE_TOOL_WHITELIST } from '../../tools/tool-permissions.js';
import type { AnalyticalInput } from '../node-io.js';
import { buildFullAnalyticalContext } from '../../prompts/utils/index.js';
import type { CognitiveEngineState } from '../state';
import { runPlanExecute } from '../subgraphs/plan-execute.js';
import { resolveCurrentChapterName } from '../utils/engine-helpers.js';
import { getGraphConfigurable } from '../configurable.js';

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
 * S2 Analytical node: ReAct/PlanExecute loop for deep analysis.
 *
 * Reads validated scope and pre-search data from state (set by S2-Pre).
 */
export async function analyticalNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const {
    validatedScopeNodeIds,
    preSearchBlock,
    pdfName: statePdfName,
    tocSummary: stateTocSummary,
    rewrittenQuery: stateQuery,
    betterQuestion: stateBetterQuestion,
    scopeNodeIds: rawScopeNodeIds,
    nodeFileMap: stateNodeFileMap,
    prevSearchedBlockIds: statePrevBlockIds,
  }: AnalyticalInput = state;
  const cfg = getGraphConfigurable(config);
  const ctx = cfg.sharedContext;
  const mainModel = cfg.mainModel;
  const callbacks = cfg.callbacks;
  const toolContext = ctx.toolContext;

  if (!mainModel || !toolContext) {
    return { analysisResult: '', toolResultsSnapshot: [] };
  }

  // Use validated scope from pre-search node (fallback to raw if pre-search was skipped).
  // L5 的全量复核 hits 已由 S2-Pre 合并进 validatedScopeNodeIds（scope 单一收尾点），
  // S2 不再单独处理 L5 状态。
  const scopeNodeIds = validatedScopeNodeIds.length > 0 ? validatedScopeNodeIds : rawScopeNodeIds;
  const currentNodeId = toolContext.book.currentNodeId;
  const currentChapterName = resolveCurrentChapterName(currentNodeId, toolContext.book.markdownFiles);
  const markdownFiles = toolContext?.book.markdownFiles ?? {};
  const tocSummary = stateTocSummary;
  const nodeFileMap = stateNodeFileMap ?? {};

  // Build prompt context
  const { fullSystemPrompt, userMessage: rawUserMessage } = buildFullAnalyticalContext({
    scopeNodeIds,
    tocSummary,
    currentNodeId,
    currentChapterName,
    userProfileSummary: ctx.userProfileSummary,
    markdownFiles,
    nodeFileMap,
    standaloneQuery: stateQuery || ctx.rawUserQuery || '',
    betterQuestion: stateBetterQuestion,
    recentHistorySummaries: ctx.recentHistorySummaries,
    prevSearchedBlockIds: statePrevBlockIds.length > 0 ? statePrevBlockIds : ctx.initialPrevSearchedBlockIds,
  });

  // Inject pre-search results from S2-Pre node
  const finalUserMessage = preSearchBlock
    ? `${preSearchBlock}\n\n${rawUserMessage || ''}`
    : rawUserMessage || '';

  // Create scoped tools (with cached queryVector for reuse)
  const updatedToolContext = { ...toolContext, queryVector: state.queryVector };
  const allTools = createLangChainTools(updatedToolContext);
  const s2Tools = allTools.filter(t => NODE_TOOL_WHITELIST.analytical.includes(t.name));

  const loopMessages = [
    new SystemMessage(fullSystemPrompt),
    new HumanMessage(finalUserMessage ?? ''),
  ];
  const loopConfig = {
    tools: s2Tools,
    model: mainModel,
    maxIterations: 6,
    maxToolCalls: 3,
    forcedConclusionContext: {
      pdfName: statePdfName || ctx.toolContext?.book.pdfName,
      scopeNodeIds,
    },
    toolInterceptor: createScopeInterceptor(scopeNodeIds),
    onProgress: callbacks?.onProgress,
  };

  log(`[S2 Analytical] 开始 PlanExecute, scope=${scopeNodeIds.length} nodes, preSearch=${!!preSearchBlock}`);
  const result = await runPlanExecute(loopMessages, loopConfig, config);

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

  // HITL interrupt
  const enableHumanReview = cfg.enableHumanReview;
  if (enableHumanReview) {
    const resumeValue = interrupt({
      nodeId: 'analytical',
      question: 'S2 分析完成，是否满意当前分析结果？',
      content: result.content,
    }) as { approved: boolean; feedback: string } | undefined;

    if (resumeValue?.approved === false && resumeValue.feedback) {
      const refinedResult = await runPlanExecute(
        [
          new SystemMessage(fullSystemPrompt),
          new HumanMessage(finalUserMessage ?? ''),
          new HumanMessage(`用户反馈：${resumeValue.feedback}\n\n请根据反馈补充或修正分析。`),
        ],
        {
          tools: s2Tools,
          model: mainModel,
          maxIterations: 4,
          maxToolCalls: 3,
          forcedConclusionContext: {
            pdfName: statePdfName || ctx.toolContext?.book.pdfName,
            scopeNodeIds,
          },
          toolInterceptor: createScopeInterceptor(scopeNodeIds),
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
