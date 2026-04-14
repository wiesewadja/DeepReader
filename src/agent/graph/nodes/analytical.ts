/**
 * S2: Analytical Reading Node — LangGraph node using ReAct subgraph
 *
 * Replaces the old AnalyticalState.execute() with runReactLoop().
 * Uses the ReAct subgraph for tool-augmented deep analysis.
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import type { SharedContext } from '../../cognitive-engine/types';
import { runReactLoop } from '../subgraphs/react-loop.js';
import {
  buildAnalyticalSystemPrompt,
  buildScopedChaptersBlock,
  buildAnalyticalUserMessage,
} from '../../cognitive-engine/prompts/analytical-prompt.js';
import { InspectionalState } from '../../cognitive-engine/states/inspectional.js';
import { createLangChainTools } from '../../tools/index.js';
import { interrupt } from '@langchain/langgraph';

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
 * 1. Cumulative guarantee: run S1 if scope not set
 * 2. Build system prompt + user message
 * 3. Run ReAct subgraph with scoped tools
 * 4. Store results in graph state
 */
export async function analyticalNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const ctx = config.configurable?.sharedContext as SharedContext | undefined;
  const mainModel = config.configurable?.mainModel;
  const toolContext = config.configurable?.toolContext;

  if (!ctx || !mainModel || !toolContext) {
    console.warn('[S2 Analytical] Missing required config, returning empty result.');
    return {
      analysisResult: '',
      toolResultsSnapshot: [],
    };
  }

  // Step 1: Cumulative guarantee — run S1 if scope not yet determined
  let scopeNodeIds = state.scopeNodeIds;
  let s1Ran = false;
  if (!scopeNodeIds || scopeNodeIds.length === 0) {
    const inspectional = new InspectionalState();
    await inspectional.execute(ctx);
    scopeNodeIds = ctx.scopeNodeIds ?? [];
    s1Ran = true;
  }

  // Step 2: Build system prompt and user message
  const systemPrompt = buildAnalyticalSystemPrompt({
    scopeNodeIds,
    tocSummary: state.tocSummary || ctx.tocSummary,
  });

  const scopedChapters = buildScopedChaptersBlock(
    scopeNodeIds,
    ctx.markdownFiles ?? {},
  );
  const fullSystemPrompt = scopedChapters
    ? `${systemPrompt}\n${scopedChapters}`
    : systemPrompt;

  const userMessage = buildAnalyticalUserMessage(
    state.rewrittenQuery || ctx.rawUserQuery,
    state.betterQuestion || ctx.betterQuestion,
    ctx.recentHistorySummaries,
    ctx.prevSearchedBlockIds,
  );

  // Step 3: Create LangChain tools (only search_book + read_book_section for S2)
  const allTools = createLangChainTools(toolContext);
  const s2ToolNames = ['search_book', 'read_book_section'];
  const s2Tools = allTools.filter(t => s2ToolNames.includes(t.name));

  // Step 4: Run ReAct subgraph
  const result = await runReactLoop(
    [
      new SystemMessage(fullSystemPrompt),
      new HumanMessage(userMessage),
    ],
    {
      tools: s2Tools,
      model: mainModel,
      maxIterations: 8,
      maxToolCalls: 5,
      forcedConclusionContext: {
        pdfName: state.pdfName || ctx.pdfName,
        scopeNodeIds,
      },
      toolInterceptor: createScopeInterceptor(scopeNodeIds),
    },
    config,
  );

  // Step 5: Store results
  const stateUpdate: Partial<CognitiveEngineState> = {
    analysisResult: result.content,
    toolResultsSnapshot: result.toolResults.map(r => ({
      toolName: r.toolName,
      args: r.args,
      result: r.result,
      originalResultLength: r.originalResultLength,
    })),
    scopeNodeIds,
  };

  // Propagate S1 results to graph state if S1 was triggered
  if (s1Ran) {
    stateUpdate.tocSummary = ctx.tocSummary ?? '';
    stateUpdate.betterQuestion = ctx.betterQuestion ?? '';
    stateUpdate.structuralAnalysis = ctx.structuralAnalysis ?? '';
  }

  // Step 6: HITL interrupt (if enabled)
  const enableHumanReview = config.configurable?.enableHumanReview as boolean | undefined;
  if (enableHumanReview) {
    const resumeValue = interrupt({
      nodeId: 'analytical',
      question: 'S2 分析完成，是否满意当前分析结果？',
      content: result.content,
    }) as { approved: boolean; feedback: string } | undefined;

    if (resumeValue?.approved === false && resumeValue.feedback) {
      // 用户不满意，用 feedback 重新运行一次 ReAct 循环
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
            pdfName: state.pdfName || ctx.pdfName,
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
