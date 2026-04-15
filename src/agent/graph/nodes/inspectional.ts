/**
 * S1: Inspectional Reading Node — Native LangChain implementation
 *
 * Loads tree.json, selects scope chapters, generates TOC summary.
 * Uses ChatOpenAI and parses JSON from text output
 * (avoids withStructuredOutput which requires json_schema support).
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import { loadTreeJson } from '../utils/tree-loader';
import {
  formatTreeStructure,
  buildInspectionalSystemPrompt,
  buildInspectionalUserMessage,
} from '../prompts/inspectional-prompt';
import { agentLog as log } from '../../../utils/logger.js';

/**
 * 从 LLM 文本输出中提取 JSON。
 */
function extractJSON(text: string): Record<string, any> | null {
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1]); } catch { /* fall through */ }
  }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch { /* fall through */ }
  }
  return null;
}

/**
 * S1 Inspectional node: reads tree.json, selects scope, generates TOC summary.
 *
 * Flow:
 * 1. Load tree.json from .pageindex/{bookId}/
 * 2. Format tree structure for prompt
 * 3. Call fast model and parse JSON from text output
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

  // Step 4: Call fast model and parse JSON from text
  try {
    const response = await fastModel.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage),
    ], config);

    const text = typeof response.content === 'string' ? response.content : '';
    const parsed = extractJSON(text);

    if (!parsed) {
      log('[S1 Inspectional] 无法解析 JSON，降级到全局搜索。原始输出:', text.slice(0, 200));
      return {
        scopeNodeIds: [],
        tocSummary: '无法解析目录范围，使用全局搜索。',
        betterQuestion: state.rewrittenQuery,
        structuralAnalysis: '',
      };
    }

    return {
      scopeNodeIds: parsed.scopeNodeIds ?? [],
      tocSummary: parsed.tocSummary ?? '',
      betterQuestion: parsed.better_question ?? state.rewrittenQuery,
      structuralAnalysis: parsed.structural_analysis ?? '',
      suggestedKeywords: parsed.suggested_keywords ?? [],
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
