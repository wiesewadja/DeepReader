/**
 * S1: Inspectional Reading Node — Native LangChain implementation
 *
 * Loads tree.json, selects scope chapters, generates TOC summary.
 * Uses ChatOpenAI with structured output instead of old LLMClient.
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import { loadTreeJson } from '../utils/tree-loader';
import {
  formatTreeStructure,
  buildInspectionalSystemPrompt,
  buildInspectionalUserMessage,
  InspectionalOutputSchema,
} from '../prompts/inspectional-prompt';
import { agentLog as log } from '../../../utils/logger.js';

/**
 * S1 Inspectional node: reads tree.json, selects scope, generates TOC summary.
 *
 * Flow:
 * 1. Load tree.json from .pageindex/{bookId}/
 * 2. Format tree structure for prompt
 * 3. Call fast model with structured output for reliable JSON parsing
 * 4. Return scope/toc/betterQuestion/structuralAnalysis
 */
export async function inspectionalNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const fastModel = config.configurable?.fastModel;
  const toolContext = config.configurable?.toolContext;

  // Default return when config is incomplete (e.g. testing)
  if (!fastModel || !toolContext) {
    return {
      scopeNodeIds: [],
      tocSummary: '',
      betterQuestion: '',
      structuralAnalysis: '',
    };
  }

  // Step 1: Load tree.json
  const outlineNodes = await loadTreeJson(
    toolContext.app,
    toolContext.indexId || state.bookId,
    state.pdfName || toolContext.pdfName,
  );

  if (outlineNodes.length === 0) {
    return {
      scopeNodeIds: [],
      tocSummary: '无法获取目录结构，使用全局搜索。',
      betterQuestion: state.rewrittenQuery,
      structuralAnalysis: '',
    };
  }

  // Step 2: Format tree structure
  const treeText = formatTreeStructure(outlineNodes);

  // Step 3: Build prompt
  const docDescription = config.configurable?.sharedContext?.docDescription;
  const systemPrompt = buildInspectionalSystemPrompt(
    treeText,
    state.pdfName || '',
    state.depth,
    docDescription,
  );
  const userMessage = buildInspectionalUserMessage(
    state.rewrittenQuery,
    state.depth,
  );

  // Step 4: Call fast model with structured output
  try {
    const router = fastModel.withStructuredOutput(InspectionalOutputSchema);
    const result = await router.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage),
    ], config);

    return {
      scopeNodeIds: result.scopeNodeIds ?? [],
      tocSummary: result.tocSummary ?? '',
      betterQuestion: result.better_question ?? state.rewrittenQuery,
      structuralAnalysis: result.structural_analysis ?? '',
    };
  } catch (err) {
    // Graceful degradation on LLM error
    log('[S1 Inspectional] LLM 调用失败，降级到全局搜索:', err instanceof Error ? err.message : String(err));
    return {
      scopeNodeIds: [],
      tocSummary: '无法解析目录范围，使用全局搜索。',
      betterQuestion: state.rewrittenQuery,
      structuralAnalysis: '',
    };
  }
}
