/**
 * S1: Inspectional Reading Node — Native LangChain implementation
 *
 * Loads tree.json, selects scope chapters, generates TOC summary.
 * Uses ChatOpenAI and parses JSON from text output
 * (avoids withStructuredOutput which requires json_schema support).
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { agentLog as log } from '../../../utils/logger.js';
import { TREE_STRUCTURE_MAX_TEXT_LENGTH, TREE_STRUCTURE_MAX_DEPTH } from '../../config/agent-constants.js';
import type { InspectionalInput } from '../node-io.js';
import { formatTreeStructure, buildInspectionalSystemPrompt, buildInspectionalUserMessage } from '../../prompts/utils/index.js';
import type { CognitiveEngineState } from '../state';
import { extractCitedNodeIds } from '../utils/chapter-reference-parser.js';
import { extractHumanMessageContents } from '../utils/engine-helpers.js';
import { extractJSON } from '../utils/parse.js';
import { enforceScopeHardGuard, buildFallbackScope, formatGuardInjectedLog } from '../utils/scope-guard.js';
import { loadTreeJson } from '../utils/tree-loader';

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
  const { bookId, pdfName: statePdfName, rewrittenQuery, depth }: InspectionalInput = state;
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
    toolContext.vault.app,
    toolContext.book.indexId || bookId,
    statePdfName || toolContext.book.pdfName,
  );

  if (outlineNodes.length === 0) {
    return {
      scopeNodeIds: [],
      tocSummary: '无法获取目录结构，使用全局搜索。',
      betterQuestion: rewrittenQuery,
      structuralAnalysis: '',
    };
  }

  // Step 2: Format tree structure (include book name in links)
  const pdfName = statePdfName;
  const treeText = formatTreeStructure(outlineNodes, 0, TREE_STRUCTURE_MAX_TEXT_LENGTH, TREE_STRUCTURE_MAX_DEPTH, pdfName);

  // Step 3: Build prompt
  const docDescription = config.configurable?.sharedContext?.toolContext?.book.docDescription;
  const recentHistorySummaries = config.configurable?.sharedContext?.recentHistorySummaries;
  // currentNodeId: 注入用户当前正在阅读的章节，触发 prompt 中的硬约束
  const currentNodeId = toolContext?.book?.currentNodeId;
  // citedNodeIds: 提取用户消息中显式引用的章节 nodeId
  // 既看最新消息，也看 chatHistory（防止前几轮引用被忽略）
  const allHumanContents = extractHumanMessageContents(state.messages);
  const citedNodeIds = extractCitedNodeIds(allHumanContents);

  if (currentNodeId || citedNodeIds.length > 0) {
    log(`[S1 Inspectional] currentNodeId=${currentNodeId || '(none)'}, citedNodeIds=[${citedNodeIds.join(',')}]`);
  }

  const systemPrompt = buildInspectionalSystemPrompt(
    treeText,
    statePdfName || '',
    depth,
    docDescription,
    currentNodeId,
    citedNodeIds,
  );
  const userMessage = buildInspectionalUserMessage(
    rewrittenQuery,
    depth,
    recentHistorySummaries,
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
      // 即使降级到全局搜索，也要兜底注入 current chapter + cited chapters
      const fallbackScope = buildFallbackScope(currentNodeId, citedNodeIds);
      return {
        scopeNodeIds: fallbackScope,
        tocSummary: '无法解析目录范围，使用全局搜索。',
        betterQuestion: rewrittenQuery,
        structuralAnalysis: '',
        suggestedKeywords: [],
      };
    }

    // === Scope hard-guard (see utils/scope-guard.ts docstring for rationale) ===
    const llmScope: string[] = Array.isArray(parsed.scopeNodeIds)
      ? parsed.scopeNodeIds.filter((id): id is string => typeof id === 'string')
      : [];
    const excludedReason = typeof parsed.excludedCurrentChapter === 'string'
      ? parsed.excludedCurrentChapter.trim()
      : '';
    const guardResult = enforceScopeHardGuard(
      llmScope,
      currentNodeId,
      citedNodeIds,
      excludedReason,
    );
    if (guardResult.injected.length > 0) {
      log(`[S1 Inspectional] Scope hard-guard injected ${guardResult.injected.length} ids: ${formatGuardInjectedLog(guardResult.injected)}`);
    }

    return {
      scopeNodeIds: guardResult.scope,
      tocSummary: parsed.tocSummary ?? '',
      betterQuestion: parsed.better_question ?? rewrittenQuery,
      structuralAnalysis: parsed.structural_analysis ?? '',
      suggestedKeywords: Array.isArray(parsed.suggested_keywords)
        ? parsed.suggested_keywords.filter((k): k is string => typeof k === 'string')
        : [],
    };
  } catch (err) {
    // Graceful degradation on LLM error
    log('[S1 Inspectional] LLM 调用失败，降级到全局搜索:', err instanceof Error ? err.message : String(err));
    return {
      scopeNodeIds: buildFallbackScope(currentNodeId, citedNodeIds),
      tocSummary: '无法解析目录范围，使用全局搜索。',
      betterQuestion: rewrittenQuery,
      structuralAnalysis: '',
      suggestedKeywords: [],
    };
  }
}
