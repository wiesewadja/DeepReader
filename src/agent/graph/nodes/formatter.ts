/**
 * S4: Formatter Node — Style transformation with wiki link preservation
 *
 * S4 只做风格转换（奚童语气），wiki 链接由 S2 生成，通过 prompt
 * 引导 S4 保留原始链接。self-verification 作为安全网移除幽灵引用。
 */

import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { interrupt } from '@langchain/langgraph';
import type { ChatOpenAI } from '@langchain/openai';
import { agentLog as log } from '../../../utils/logger.js';
import { validateLinkPairs } from '../../utils/wiki-link-pair-validator.js';
import {
  cleanOutput,
  sanitizeOutput,
} from '../utils/output-sanitizer.js';
import type { FormatterInput } from '../node-io.js';
import {
  buildFormatterSystemPrompt,
  buildFormatterUserMessage,
  buildProactiveSystemPrompt,
  buildProactiveUserMessage,
  buildSocraticDialoguePrompt,
  buildSocraticDialogueUserMessage,
  buildScopedChaptersBlock,
} from '../../prompts/utils/index.js';
import type { CognitiveEngineState, NodeError, ToolResultSnapshot } from '../state';
import { ReadingDepth, NODE_ERROR_HINTS } from '../state';
import { resolveMode } from '../utils/engine-helpers';
import { summarizeRecentHistory, formatHistoryBlock } from '../utils/history-summarizer';
import { verifyAndCleanContent, type ToolResultEntry } from '../utils/self-verification';

/**
 * Extract text from a streaming chunk (handles string, array, and null content).
 */
function extractChunkText(chunk: { content: unknown }): string {
  const { content } = chunk;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as { type: string; text: string }[])
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');
  }
  return '';
}

/**
 * Build retrieval-coverage metadata for the formatter prompt.
 *
 * Returns undefined when there is no signal worth reporting (no current chapter
 * AND no searches performed), keeping the prompt lean.
 */
function buildRetrievalCoverage(
  toolResultsSnapshot: ToolResultSnapshot[] | undefined,
  currentNodeId: string | undefined,
):
  | { searchedNodeIds: string[]; currentNodeId: string | undefined; isCoverageGap: boolean }
  | undefined {
  const searchedNodeIds = (toolResultsSnapshot || [])
    .map(r => r.args?.node_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const uniqueSearched = Array.from(new Set(searchedNodeIds));
  if (!currentNodeId && uniqueSearched.length === 0) return undefined;
  return {
    searchedNodeIds: uniqueSearched,
    currentNodeId,
    isCoverageGap: currentNodeId ? !uniqueSearched.includes(currentNodeId) : false,
  };
}

/**
 * Stream LLM response and call back with accumulated content.
 * Source: @langchain/openai ChatOpenAI.stream() — returns AsyncIterable of AIMessageChunk.
 *
 * @throws Error with context if streaming fails, allowing callers to provide meaningful feedback.
 */
async function streamToContent(
  model: ChatOpenAI,
  messages: BaseMessage[],
  config: RunnableConfig,
  onContent?: (content: string) => void,
): Promise<string> {
  let stream: AsyncIterable<Awaited<ReturnType<ChatOpenAI['stream']>> extends AsyncIterable<infer T> ? T : never>;
  try {
    stream = await model.stream(messages, config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`LLM 流式请求失败: ${msg}`);
  }
  let content = '';
  for await (const chunk of stream) {
    const text = extractChunkText(chunk);
    if (text) {
      content += text;
      onContent?.(content);
    }
  }
  return content;
}

/**
 * Generate user-facing error hints from nodeErrors.
 */
function appendErrorHints(nodeErrors?: Record<string, NodeError | string>): string {
  if (!nodeErrors) return '';
  const hints: string[] = [];
  for (const [node, err] of Object.entries(nodeErrors)) {
    const isRecoverable = typeof err === 'object' ? err.recoverable : true;
    if (isRecoverable && NODE_ERROR_HINTS[node]) {
      hints.push(NODE_ERROR_HINTS[node]);
    }
  }
  return hints.join('\n');
}

/**
 * S4 Formatter node
 */
export async function formatterNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const {
    analysisResult,
    structuralAnalysis,
    rewrittenQuery,
    pdfName,
    proactiveTrigger,
    depth,
    tocSummary,
    betterQuestion,
    scopeNodeIds,
    toolResultsSnapshot,
    highlightContext,
    crossBookMode,
    nodeFileMap,
  }: FormatterInput = state;
  const mode = resolveMode(state);
  const mainModel = config.configurable?.mainModel;
  const callbacks = config.configurable?.callbacks as {
    onContent?: (content: string) => void;
    onProgress?: (msg: string) => void;
  } | undefined;
  const ctx = config.configurable?.sharedContext;

  // Detect and clean XML tool call residue in analysisResult
  const _rawAR = analysisResult || '';
  const _hasXmlResidue = /<function>[\s\S]*?<\/function>/.test(_rawAR);
  const effectiveAR = _hasXmlResidue ? _rawAR.replace(/<function>[\s\S]*?<\/function>/g, '').replace(/<parameter>[\s\S]*?<\/parameter>/g, '').trim() : _rawAR;

  if (!mainModel) {
    return { formattedOutput: effectiveAR || rewrittenQuery || '' };
  }

  // === Proactive mode: ask a question, don't answer ===
  if (mode === 'proactive') {
    const trigger = (proactiveTrigger || 'inspectional') as 'inspectional' | 'highlight' | 'chapter';
    const ar = analysisResult || '';
    const hasDiagram = false; // Proactive 模式直接结束到 formatter，不经过 VISUALIZER 节点，因此不附带图表
    callbacks?.onProgress?.('思考引导问题...');
    const proactivePromptStr = buildProactiveSystemPrompt(trigger, hasDiagram);
    let proactiveUserMsg = buildProactiveUserMessage({
      structuralAnalysis: structuralAnalysis || undefined,
      tocSummary: tocSummary || undefined,
      highlightContext: highlightContext || undefined,
      bookName: pdfName || '',
    });
    if (hasDiagram) {
      proactiveUserMsg += `\n\n<diagram_result>\n${ar}\n</diagram_result>`;
    }
    const content = await streamToContent(
      mainModel,
      [new SystemMessage(proactivePromptStr), new HumanMessage(proactiveUserMsg)],
      config,
      callbacks?.onContent,
    );

    const formatted = await sanitizeOutput(content, {
      bookName: pdfName || '',
      crossBookMode,
      inputTextsForValidation: [structuralAnalysis || '', tocSummary || '', content],
      markdownFiles: ctx?.toolContext?.book.markdownFiles ?? {},
      vaultApp: ctx?.toolContext?.vault?.app,
      toolResults: [],
      skipVaultVerification: true,
    });
    return { formattedOutput: formatted };
  }

  // === Socratic dialogue: respond + follow-up using chatHistory ===
  if (mode === 'socratic') {
    callbacks?.onProgress?.('正在思考...');
    const chatHistory = ctx?.chatHistory ?? [];
    const socraticPrompt = buildSocraticDialoguePrompt();
    const socraticUserMsg = buildSocraticDialogueUserMessage(
      rewrittenQuery || '',
      chatHistory,
    );
    const content = await streamToContent(
      mainModel,
      [new SystemMessage(socraticPrompt), new HumanMessage(socraticUserMsg)],
      config,
      callbacks?.onContent,
    );

    const formatted = await sanitizeOutput(content, {
      bookName: pdfName || '',
      crossBookMode,
      inputTextsForValidation: [content],
      markdownFiles: ctx?.toolContext?.book.markdownFiles ?? {},
      vaultApp: ctx?.toolContext?.vault?.app,
      toolResults: [],
      skipVaultVerification: true,
    });
    return { formattedOutput: formatted };
  }

  // === ADVISOR node passthrough: already produced formatted response via ReAct ===
  if (!pdfName && !crossBookMode && effectiveAR) {
    return { formattedOutput: cleanOutput(effectiveAR, '', crossBookMode) };
  }

  // === Casual mode (depth=CASUAL): simple direct response ===
  if (depth === ReadingDepth.CASUAL) {
    callbacks?.onProgress?.('正在思考...');
    const isReadingAdvisor = !pdfName;
    const casualPrompt = buildFormatterSystemPrompt(ctx?.memoryContext, ctx?.userProfileSummary, isReadingAdvisor);
    const chatHistory = ctx?.chatHistory ?? [];
    const historyText = chatHistory.length > 0
      ? formatHistoryBlock(summarizeRecentHistory(chatHistory, 3))
      : '';
    const bookshelfSection = (isReadingAdvisor && ctx?.toolContext?.crossBook?.bookshelfSummary)
      ? `\n<bookshelf>\n${ctx?.toolContext?.crossBook?.bookshelfSummary}\n</bookshelf>`
      : '';
    const userMsg = historyText
      ? `<history>\n${historyText}\n</history>\n\n<query>${rewrittenQuery || ''}</query>\n<book>${pdfName || ''}</book>${bookshelfSection}`
      : `<query>${rewrittenQuery || ''}</query>\n<book>${pdfName || ''}</book>${bookshelfSection}`;
    const content = await streamToContent(
      mainModel,
      [new SystemMessage(casualPrompt), new HumanMessage(userMsg)],
      config,
      callbacks?.onContent,
    );

    const formatted = await sanitizeOutput(content, {
      bookName: pdfName || '',
      crossBookMode,
      inputTextsForValidation: [content],
      markdownFiles: ctx?.toolContext?.book.markdownFiles ?? {},
      vaultApp: ctx?.toolContext?.vault?.app,
      toolResults: [],
      skipVaultVerification: true,
    });
    return { formattedOutput: formatted };
  }


  // === Normal mode (depth >= 1): format with full context ===
  const systemPrompt = buildFormatterSystemPrompt(ctx?.memoryContext, ctx?.userProfileSummary);

  const chatHistory = ctx?.chatHistory ?? [];
  const markdownFiles = ctx?.toolContext?.book.markdownFiles ?? {};
  const effectiveScopeNodeIds = scopeNodeIds ?? [];
  const coveredScope = effectiveScopeNodeIds.length > 0
    ? buildScopedChaptersBlock(effectiveScopeNodeIds, markdownFiles, nodeFileMap)
    : '';

  // === Retrieval coverage transparency ===
  // 把"实际检索了哪些章节"+"用户当前章节是否被覆盖"显式注入 prompt
  // 防止 LLM 拿"未出现"搪塞用户，掩盖真实检索失败
  const retrievalCoverage = buildRetrievalCoverage(
    toolResultsSnapshot,
    ctx?.toolContext?.book?.currentNodeId,
  );

  // 收集输入文本用于校验编造链接。
  // coveredScope 包含 tree.json 中验证过的 file_name（vault 真实文件），
  // 纳入校验是为了让早停路径已引用的链接在 formatter 输出中不被误删。
  // 当 effectiveScopeNodeIds 为空时 coveredScope 为 ''，对校验无影响。
  // 当 analysisResult 无效时使用 effectiveAR（空字符串），避免 XML 残留污染校验。
  const inputTextsForValidation = [
    effectiveAR,
    structuralAnalysis || '',
    coveredScope,
    tocSummary || '',
  ];
  callbacks?.onProgress?.('正在整理笔记...');
  // Booklist mode: avoid single-book link fixup; pdfName is meaningless for multi-book analysis
  const effectivePdfName = crossBookMode ? '' : (pdfName || '');
  const userMessage = buildFormatterUserMessage(
    rewrittenQuery,
    effectiveAR,
    effectivePdfName,
    chatHistory,
    tocSummary || undefined,
    structuralAnalysis || undefined,
    betterQuestion || undefined,
    coveredScope || undefined,
    !!crossBookMode,
    retrievalCoverage,
  );

  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(userMessage),
  ];

  // Stream output
  let content = await streamToContent(mainModel, messages, config, callbacks?.onContent);

  // T3.2: 流式截断修复 — 在做工具结果校验前先把单边 [[ / ]] 残片修了
  // 顺序关键：流式残片必须先修，否则 verifyAndCleanContent 看到的就是坏数据
  const linkPairResult = validateLinkPairs(content);
  if (linkPairResult.fixedUnpaired > 0) {
    log(`[Formatter] Fixed ${linkPairResult.fixedUnpaired} unpaired [[ or ]]`);
  }
  content = linkPairResult.content;

  // Self-verification: remove ghost block_id references (safety net)
  const toolResults: ToolResultEntry[] = (toolResultsSnapshot || []).map(r => ({
    toolName: r.toolName,
    args: r.args as Record<string, unknown>,
    result: r.result,
    originalResultLength: r.originalResultLength,
    extractedBlockIds: r.extractedBlockIds,
  }));

  if (toolResults.length > 0) {
    const verificationResult = await verifyAndCleanContent(content, toolResults);
    content = verificationResult.content;

    if (config.configurable?.langsmithTracer) {
      try {
        const client = config.configurable.langsmithTracer.client;
        await client.createRun({
          name: 'wiki_link_verification',
          run_type: 'tool',
          inputs: { content_length: content.length },
          outputs: verificationResult,
          parent_run_id: config.configurable?.parentRunId,
          extra: { metadata: {
            tool_results_count: toolResults.length,
            wiki_links_before: verificationResult.totalRefs,
            wiki_links_after: verificationResult.totalRefs - verificationResult.ghostRefs,
            ghost_refs_removed: verificationResult.ghostRefs,
          } },
        });
      } catch {
        // 静默失败
      }
    }
  }

  // HITL interrupt (if enabled)
  const enableHumanReview = config.configurable?.enableHumanReview as boolean | undefined;
  if (enableHumanReview) {
    const resumeValue = interrupt({
      nodeId: 'formatter',
      question: 'S4 格式化完成，确认输出内容？',
      content,
    }) as { approved: boolean; feedback: string } | undefined;

    if (resumeValue?.approved === false && resumeValue.feedback) {
      const feedbackMessages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(userMessage),
        new AIMessage(content),
        new HumanMessage(`用户反馈：${resumeValue.feedback}\n\n请根据反馈修正格式化输出。`),
      ];

      let refinedContent = await streamToContent(mainModel, feedbackMessages, config, callbacks?.onContent);

      if (toolResults.length > 0) {
        const vResult = await verifyAndCleanContent(refinedContent, toolResults);
        refinedContent = vResult.content;
      }

      content = refinedContent;
    }
  }

  // 段 B 清理 pipeline（vault 真实校验）：委派给 OutputSanitizer
  // 顺序：protectEmbeds → cleanOutput → validateWikiLinks → stripFabricatedLinks → restoreEmbeds
  const formatted = await sanitizeOutput(content, {
    bookName: effectivePdfName,
    crossBookMode,
    inputTextsForValidation,
    markdownFiles,
    vaultApp: ctx?.toolContext?.vault?.app,
    toolResults,
  });

  const errorHints = appendErrorHints(state.nodeErrors);

  return { formattedOutput: errorHints ? `${formatted}\n\n> [!hint] ${errorHints}` : formatted };
}
