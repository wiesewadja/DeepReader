/**
 * S1: Inspectional Reading Node - Unified Routing & Inspectional
 *
 * Merges Router S0 and Inspectional S1 into a single node.
 * Performs regex intent routing, correction detection, continuity guard,
 * existence verification, and makes a single LLM call for depth classification,
 * query rewriting, scope selection, and visualization intent.
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseMessage } from '@langchain/core/messages';
import { agentLog as log } from '../../../utils/logger.js';
import { TREE_STRUCTURE_MAX_TEXT_LENGTH, TREE_STRUCTURE_MAX_DEPTH } from '../../config/agent-constants.js';
import type { InspectionalInput } from '../node-io.js';
import { formatTreeStructure, buildInspectionalSystemPrompt, buildInspectionalUserMessage } from '../../prompts/utils/index.js';
import type { CognitiveEngineState } from '../state';
import { ReadingDepth } from '../state';
import { extractCitedNodeIds } from '../utils/chapter-reference-parser.js';
import { extractHumanMessageContents } from '../utils/engine-helpers.js';
import { extractJSON } from '../utils/parse.js';
import { enforceScopeHardGuard, buildFallbackScope, formatGuardInjectedLog } from '../utils/scope-guard.js';
import { loadTreeJson } from '../utils/tree-loader';

// Router utilities
import { IntentRouter } from '../../router/intent-router.js';
import { inheritDepthOnContinuity } from '../../router/continuity-guard.js';
import { upgradeToSyntopical } from '../../router/booklist-resolver.js';
import { verifyExistence, needsExistenceCheck } from '../../router/existence-verifier.js';
import { detectCorrection } from '../utils/correction-detector.js';

const intentRouter = new IntentRouter();

function extractLastHumanMessage(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.getType() === 'human' && typeof m.content === 'string') {
      return m.content;
    }
  }
  return '';
}

function mergeTools(a: string[], b: string[]): string[] {
  const set = new Set([...a, ...b]);
  return Array.from(set);
}

export async function inspectionalNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const { messages, allowedTools: prevTools = [], pdfName, bookId, crossBookMode } = state;
  const fastModel = config.configurable?.fastModel;
  const ctx = config.configurable?.sharedContext;
  const toolContext = ctx?.toolContext;
  const chatHistory = ctx?.chatHistory ?? [];

  const rawQuery = extractLastHumanMessage(messages);

  // 1. Correction detection
  const isCorrection = detectCorrection(rawQuery);
  if (isCorrection) {
    log(`[S1 Unified] 纠错信号检测: 强制 depth=2 (ANALYTICAL)`);
  }

  // 2. Continuity check
  const continuity = inheritDepthOnContinuity(ReadingDepth.CASUAL, rawQuery, chatHistory);
  let initialDepth: ReadingDepth = ReadingDepth.CASUAL;
  if (continuity.didUpgrade) {
    log(`[S1 Unified] 延续性对话检测: 升级 depth 0→2`);
    initialDepth = ReadingDepth.ANALYTICAL;
  }

  // 3. Correction override
  if (isCorrection && initialDepth < ReadingDepth.ANALYTICAL) {
    initialDepth = ReadingDepth.ANALYTICAL;
  }

  // 注：安全边界（系统提示词泄露）由 formatter / advisor 节点的 LLM system prompt 处理。
  //    此前用正则短路误伤率极高（"你的核心/如何工作/能力"等词在阅读讨论中常见），
  //    且命中后强制返回固定话术体验僵硬，已移除。详见 formatter.ts 安全边界。

  // 4. Short-circuit: Casual chat — check before heavy IntentRouter analysis
  const trimmedQuery = rawQuery.trim();
  const isCasualGreeting = /^(你好|hi|hello|谢谢|thank you|早上好|中午好|下午好|晚上好|再见|bye)\s*[。！？?!]*$/i.test(trimmedQuery);
  const isPossibleShortCasual = trimmedQuery.length <= 5 && !continuity.didUpgrade && !isCorrection;

  if (isCasualGreeting || isPossibleShortCasual) {
    log(`[S1 Unified] 触发纯 TS 短路返回: isCasualGreeting=${isCasualGreeting}, isShortCasual=${isPossibleShortCasual}`);
    return {
      depth: ReadingDepth.CASUAL,
      rewrittenQuery: rawQuery,
      allowedTools: [],
      correctionDetected: isCorrection,
      scopeNodeIds: [],
      tocSummary: '闲聊/常规问答',
      betterQuestion: rawQuery,
      structuralAnalysis: '',
      suggestedKeywords: [],
      shouldVisualize: false,
    };
  }

  // 5. IntentRouter analysis (after short-circuit, only for non-trivial messages)
  const rawIntent = intentRouter.analyze(rawQuery);
  log(`[S1 Unified] IntentRouter(raw): intents=${rawIntent.detectedIntents.join(',')}, tools=${rawIntent.allowedTools.join(',')}`);

  // 6. Inherit tools follow-up rule
  const hasNewIntent = rawIntent.detectedIntents.length > 0
    && !rawIntent.detectedIntents.every(i => i === 'general_qa' || i === '闲聊');
  const inheritedTools = (prevTools.length > 0 && !hasNewIntent) ? prevTools : [];

  // Default return when config is incomplete (e.g. testing)
  if (!fastModel || !toolContext) {
    return {
      depth: initialDepth,
      rewrittenQuery: rawQuery,
      allowedTools: mergeTools(rawIntent.allowedTools, inheritedTools),
      correctionDetected: isCorrection,
      scopeNodeIds: [],
      tocSummary: '',
      betterQuestion: rawQuery,
      structuralAnalysis: '',
      suggestedKeywords: [],
      shouldVisualize: false,
    };
  }

  // Step 1: Load tree.json
  const outlineNodes = await loadTreeJson(
    toolContext.vault.app,
    toolContext.book.indexId || bookId,
    pdfName || toolContext.book.pdfName,
  );

  let treeText = '无法获取目录结构。';
  if (outlineNodes.length > 0) {
    const actualPdfName = pdfName || toolContext.book.pdfName;
    treeText = formatTreeStructure(outlineNodes, 0, TREE_STRUCTURE_MAX_TEXT_LENGTH, TREE_STRUCTURE_MAX_DEPTH, actualPdfName);
  }

  // Step 2: Build prompt
  const docDescription = toolContext.book.docDescription;
  const recentHistorySummaries = ctx?.recentHistorySummaries;
  const currentNodeId = toolContext.book.currentNodeId;
  const allHumanContents = extractHumanMessageContents(messages);
  const citedNodeIds = extractCitedNodeIds(allHumanContents);

  if (currentNodeId || citedNodeIds.length > 0) {
    log(`[S1 Unified] currentNodeId=${currentNodeId || '(none)'}, citedNodeIds=[${citedNodeIds.join(',')}]`);
  }

  const quality = outlineNodes.quality;
  const qualityReason = outlineNodes.qualityReason;

  const systemPrompt = buildInspectionalSystemPrompt(
    treeText,
    pdfName || toolContext.book.pdfName || '',
    docDescription,
    currentNodeId,
    citedNodeIds,
    quality,
    qualityReason
  );
  const userMessage = buildInspectionalUserMessage(
    rawQuery,
    recentHistorySummaries,
  );

  // Step 3: Call fast model and parse JSON from text
  try {
    const response = await fastModel.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage),
    ], config);

    const text = typeof response.content === 'string' ? response.content : '';
    const parsed = extractJSON(text);

    if (!parsed) {
      log('[S1 Unified] 无法解析 JSON，使用 fallback。原始输出:', text.slice(0, 200));
      const fallbackScope = buildFallbackScope(currentNodeId, citedNodeIds);
      return {
        depth: initialDepth || ReadingDepth.ANALYTICAL,
        rewrittenQuery: rawQuery,
        allowedTools: mergeTools(rawIntent.allowedTools, inheritedTools),
        correctionDetected: isCorrection,
        scopeNodeIds: fallbackScope,
        tocSummary: '无法解析大模型规划，进行全局搜索。',
        betterQuestion: rawQuery,
        structuralAnalysis: '',
        suggestedKeywords: [],
        shouldVisualize: false,
      };
    }

    // Determine depth
    const rawDepth = parsed.depth;
    const validDepths = Object.values(ReadingDepth) as number[];
    let depth: ReadingDepth = validDepths.includes(rawDepth)
      ? rawDepth : (initialDepth || ReadingDepth.ANALYTICAL);

    if (isCorrection && depth < ReadingDepth.ANALYTICAL) {
      depth = ReadingDepth.ANALYTICAL;
    }

    let standaloneQuery = parsed.better_question || rawQuery;
    log(`[S1 Unified] LLM response: depth=${rawDepth} (effective=${depth}), reason="${parsed.reason || '(none)'}", query="${standaloneQuery.slice(0, 80)}"`);

    // Upgrade to Syntopical if applicable
    const hasBooklist = (toolContext.crossBook?.booklistBookIds?.length ?? 0) > 0 || crossBookMode;
    const syntopical = upgradeToSyntopical(depth, !!hasBooklist);
    const effectiveDepth = syntopical.depth;

    // IntentRouter on rewritten query
    const rewrittenIntent = intentRouter.analyze(standaloneQuery);
    const finalTools = mergeTools(
      mergeTools(rawIntent.allowedTools, rewrittenIntent.allowedTools),
      inheritedTools,
    );

    // Post-LLM Existence verify (BM25)
    if (toolContext.book.indexId && toolContext.vault.app && needsExistenceCheck(rawQuery, standaloneQuery)) {
      const existence = await verifyExistence({
        rawQuery,
        standaloneQuery,
        depth: effectiveDepth,
        bookId: toolContext.book.indexId,
        app: toolContext.vault.app,
      });
      if (existence.antiHallucinationQuery) {
        const cleaned = standaloneQuery.replace('[ANTI_HALLUCINATION]', '').trim();
        return {
          depth: ReadingDepth.CASUAL,
          rewrittenQuery: `请直接回答：经检索确认，这本书中并未提及"${existence.antiHallucinationQuery}"相关内容。请简洁回复，说明书中未提及该内容，不要展开讨论或用书中概念去分析它。`,
          allowedTools: finalTools,
          correctionDetected: isCorrection,
          scopeNodeIds: [],
          tocSummary: '书内未提及该内容',
          betterQuestion: cleaned,
          structuralAnalysis: '',
          suggestedKeywords: [],
          shouldVisualize: false,
        };
      }
    }

    // === Scope hard-guard ===
    let finalScope: string[] = [];
    if (effectiveDepth === ReadingDepth.ANALYTICAL) {
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
        log(`[S1 Unified] Scope hard-guard injected ${guardResult.injected.length} ids: ${formatGuardInjectedLog(guardResult.injected)}`);
      }
      finalScope = guardResult.scope;
    }

    const shouldVisualize = effectiveDepth !== ReadingDepth.CASUAL && parsed.visualize === true;

    return {
      depth: effectiveDepth,
      rewrittenQuery: standaloneQuery,
      allowedTools: finalTools,
      correctionDetected: isCorrection,
      scopeNodeIds: finalScope,
      tocSummary: parsed.tocSummary ?? '',
      betterQuestion: standaloneQuery,
      structuralAnalysis: parsed.structural_analysis ?? '',
      suggestedKeywords: Array.isArray(parsed.suggested_keywords)
        ? parsed.suggested_keywords.filter((k): k is string => typeof k === 'string')
        : [],
      shouldVisualize,
    };
  } catch (err) {
    log('[S1 Unified] LLM 调用失败，降级到全局搜索:', err instanceof Error ? err.message : String(err));
    const fallbackScope = buildFallbackScope(currentNodeId, citedNodeIds);
    return {
      depth: initialDepth || ReadingDepth.ANALYTICAL,
      rewrittenQuery: rawQuery,
      allowedTools: mergeTools(rawIntent.allowedTools, inheritedTools),
      correctionDetected: isCorrection,
      scopeNodeIds: fallbackScope,
      tocSummary: 'LLM调用失败，降级进行全局搜索。',
      betterQuestion: rawQuery,
      structuralAnalysis: '',
      suggestedKeywords: [],
      shouldVisualize: false,
    };
  }
}
